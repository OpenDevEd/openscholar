/**
 * Getting a screening's papers from its sources (plans/screening-reviewers). Each look in the sources is a row of
 * `screeningChecks`: the one a screening starts with, and each later check of a living one. One action reads the
 * sources in the order they were added, a step at a time, and gives each step to `fill`, which leaves out what
 * can't be screened, merges what another source already brought, and deals the rest to the reviewers. Where a
 * source's reading stands is kept on its own row, so a set of any size is never held whole, and a reading cut
 * short goes on from where it stopped.
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx } from "../lib/functions";
import { createError, readConvexErrorData } from "../lib/errors";
import { identityOf } from "../lib/paperRef";
import { MAX_AUTHORS } from "../lib/listCaps";
import { sourceMetadata } from "../../lib/library/paper-metadata";
import { parsePaperKey } from "../../lib/papers/paper-ref";
import { keepLibraryKeys, resolveLibraryKeys } from "../evidenceLibraries/sources";
import { requirePaperKey } from "../library/find";
import { heldPapers } from "../paperSets/held";
import { countSearch, numbered, PAGE_SIZE, searchSnapshotValidator, type SearchSnapshot } from "../paperSets/openalex";
import { searchPapers, snapshotOf, spender, type SavedSearchRequest, type SearchPaper } from "../paperSets/search";
import { actorIn } from "../workspaces/actor";
import { ZOTERO_AT_ONCE, ZOTERO_LIST_PAGE, ZOTERO_PDFS_A_CALL } from "../zotero/libraryValidators";
import { bookkeepLater } from "./bookkeeping";
import { countDealt, dealable, dealNew, readingModel, readsOf, reviewersOf, sourcesOf, touched } from "./dealing";
import { progressRow, shelve, withMoved } from "./bookkeeping";
import { checked } from "./living";
import { unglued } from "../../lib/papers/abstract-sections";
import { papersIn } from "./estimate";
import { pdfBand } from "../../lib/pricing/estimate";
import { readersFor } from "../../lib/screening/rules";
import { handedPapers, handedStart, withAbstracts, type LeftOut } from "./held";
import { searchTextOf } from "./mutations";
import { doiKeyOf, nextPlace, QUIET_MS, titleKeyOf } from "./checks";
import { papersLimit, startWaitingVotes } from "./slots";
import { leftOutWhyValidator, MAX_SOURCE_ROWS, SCREENING_TEXT, screeningPaperInputValidator, sourceSetValidator } from "./validators";

type SourceSet = Infer<typeof sourceSetValidator>;
type Why = Infer<typeof leftOutWhyValidator>;

/** Papers one step takes: up to the end of one of OpenAlex's pages, so no page is asked for twice. */
const READ_STEP = PAGE_SIZE;
/** How long one reading action reads before it hands on to the next: well inside an action's ten minutes. */
const READ_ACTION_MS = 4 * 60_000;
/** How often a check that went quiet (`QUIET_MS`, ./checks.ts) is set off again before it is left as failed. */
const RESTARTS = 3;
/** Places one `fill` gives at most. A step's papers are given in as many fills as that takes: a paper that goes to many reviewers is many rows, and a transaction holds only so many (`npm run test:size` proves a step at the most it writes). */
const FILL_PLACES = 2_000;
/** How long a check waits before it looks again at PDFs whose first reading hasn't ended. */
const PDFS_WAIT_MS = 3_000;
/** How much of why a source couldn't be read is kept. */
const FAILURE_SHOWN = 600;
/** How often one fill is tried before its source is left as failed. */
const FILL_TRIES = 5;


type Reading = { gone?: true; full?: true; pass: number; places: number; sourceId: Id<"screeningSources">; part: number; set: SourceSet; first: number; last?: number; read: number; resume?: string; snapshot?: SearchSnapshot; state: "waiting" | "reading"; total?: number; userId: Id<"users">; workspaceId: Id<"workspaces"> };

/** The next of a check's sources that still has papers to read, with where its reading stands. Null once every source is read, or the check has ended. */
export const next = internalQuery({
  args: { checkId: v.id("screeningChecks") },
  returns: v.union(v.null(), v.object({ places: v.number(), sourceId: v.id("screeningSources"), part: v.number(), set: sourceSetValidator, first: v.number(), last: v.optional(v.number()), read: v.number(), resume: v.optional(v.string()), snapshot: v.optional(searchSnapshotValidator), state: v.union(v.literal("waiting"), v.literal("reading")), total: v.optional(v.number()), userId: v.id("users"), workspaceId: v.id("workspaces"), gone: v.optional(v.literal(true)), full: v.optional(v.literal(true)), pass: v.number() })),
  handler: async (ctx, { checkId }): Promise<Reading | null> => {
    const check = await ctx.db.get("screeningChecks", checkId);
    const job = check?.state === "running" ? await ctx.db.get("screeningJobs", check.jobId) : null;
    if (!job) return null;
    const sources = await sourcesOf(ctx, job._id);
    const part = sources.findIndex((source) => source.removedAt === undefined && (source.state === "waiting" || source.state === "reading"));
    const source = sources[part];
    if (!source) return null;
    // Read as whoever added it: a Zotero library is theirs, and a community's records are the ones they may read.
    // Where its screening has moved, it is read in the workspace it was added from, while that person is still in it.
    const adder = source.workspaceId ? await ctx.db.get("users", source.addedBy) : null;
    const gone = source.workspaceId !== undefined && !(adder && (await actorIn(ctx, adder, source.workspaceId)));
    // The places a paper is given as it arrives: its people, as many as the rule asks for, and every model that reads.
    const reviewers = await reviewersOf(ctx, job._id);
    const places = readersFor(job.rule?.each ?? "all", reviewers.filter(dealable).length) + reviewers.filter(readingModel).length;
    // A screening that holds as many papers as its plan takes asks no source for more: the source stops at once, and says why.
    const full = job.totalPapers - ((await progressRow(ctx, job._id))?.withdrawn ?? 0) >= (await papersLimit(ctx, job.workspaceId));
    return { ...(gone ? { gone: true as const } : {}), ...(full ? { full: true as const } : {}), pass: source.pass ?? 0, places, sourceId: source._id, part, set: source.set, first: source.first ?? 1, ...(source.last === undefined ? {} : { last: source.last }), read: source.read, ...(source.resume ? { resume: source.resume } : {}), ...(source.snapshot ? { snapshot: source.snapshot } : {}), state: source.state as "waiting" | "reading", ...(source.total === undefined ? {} : { total: source.total }), userId: source.addedBy, workspaceId: source.workspaceId ?? job.workspaceId };
  },
});

/** How many papers a held source has, as the account counts them; null for one it doesn't count. */
export const heldTotal = internalQuery({
  args: { userId: v.id("users"), workspaceId: v.id("workspaces"), set: sourceSetValidator },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { userId, workspaceId, set }) => (set.kind === "collection" || set.kind === "saved" || set.kind === "screening" ? papersIn(ctx, { userId, workspaceId }, set) : null),
});

/** A source's reading begins: what it holds, and for a search the search as it was then, which every step reads. */
export const begin = internalMutation({
  args: { sourceId: v.id("screeningSources"), pass: v.number(), total: v.optional(v.number()), snapshot: v.optional(searchSnapshotValidator), resume: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { sourceId, pass, total, snapshot, resume }) => {
    const source = await ctx.db.get("screeningSources", sourceId);
    if (source?.state === "waiting" && (source.pass ?? 0) === pass) await ctx.db.patch("screeningSources", sourceId, { state: "reading", ...(total === undefined ? {} : { total }), ...(snapshot ? { snapshot } : {}), ...(resume ? { resume } : {}) });
    return null;
  },
});

/** A source that couldn't be read is left as failed, with why in words for the person where it is something they can act on, and the check goes on to the next. The check counts it as one of its own it couldn't read. */
export const fail = internalMutation({
  args: { checkId: v.id("screeningChecks"), sourceId: v.id("screeningSources"), pass: v.number(), reason: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { checkId, sourceId, pass, reason }) => {
    // A reading of the source from before it was changed fails nothing: the source is being read again.
    if (((await ctx.db.get("screeningSources", sourceId))?.pass ?? 0) !== pass) return null;
    await ctx.db.patch("screeningSources", sourceId, { state: "failed", failure: reason?.slice(0, FAILURE_SHOWN) });
    const check = await ctx.db.get("screeningChecks", checkId);
    if (check && !check.unread?.includes(sourceId)) await ctx.db.patch("screeningChecks", checkId, { unread: [...(check.unread ?? []), sourceId].slice(-MAX_SOURCE_ROWS) });
    return null;
  },
});

/**
 * Reads a check's sources a step at a time. Past a few minutes it hands on to another action. A source whose
 * papers can't be read fails by itself, with why, and the others are still read.
 */
export const gather = internalAction({
  args: { checkId: v.id("screeningChecks") },
  returns: v.null(),
  handler: async (ctx, { checkId }) => {
    const started = Date.now();
    for (;;) {
      // Typed here: the generated API's types depend on this module, so inference would loop.
      const source: Reading | null = await ctx.runQuery(internal.screening.gathering.next, { checkId });
      if (!source) return void (await ctx.runMutation(internal.screening.gathering.end, { checkId }));
      if (Date.now() - started > READ_ACTION_MS) return void (await ctx.scheduler.runAfter(0, internal.screening.gathering.gather, { checkId }));
      try {
        if (source.gone) throw createError("FORBIDDEN", "Whoever added this source is no longer in the workspace it is in. Add it again from this workspace.");
        if (source.full) {
          await ctx.runMutation(internal.screening.gathering.begin, { sourceId: source.sourceId, pass: source.pass });
          await ctx.runMutation(internal.screening.gathering.fill, { checkId, sourceId: source.sourceId, pass: source.pass, papers: [], read: 0, ended: false, full: true });
          continue;
        }
        // Its next PDFs are still being read for the first time: the check comes back for them, and is not taken for one gone quiet.
        if ((await step(ctx, checkId, source)) === "wait") {
          await ctx.runMutation(internal.screening.gathering.beat, { checkId });
          return void (await ctx.scheduler.runAfter(PDFS_WAIT_MS, internal.screening.gathering.gather, { checkId }));
        }
      } catch (error) {
        console.error(`[screening] Source ${source.sourceId} couldn't be read`, error);
        await ctx.runMutation(internal.screening.gathering.fail, { checkId, sourceId: source.sourceId, pass: source.pass, ...(readConvexErrorData(error)?.message ? { reason: readConvexErrorData(error)!.message } : {}) });
      }
    }
  },
});

/** A check is still at work: its watch (`watch`) leaves it be. */
export const beat = internalMutation({
  args: { checkId: v.id("screeningChecks") },
  returns: v.null(),
  handler: async (ctx, { checkId }) => {
    const check = await ctx.db.get("screeningChecks", checkId);
    if (check?.state === "running") await ctx.db.patch("screeningChecks", checkId, { beat: Date.now() });
    return null;
  },
});

/** One step of one source: the next papers of it, given to `fill`. "wait" where they can't be read yet. */
async function step(ctx: ActionCtx, checkId: Id<"screeningChecks">, source: Reading): Promise<"wait" | void> {
  const { sourceId, set } = source;
  const reader = { userId: source.userId, workspaceId: source.workspaceId };
  const give = async (papers: SearchPaper[], read: number, ended: boolean, resume?: string, leftOut?: LeftOut[]) => {
    // A paper that came with no abstract takes the one OpenAlex holds, and failing that the one registered under its DOI, whichever source brought it. A PDF's was asked for when the file was first read (./heldPdfs.ts): it comes with what that found.
    const bare = set.kind !== "pdf" && papers.some((paper) => !paper.abstract?.trim());
    const who: { clerkId: string } | null = bare ? await ctx.runQuery(internal.screening.held.reader, reader) : null;
    const ready = bare ? await withAbstracts(papers, who ? spender(ctx, who.clerkId) : null) : papers;
    // The source's place moves on with the last of them only: a reading cut short before that reads these papers again, and the ones it gave already are passed over.
    const each = Math.max(1, Math.floor(FILL_PLACES / Math.max(1, source.places)));
    for (let at = 0; at === 0 || at < ready.length; at += each) {
      const last = at + each >= ready.length;
      const goesOn = last ? resume : source.resume;
      const args = { checkId, sourceId, pass: source.pass, papers: ready.slice(at, at + each), read: last ? read : 0, ended: ended && last, ...(goesOn ? { resume: goesOn } : {}), ...(at === 0 && leftOut?.length ? { leftOut } : {}) };
      // A fill writes the reviewers' counts that voting and settling write too: one that loses to them every time Convex tries it is tried again here, with the papers it already has.
      for (let tries = 1; ; tries++) {
        try { await ctx.runMutation(internal.screening.gathering.fill, args); break; }
        catch (error) { if (readConvexErrorData(error) || tries >= FILL_TRIES) throw error; await new Promise((wait) => setTimeout(wait, 500 * 2 ** tries)); }
      }
    }
  };
  const held = set.kind === "upload" || set.kind === "dois" || set.kind === "pdf" ? { ...source, set } : null;
  if (source.state === "waiting") {
    // A file, a pasted list or PDFs: what it holds is counted from the file itself.
    if (held) return void (await ctx.runMutation(internal.screening.gathering.begin, { sourceId, pass: source.pass, ...(await handedStart(ctx, held)) }));
    // What it holds is counted once, before its first paper: a search as it is now, a community's source as the person may read it.
    if (set.kind === "search") {
      const found: SavedSearchRequest = await ctx.runQuery(internal.paperSets.search.readSearch, { ...reader, searchId: set.searchId });
      const snapshot = snapshotOf(found);
      return void (await ctx.runMutation(internal.screening.gathering.begin, { sourceId, pass: source.pass, snapshot, total: await countSearch(snapshot.request, spender(ctx, found.clerkId)) }));
    }
    if (set.kind === "evidenceLibrary") {
      const keys = await resolveLibraryKeys(ctx, { libraryId: set.libraryId, userId: source.userId, source: set.source, first: source.first, last: source.last ?? Number.MAX_SAFE_INTEGER });
      await keepLibraryKeys(ctx, (await ctx.runQuery(internal.screening.gathering.jobOf, { checkId }))!, keys, { part: source.part });
      return void (await ctx.runMutation(internal.screening.gathering.begin, { sourceId, pass: source.pass, total: source.first - 1 + keys.length }));
    }
    // With the collections under it: the library's collections are kept as rows (../zotero/tree.ts), and the check comes back while they are still being read. `resume` keeps the collections still to read, this one first, and how far into the first the reading is. What it holds with everything under it is what Zotero counts in each, so a paper filed in two of them is counted twice until it is read.
    if (set.kind === "zotero" && set.deep && set.collectionKey) {
      const library = { userId: source.userId, ...(set.groupId ? { groupId: set.groupId } : {}) };
      const tree: "done" | "wait" | "failed" = await ctx.runMutation(internal.zotero.tree.ready, library);
      if (tree === "failed") throw createError("EXTERNAL_SERVICE_ERROR", "Zotero didn't give this library's collections. Check that Zotero is still connected.");
      if (tree === "wait") return "wait";
      const root: { under: number } | null = await ctx.runQuery(internal.zotero.tree.one, { ...library, key: set.collectionKey });
      return void (await ctx.runMutation(internal.screening.gathering.begin, { sourceId, pass: source.pass, ...(root ? { total: root.under } : {}), resume: JSON.stringify({ keys: [set.collectionKey], at: 0, skip: source.first - 1 }) }));
    }
    const total: number | null = await ctx.runQuery(internal.screening.gathering.heldTotal, { ...reader, set });
    return void (await ctx.runMutation(internal.screening.gathering.begin, { sourceId, pass: source.pass, ...(total === null ? {} : { total }) }));
  }
  const last = Math.min(source.last ?? Number.MAX_SAFE_INTEGER, source.total ?? Number.MAX_SAFE_INTEGER);
  const from = source.first + source.read;
  if (from > last) return void (await give([], 0, true));
  const to = Math.min(last, Math.ceil(from / READ_STEP) * READ_STEP);
  if (held) {
    const handed = await handedPapers(ctx, held, from, to);
    if (handed === "wait") return "wait";
    return void (await give(handed.papers, to - from + 1, to >= last, source.resume, handed.left));
  }
  if (set.kind === "search") {
    // Numbered pages when the search's order has them as far as the source goes, each step its own; otherwise one cursor page a step, carrying on from where the last stopped.
    const paged = source.snapshot !== undefined && numbered(source.snapshot.request, last);
    const { papers, twins, ended, resume, taken } = await searchPapers(ctx, reader, { searchId: set.searchId, first: from, last: to }, source.snapshot, paged ? { goesOn: false } : { resume: source.resume, goesOn: true }, true);
    const read = paged ? to - from + 1 : taken;
    // A second record of a work comes after its first, which it is then merged into, or left out beside.
    return void (await give([...papers, ...twins], read, ended || from + read > last, resume));
  }
  if (set.kind === "evidenceLibrary") {
    const job = (await ctx.runQuery(internal.screening.gathering.jobOf, { checkId }))!;
    const keys: string[] = await ctx.runQuery(internal.paperSets.libraryKeys.slice, { job, part: source.part, offset: from - source.first, count: to - from + 1 });
    const papers: SearchPaper[] = keys.length ? await ctx.runAction(internal.evidenceLibraries.sourceActions.papers, { libraryId: set.libraryId, keys }) : [];
    return void (await give(papers, to - from + 1, to >= last));
  }
  if (set.kind === "zotero") {
    type Page = { papers: Array<{ key: string; paper: string; title: string; abstract?: string; authors: string[]; year?: number; doi?: string; venue?: string; workType?: string; pdfUrl: string }>; ended: boolean };
    const page = (collectionKey: string | undefined, first: number): Promise<Page> => ctx.runAction(internal.zotero.actions.papersOf, { userId: source.userId, ...(collectionKey ? { collectionKey } : {}), ...(set.groupId ? { groupId: set.groupId } : {}), first, last: first + ZOTERO_LIST_PAGE - 1 });
    const asPapers = (read: Page): Array<SearchPaper & { key: string }> => read.papers.map(({ key, paper, title, abstract, authors, year, doi, venue, workType, pdfUrl }) => ({ key, paper, title, pdfUrl, ...(workType ? { workType } : {}), authors: authors.slice(0, MAX_AUTHORS), ...(abstract ? { abstract } : {}), ...(year === undefined ? {} : { publicationYear: year }), ...(doi ? { doi } : {}), ...(venue ? { venue } : {}) }));
    // An item Zotero holds no abstract for is screened as the PDF attached to it, where it has one: the file is fetched as its adder, for the items this screening doesn't have yet.
    const withFiles = async (read: Array<SearchPaper & { key: string }>): Promise<SearchPaper[]> => {
      const bare = read.filter((one) => !one.abstract?.trim());
      const fresh: string[] = bare.length ? await ctx.runQuery(internal.screening.gathering.lacking, { checkId, papers: bare.map((one) => one.paper) }) : [];
      const files: Array<{ key: string; file: Id<"_storage">; pages: number; shape?: number }> = fresh.length ? await ctx.runAction(internal.zotero.actions.pdfsOf, { userId: source.userId, ...(set.groupId ? { groupId: set.groupId } : {}), itemKeys: [...new Set(bare.filter((one) => fresh.includes(one.paper)).map((one) => one.key))] }) : [];
      return read.map(({ key, ...paper }) => { const own = files.find((one) => one.key === key); return own ? { ...paper, file: own.file, pages: own.pages, ...(own.shape ? { shape: own.shape } : {}) } : paper; });
    };
    // A step's papers go to `fill` a step of an index's at a time, the reading's end with the last of them.
    // Where the reading goes on is kept with the last of them only: one cut short before that reads these collections again, and the papers it gave already are passed over.
    const hand = async (papers: SearchPaper[], ended: boolean, resume?: string) => {
      for (let at = 0; at === 0 || at < papers.length; at += READ_STEP) {
        const lastOne = at + READ_STEP >= papers.length;
        await give(papers.slice(at, at + READ_STEP), Math.min(READ_STEP, papers.length - at), ended && lastOne, lastOne ? resume : source.resume);
      }
    };
    const room = last - from + 1;
    /** How many of these papers one step takes: as far as the room left, and no more with no abstract than one call fetches the PDFs of. */
    const within = (papers: Array<{ key: string; abstract?: string }>) => {
      // An item filed in two of the collections read at once is one PDF to fetch.
      const bare = new Set<string>();
      const cut = papers.findIndex((one) => !one.abstract?.trim() && bare.add(one.key).size > ZOTERO_PDFS_A_CALL);
      return Math.min(room, cut === -1 ? papers.length : cut);
    };
    // The collections still to read, in a line. One is a collection's key, or a key with where the list of the collections inside it goes on, for one that has more of them than a page.
    // `skip`: the papers before the range's first, across the whole tree in the order it is read, still to pass over.
    type Waiting = string | [key: string, inside: string];
    const deep: { keys: Waiting[]; at: number; skip?: number } | null = set.deep && source.resume ? JSON.parse(source.resume) : null;
    if (deep) {
      if (!deep.keys.length) return void (await give([], 0, true));
      const library = { userId: source.userId, ...(set.groupId ? { groupId: set.groupId } : {}) };
      const front = deep.keys.slice(0, ZOTERO_AT_ONCE).map((one) => (typeof one === "string" ? { key: one, inside: null, own: true } : { key: one[0], inside: one[1], own: false }));
      // The next ones are read at once, each from its own start, and an empty one is asked nothing. They are taken in their order as far as the first that has more than a page: that one is read on in the next step, and the ones after it again.
      const kept: Array<{ items: number } | null> = await Promise.all(front.map((one) => (one.own ? ctx.runQuery(internal.zotero.tree.one, { ...library, key: one.key }) : null)));
      const reads = await Promise.all(front.map((one, at): Promise<Page> => (one.own && kept[at]?.items ? page(one.key, (at === 0 ? deep.at : 0) + 1) : Promise.resolve({ papers: [], ended: true }))));
      const open = reads.findIndex((read) => !read.ended);
      const pages = (open === -1 ? reads : reads.slice(0, open + 1)).map(asPapers);
      const all = pages.flat();
      const skip = Math.min(deep.skip ?? 0, all.length);
      const taking = skip + within(all.slice(skip));
      // Where this step stops short of a collection's end: at the end of a page of one that has more, or part way into a page, where the step holds all the papers with no abstract it takes.
      let stop = open === -1 ? null : { at: open, read: ZOTERO_LIST_PAGE };
      if (taking < all.length) {
        let [at, read] = [0, taking];
        while (read >= pages[at]!.length) read -= pages[at++]!.length;
        stop = { at, read };
      }
      const papers = await withFiles(all.slice(skip, taking));
      // A collection read to its end hands on to the ones inside it, which join the end of the line.
      const ended = stop ? front.slice(0, stop.at) : front;
      const under: Array<{ page: Array<{ key: string }>; isDone: boolean; continueCursor: string }> = await Promise.all(ended.map((one) => ctx.runQuery(internal.zotero.tree.inside, { ...library, parent: one.key, paginationOpts: { cursor: one.inside, numItems: ZOTERO_LIST_PAGE } })));
      const joining = under.flatMap((found, at): Waiting[] => [...found.page.map((one) => one.key), ...(found.isDone ? [] : [[ended[at]!.key, found.continueCursor] as [string, string]])]);
      const next = { keys: [...deep.keys.slice(ended.length), ...joining], at: stop ? (stop.at === 0 ? deep.at : 0) + stop.read : 0, ...(deep.skip && deep.skip > skip ? { skip: deep.skip - skip } : {}) };
      return void (await hand(papers, !next.keys.length || papers.length >= room, JSON.stringify(next)));
    }
    // A library or one collection is read by its papers' places in it, several pages at once: each is asked for by where it starts, so they come back in order.
    const starts = Array.from({ length: Math.min(ZOTERO_AT_ONCE, Math.ceil(room / ZOTERO_LIST_PAGE)) }, (_, at) => from + at * ZOTERO_LIST_PAGE);
    const reads = await Promise.all(starts.map((first) => page(set.collectionKey, first)));
    const ends = reads.findIndex((read) => read.ended);
    const all = (ends === -1 ? reads : reads.slice(0, ends + 1)).flatMap(asPapers);
    const papers = await withFiles(all.slice(0, within(all)));
    return void (await hand(papers, (ends !== -1 && papers.length === all.length) || papers.length >= room));
  }
  if (set.kind === "collection" || set.kind === "saved" || set.kind === "screening") {
    const { papers, resume } = await heldPapers(ctx, reader, set, { first: from, last: to }, source.resume);
    return void (await give(papers, to - from + 1, !resume || to >= last, resume));
  }
  throw new Error(`No reading for a source of this kind: ${set.kind}`);
}

/** Which of these papers, by their keys, the screening a check is of doesn't have yet. */
export const lacking = internalQuery({
  args: { checkId: v.id("screeningChecks"), papers: v.array(v.string()) },
  returns: v.array(v.string()),
  handler: async (ctx, { checkId, papers }) => {
    const jobId = (await ctx.db.get("screeningChecks", checkId))?.jobId;
    if (!jobId) return [];
    const held = await Promise.all(papers.slice(0, READ_STEP * ZOTERO_AT_ONCE).map((paperKey) => ctx.db.query("screeningResults").withIndex("by_job_paperKey", (q) => q.eq("jobId", jobId).eq("paperKey", paperKey)).first()));
    return papers.filter((_, at) => !held[at]);
  },
});

/** The screening a check is of. */
export const jobOf = internalQuery({
  args: { checkId: v.id("screeningChecks") },
  returns: v.union(v.id("screeningJobs"), v.null()),
  handler: async (ctx, { checkId }) => (await ctx.db.get("screeningChecks", checkId))?.jobId ?? null,
});

type PaperInput = Infer<typeof screeningPaperInputValidator>;
/** Papers of one title and year looked at for the one a record is: versions of a paper share them, and seldom more than a few do. */
const SAME_TITLE = 5;

/** The paper of a screening that a record is, if it has it already: by its key, then its DOI, then its title and year where one of the two has no DOI. */
async function twinOf(ctx: Pick<MutationCtx, "db">, jobId: Id<"screeningJobs">, paper: { paperKey: string; doiKey?: string; titleKey: string }) {
  const byKey = await ctx.db.query("screeningResults").withIndex("by_job_paperKey", (q) => q.eq("jobId", jobId).eq("paperKey", paper.paperKey)).first();
  if (byKey) return byKey;
  const doiKey = paper.doiKey;
  const byDoi = doiKey ? await ctx.db.query("screeningResults").withIndex("by_job_and_doiKey", (q) => q.eq("jobId", jobId).eq("doiKey", doiKey)).first() : null;
  if (byDoi) return byDoi;
  // Two records with different DOIs are never merged on their title: a preprint and its article share one.
  const titled = await ctx.db.query("screeningResults").withIndex("by_job_and_titleKey", (q) => q.eq("jobId", jobId).eq("titleKey", paper.titleKey)).take(SAME_TITLE);
  return titled.find((one) => !doiKey || !one.doiKey) ?? null;
}

/**
 * Gives a check a step of one source's papers: `read` of the source's papers, and where it goes on after them. A
 * record with no title is left out, with why, and so is one with no abstract unless it comes with its own PDF: a
 * screening reads a title and an abstract, or the paper itself. A paper
 * another source already brought is counted as merged, and one this source brought before is passed over. One whose
 * source was since taken out comes back as this source's. The rest take the next places in the round and go to their
 * reviewers.
 */
export const fill = internalMutation({
  args: { checkId: v.id("screeningChecks"), sourceId: v.id("screeningSources"), /** The reading of the source this step belongs to: one from before the source was changed takes nothing in. */ pass: v.number(), papers: v.array(screeningPaperInputValidator), read: v.number(), resume: v.optional(v.string()), ended: v.boolean(), /** The screening is full before this source gave anything: it stops as one that met the cap. */ full: v.optional(v.boolean()), /** What the source's own reading left out before any paper was made of it: a DOI nothing is known of, a file that doesn't open. */ leftOut: v.optional(v.array(v.object({ name: v.string(), why: leftOutWhyValidator, key: v.optional(v.string()) }))) },
  returns: v.null(),
  handler: async (ctx, { checkId, sourceId, pass: reading, papers, read, resume, ended, full, leftOut }) => {
    const [check, source] = await Promise.all([ctx.db.get("screeningChecks", checkId), ctx.db.get("screeningSources", sourceId)]);
    // A source taken out while its reading was out takes nothing in: its papers would arrive after it left. Nor does an earlier reading of one changed since.
    const job = check?.state === "running" && source?.state === "reading" && source.removedAt === undefined && (source.pass ?? 0) === reading ? await ctx.db.get("screeningJobs", check.jobId) : null;
    if (!check || !source || !job) return null;
    const reviewers = await reviewersOf(ctx, job._id);
    const reads = await readsOf(ctx, reviewers);
    const dealt = new Map<Id<"screeningReviewers">, number>();
    const now = Date.now();
    let [taken, duplicates, left, bare, back, filed, filePages] = [0, 0, 0, 0, 0, 0, 0];
    const fileSpread = { ...source.fileSpread };
    // The most papers the workspace's plan gives one screening: past it, a source's reading stops, and says so.
    const most = await papersLimit(ctx, job.workspaceId);
    // The papers of sources taken out leave room for others: the limit counts the papers the screening has now (`present`).
    const gone = (await progressRow(ctx, job._id))?.withdrawn ?? 0;
    let capped = full === true;
    // This reading of the source: each time it is read from its start is a pass of its own (./dealing.ts `readAgain`).
    const pass = source.pass ?? 0;
    // A record a reading still going meets again keeps the last whole reading that met it: the source's lists show that one until this one is whole (./view.ts `leftOut`, `merged`).
    const metAgain = (was: { pass?: number; before?: number }) => ({ pass, before: (was.pass ?? 0) <= (source.next?.from ?? pass) ? was.pass ?? 0 : was.before });
    const leave = async (name: string, why: Why, paperKey?: string) => {
      const was = paperKey ? await ctx.db.query("screeningLeftOut").withIndex("by_source_and_paperKey", (q) => q.eq("sourceId", sourceId).eq("paperKey", paperKey)).first() : null;
      // A source that holds a paper twice, as a Zotero library does one filed in two collections, leaves it out once in one reading.
      if (was?.pass === pass) return;
      left++;
      if (why === "abstract") bare++;
      // A later reading finds what an earlier one left out: counted again, and named once, with why as it is now.
      if (was) await ctx.db.patch("screeningLeftOut", was._id, { ...metAgain(was), why });
      else await ctx.db.insert("screeningLeftOut", { jobId: job._id, sourceId, pass, name: name.slice(0, 300), why, ...(paperKey ? { paperKey } : {}) });
    };
    /**
     * Keeps a record the screening already has, with the paper it was merged into, and says whether it counts. A
     * source can meet a record twice in a reading, as Zotero does an item filed in two collections, and a step that
     * was cut short gives its records again: that is one record, counted once.
     */
    const merge = async (name: string, into: Id<"screeningResults">, paperKey: string) => {
      const was = await ctx.db.query("screeningMerged").withIndex("by_source_and_paperKey", (q) => q.eq("sourceId", sourceId).eq("paperKey", paperKey)).first();
      if (was?.pass === pass) return false;
      if (was) await ctx.db.patch("screeningMerged", was._id, { ...metAgain(was), into, name: name.slice(0, 300) });
      else await ctx.db.insert("screeningMerged", { jobId: job._id, sourceId, pass, name: name.slice(0, 300), into, paperKey });
      return true;
    };
    for (const one of leftOut ?? []) await leave(one.name, one.why, one.key);
    // Where its papers go: after every paper the screening has, whichever look placed them, so two looks never share a place.
    const start = Math.max(job.totalPapers, check.from + check.added, await nextPlace(ctx, job._id));
    for (const sent of papers) {
      const paper: PaperInput = { ...sent, paper: requirePaperKey(sent.paper) };
      const title = paper.title.trim();
      // What names the record in its source: a file's record is its own whichever paper it is, any other source's is its paper.
      const named = paper.record ?? paper.paper;
      if (!title) { await leave(paper.doi ?? "A record with no title", "title", named); continue; }
      const abstract = paper.abstract?.trim() ? unglued(paper.abstract) : undefined;
      const identity = identityOf(parsePaperKey(paper.paper)!, { openalexId: paper.crossRefs?.openalexId, doi: paper.doi ?? paper.crossRefs?.doi });
      const keys = { paperKey: identity.paperKey, doiKey: doiKeyOf(paper.doi ?? paper.crossRefs?.doi), titleKey: titleKeyOf(title, paper.publicationYear) };
      // It finds the papers this step already took too: a mutation reads what it wrote.
      const twin = await twinOf(ctx, job._id, keys);
      // The papers the screening has now: every one it took, less those taken out, with any brought back in this step. Bringing one back takes room as a new one does.
      const present = start + taken - gone + back;
      if (twin?.withdrawn) {
        if (present >= most) { capped = true; break; }
        // Its source was taken out, and this one holds it too: it comes back as this source's paper, in the place it had, with the votes cast on it. The worker gives its open places out again.
        await ctx.db.patch("screeningResults", twin._id, { withdrawn: undefined, sourceId, record: paper.record, doneAt: ctx.db.vars.commitTs });
        back++;
        continue;
      }
      if (twin) {
        // The first source added keeps the paper: one another source holds is a duplicate merged, and so is one a file lists again under another of its records. A source read again finds its own papers, which are neither new nor merged: a file's by the record each was made from, any other's by its key.
        // A paper kept before its source named records is told by its paper alone.
        const own = twin.sourceId === sourceId && (paper.record === undefined || twin.record === undefined ? twin.paperKey === identity.paperKey : twin.record === paper.record);
        if (!own && (await merge(title, twin._id, named))) duplicates++;
        // A paper already excluded, met in a collection read since, leaves it too where the screening takes excluded papers out: it would otherwise stay there for good, as its result never changes again.
        if (!own && job.prune && twin.result === "exclude" && !twin.withdrawn) {
          const source = await ctx.db.get("screeningSources", sourceId);
          if (source && source.set.kind !== "upload" && source.set.kind !== "pdf" && source.set.kind !== "dois") {
            const moved = await shelve(ctx, job, twin, { becameIncluded: false, left: true }, [{ set: source.set, paperKey: paper.paper }], { met: true });
            const progress = moved.removed ? await progressRow(ctx, job._id) : null;
            if (progress) await ctx.db.patch("screeningJobProgress", progress._id, withMoved(progress, moved));
          }
        }
        // A paper kept before its source named records takes the record it is met by now: a second record of its work met later is then a duplicate merged, as it is for a paper kept since.
        if (own && paper.record && twin.record === undefined) await ctx.db.patch("screeningResults", twin._id, { record: paper.record });
        continue;
      }
      // A paper the screening already holds is passed over above, whatever it now lacks: an abstract that a lookup failed to bring this time leaves out only a paper that is new.
      if (!abstract && !paper.file) { await leave(title, "abstract", named); continue; }
      const place = start + taken;
      if (present >= most) { capped = true; break; }
      const resultId = await ctx.db.insert("screeningResults", {
        ...sourceMetadata(paper),
        jobId: job._id,
        ...identity,
        title,
        ...(abstract ? { abstract } : {}),
        ...(paper.file ? { file: paper.file, ...(paper.pages === undefined ? {} : { pages: paper.pages }), ...(paper.shape === undefined ? {} : { shape: paper.shape }) } : {}),
        ...(paper.fileName ? { fileName: paper.fileName.slice(0, SCREENING_TEXT.name) } : {}),
        ...(paper.record ? { record: paper.record } : {}),
        authors: paper.authors?.slice(0, MAX_AUTHORS),
        publicationYear: paper.publicationYear,
        doi: paper.doi,
        venue: paper.venue,
        citedByCount: paper.citedByCount,
        searchText: searchTextOf(paper),
        // Read by nothing in a screening with reviewers: kept until the old fields go.
        status: "completed",
        createdAt: now,
        sourceId,
        checkId,
        place,
        result: "waiting",
        ...(keys.doiKey ? { doiKey: keys.doiKey } : {}),
        titleKey: keys.titleKey,
      });
      await dealNew(ctx, job, { _id: resultId, place, abstract, file: paper.file, pages: paper.pages }, reviewers, reads, dealt);
      taken++;
      if (!abstract) {
        filed++;
        filePages += paper.pages ?? 0;
        const band = fileSpread[pdfBand(paper.pages ?? 0)];
        if (paper.pages) fileSpread[pdfBand(paper.pages)] = { papers: (band?.papers ?? 0) + 1, pages: (band?.pages ?? 0) + paper.pages, most: Math.max(band?.most ?? 0, paper.pages) };
      }
    }
    // The screening's count of papers moves on with the papers, in the step that places them: a look that stops halfway leaves it true, and the next takes the places after.
    if (taken) await ctx.db.patch("screeningJobs", job._id, { totalPapers: start + taken });
    if (back) await bookkeepLater(ctx);
    // A first reading counts as it goes. One read again counts beside the figures it has, and takes their place once it is whole.
    const next = source.next && { ...source.next, duplicates: source.next.duplicates + duplicates, left: source.next.left + left, bare: source.next.bare + bare };
    // A reading stopped by a full screening before it gave anything leaves the source as its last whole reading left it, figures and lists: it read nothing that would replace them.
    const counted = full ? {} : !next ? { duplicates: source.duplicates + duplicates, left: source.left + left, ...(bare ? { bare: (source.bare ?? 0) + bare } : {}) } : ended || capped ? { duplicates: next.duplicates, left: next.left, bare: next.bare, next: undefined } : { next };
    await ctx.db.patch("screeningSources", sourceId, { read: source.read + read, resume, taken: source.taken + taken + back, ...counted, ...(filed ? { filed: (source.filed ?? 0) + filed, filePages: (source.filePages ?? 0) + filePages, fileSpread } : {}), ...(ended || capped ? { state: "done" as const, checkedAt: now } : {}), ...(capped ? { capped: true as const } : {}) });
    // Papers brought back with this source are counted apart from the new ones, which take new places: a finished screening they wait in opens again all the same (./living.ts `checked`).
    await ctx.db.patch("screeningChecks", checkId, { found: check.found + papers.length + (leftOut?.length ?? 0), added: check.added + taken, ...(back ? { restored: (check.restored ?? 0) + back } : {}), ...(left ? { left: (check.left ?? 0) + left } : {}), beat: now, ...(taken ? { bySource: { ...check.bySource, [sourceId]: (check.bySource?.[sourceId] ?? 0) + taken } } : {}), ...((ended || capped) && check.unread?.includes(sourceId) ? { unread: check.unread.filter((one) => one !== sourceId) } : {}) });
    await countDealt(ctx, dealt);
    if (taken && reviewers.some((one) => one.kind === "model" && one.left === undefined)) await startWaitingVotes(ctx, job.workspaceId);
    return null;
  },
});

/** A check ends once every source is read: its count stands, and a living screening's next check is set. */
export const end = internalMutation({
  args: { checkId: v.id("screeningChecks") },
  returns: v.null(),
  handler: async (ctx, { checkId }) => {
    const check = await ctx.db.get("screeningChecks", checkId);
    if (check?.state !== "running") return null;
    // A source added while the last one was read waits for this look: the look reads on rather than end without it.
    if ((await sourcesOf(ctx, check.jobId)).some((source) => source.removedAt === undefined && (source.state === "waiting" || source.state === "reading"))) return void (await ctx.scheduler.runAfter(0, internal.screening.gathering.gather, { checkId }));
    const job = await ctx.db.get("screeningJobs", check.jobId);
    // The sources it couldn't read were counted on it as each failed (`fail`), so nothing reads it as a check that found nothing new.
    await ctx.db.patch("screeningChecks", checkId, { state: "done", endedAt: Date.now() });
    if (!job) return null;
    await ctx.db.patch("screeningJobs", job._id, { reading: undefined, totalPapers: Math.max(job.totalPapers, await nextPlace(ctx, job._id)), ...touched() });
    await ctx.scheduler.runAfter(0, internal.paperSets.libraryKeys.drop, { job: job._id });
    await checked(ctx, job, check);
    return null;
  },
});

/**
 * The watch on a check's reading. A reading action hands on to the next every few minutes, and one cut short by the
 * backend stopping records nothing: a check that has gone quiet is set off again from where its sources stand, a
 * few times, and then left as failed.
 */
export const watch = internalMutation({
  args: { checkId: v.id("screeningChecks"), restarts: v.number() },
  returns: v.null(),
  handler: async (ctx, { checkId, restarts }) => {
    const check = await ctx.db.get("screeningChecks", checkId);
    if (check?.state !== "running") return null;
    const quiet = Date.now() - (check.beat ?? check.at);
    if (quiet < QUIET_MS) return void (await ctx.scheduler.runAfter(QUIET_MS - quiet, internal.screening.gathering.watch, { checkId, restarts }));
    if (restarts >= RESTARTS) {
      // Its sources left part read fail with it, so each offers Read again: none waits on a look that has stopped.
      const stuck = (await sourcesOf(ctx, check.jobId)).filter((source) => source.removedAt === undefined && (source.state === "waiting" || source.state === "reading"));
      for (const source of stuck) await ctx.db.patch("screeningSources", source._id, { state: "failed", failure: "Reading this source stopped part way. Read it again to go on from where it stopped." });
      await ctx.db.patch("screeningChecks", checkId, { state: "failed", endedAt: Date.now(), unread: [...new Set([...(check.unread ?? []), ...stuck.map((source) => source._id)])].slice(-MAX_SOURCE_ROWS) });
      await ctx.db.patch("screeningJobs", check.jobId, { reading: undefined, ...touched() });
      return null;
    }
    await ctx.scheduler.runAfter(0, internal.screening.gathering.gather, { checkId });
    await ctx.scheduler.runAfter(QUIET_MS, internal.screening.gathering.watch, { checkId, restarts: restarts + 1 });
    return null;
  },
});
