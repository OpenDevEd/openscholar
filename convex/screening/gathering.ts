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
import { normalDoi, parsePaperKey } from "../../lib/papers/paper-ref";
import { keepLibraryKeys, resolveLibraryKeys } from "../evidenceLibraries/sources";
import { requirePaperKey } from "../library/find";
import { heldPapers } from "../paperSets/held";
import { countSearch, numbered, PAGE_SIZE, searchSnapshotValidator, type SearchSnapshot } from "../paperSets/openalex";
import { searchPapers, snapshotOf, spender, type SavedSearchRequest, type SearchPaper } from "../paperSets/search";
import { actorIn } from "../workspaces/actor";
import { ZOTERO_AT_ONCE, ZOTERO_LIST_PAGE } from "../zotero/libraryValidators";
import { bookkeepLater } from "./bookkeeping";
import { countDealt, dealNew, reviewersOf, sourcesOf, touched } from "./dealing";
import { checked } from "./living";
import { unglued } from "../../lib/papers/abstract-sections";
import { planLimit } from "../billing/accounts";
import { papersIn } from "./estimate";
import { plainTitle } from "../../lib/screening/files";
import { handedPapers, handedStart, type LeftOut } from "./held";
import { searchTextOf } from "./mutations";
import { startWaitingVotes } from "./slots";
import { leftOutWhyValidator, screeningPaperInputValidator, sourceSetValidator } from "./validators";

type SourceSet = Infer<typeof sourceSetValidator>;
type Why = Infer<typeof leftOutWhyValidator>;

/** Papers one step takes: up to the end of one of OpenAlex's pages, so no page is asked for twice. */
const READ_STEP = PAGE_SIZE;
/** How long one reading action reads before it hands on to the next: well inside an action's ten minutes. */
const READ_ACTION_MS = 4 * 60_000;
/** How long a check may go without a step before its reading is set off again, and how often that is tried before it is left as failed. */
const QUIET_MS = 15 * 60_000;
const RESTARTS = 3;
/** How long a check waits before it looks again at PDFs whose first reading hasn't ended. */
const PDFS_WAIT_MS = 3_000;
/** How much of why a source couldn't be read is kept. */
const FAILURE_SHOWN = 600;

/** What makes two records one paper where their sources name them differently: the DOI, then the title with the year. */
export const doiKeyOf = (doi: string | undefined | null) => normalDoi(doi) ?? undefined;
export const titleKeyOf = (title: string, year: number | undefined) => `${plainTitle(title)}|${year ?? ""}`;

type Reading = { gone?: true; sourceId: Id<"screeningSources">; part: number; set: SourceSet; first: number; last?: number; read: number; resume?: string; snapshot?: SearchSnapshot; state: "waiting" | "reading"; total?: number; userId: Id<"users">; workspaceId: Id<"workspaces"> };

/** The next of a check's sources that still has papers to read, with where its reading stands. Null once every source is read, or the check has ended. */
export const next = internalQuery({
  args: { checkId: v.id("screeningChecks") },
  returns: v.union(v.null(), v.object({ sourceId: v.id("screeningSources"), part: v.number(), set: sourceSetValidator, first: v.number(), last: v.optional(v.number()), read: v.number(), resume: v.optional(v.string()), snapshot: v.optional(searchSnapshotValidator), state: v.union(v.literal("waiting"), v.literal("reading")), total: v.optional(v.number()), userId: v.id("users"), workspaceId: v.id("workspaces"), gone: v.optional(v.literal(true)) })),
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
    return { ...(gone ? { gone: true as const } : {}), sourceId: source._id, part, set: source.set, first: source.first ?? 1, ...(source.last === undefined ? {} : { last: source.last }), read: source.read, ...(source.resume ? { resume: source.resume } : {}), ...(source.snapshot ? { snapshot: source.snapshot } : {}), state: source.state as "waiting" | "reading", ...(source.total === undefined ? {} : { total: source.total }), userId: source.addedBy, workspaceId: source.workspaceId ?? job.workspaceId };
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
  args: { sourceId: v.id("screeningSources"), total: v.optional(v.number()), snapshot: v.optional(searchSnapshotValidator), resume: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { sourceId, total, snapshot, resume }) => {
    const source = await ctx.db.get("screeningSources", sourceId);
    if (source?.state === "waiting") await ctx.db.patch("screeningSources", sourceId, { state: "reading", ...(total === undefined ? {} : { total }), ...(snapshot ? { snapshot } : {}), ...(resume ? { resume } : {}) });
    return null;
  },
});

/** A source that couldn't be read is left as failed, with why in words for the person, and the check goes on to the next. */
export const fail = internalMutation({
  args: { sourceId: v.id("screeningSources"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, { sourceId, reason }) => {
    await ctx.db.patch("screeningSources", sourceId, { state: "failed", failure: reason.slice(0, FAILURE_SHOWN) });
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
        // Its next PDFs are still being read for the first time: the check comes back for them, and is not taken for one gone quiet.
        if ((await step(ctx, checkId, source)) === "wait") {
          await ctx.runMutation(internal.screening.gathering.beat, { checkId });
          return void (await ctx.scheduler.runAfter(PDFS_WAIT_MS, internal.screening.gathering.gather, { checkId }));
        }
      } catch (error) {
        console.error(`[screening] Source ${source.sourceId} couldn't be read`, error);
        await ctx.runMutation(internal.screening.gathering.fail, { sourceId: source.sourceId, reason: readConvexErrorData(error)?.message ?? "Its papers couldn't be read." });
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
  const give = (papers: SearchPaper[], read: number, ended: boolean, resume?: string, leftOut?: LeftOut[]) => ctx.runMutation(internal.screening.gathering.fill, { checkId, sourceId, papers, read, ended, ...(resume ? { resume } : {}), ...(leftOut?.length ? { leftOut } : {}) });
  const held = set.kind === "upload" || set.kind === "dois" || set.kind === "pdf" ? { ...source, set } : null;
  if (source.state === "waiting") {
    // A file, a pasted list or PDFs: what it holds is counted from the file itself.
    if (held) return void (await ctx.runMutation(internal.screening.gathering.begin, { sourceId, ...(await handedStart(ctx, held)) }));
    // What it holds is counted once, before its first paper: a search as it is now, a community's source as the person may read it.
    if (set.kind === "search") {
      const found: SavedSearchRequest = await ctx.runQuery(internal.paperSets.search.readSearch, { ...reader, searchId: set.searchId });
      const snapshot = snapshotOf(found);
      return void (await ctx.runMutation(internal.screening.gathering.begin, { sourceId, snapshot, total: await countSearch(snapshot.request, spender(ctx, found.clerkId)) }));
    }
    if (set.kind === "evidenceLibrary") {
      const keys = await resolveLibraryKeys(ctx, { libraryId: set.libraryId, userId: source.userId, source: set.source, first: source.first, last: source.last ?? Number.MAX_SAFE_INTEGER });
      await keepLibraryKeys(ctx, (await ctx.runQuery(internal.screening.gathering.jobOf, { checkId }))!, keys, { part: source.part });
      return void (await ctx.runMutation(internal.screening.gathering.begin, { sourceId, total: source.first - 1 + keys.length }));
    }
    // With the collections under it: the library's collections are kept as rows (../zotero/tree.ts), and the check comes back while they are still being read. `resume` keeps the collections still to read, this one first, and how far into the first the reading is. What it holds with everything under it is what Zotero counts in each, so a paper filed in two of them is counted twice until it is read.
    if (set.kind === "zotero" && set.deep && set.collectionKey) {
      const library = { userId: source.userId, ...(set.groupId ? { groupId: set.groupId } : {}) };
      if (!(await ctx.runMutation(internal.zotero.tree.ready, library))) return "wait";
      const root: { under: number } | null = await ctx.runQuery(internal.zotero.tree.one, { ...library, key: set.collectionKey });
      return void (await ctx.runMutation(internal.screening.gathering.begin, { sourceId, ...(root ? { total: root.under } : {}), resume: JSON.stringify({ keys: [set.collectionKey], at: 0 }) }));
    }
    const total: number | null = await ctx.runQuery(internal.screening.gathering.heldTotal, { ...reader, set });
    return void (await ctx.runMutation(internal.screening.gathering.begin, { sourceId, ...(total === null ? {} : { total }) }));
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
    const { papers, ended, resume, taken } = await searchPapers(ctx, reader, { searchId: set.searchId, first: from, last: to }, source.snapshot, paged ? { goesOn: false } : { resume: source.resume, goesOn: true });
    const read = paged ? to - from + 1 : taken;
    return void (await give(papers, read, ended || from + read > last, resume));
  }
  if (set.kind === "evidenceLibrary") {
    const job = (await ctx.runQuery(internal.screening.gathering.jobOf, { checkId }))!;
    const keys: string[] = await ctx.runQuery(internal.paperSets.libraryKeys.slice, { job, part: source.part, offset: from - source.first, count: to - from + 1 });
    const papers: SearchPaper[] = keys.length ? await ctx.runAction(internal.evidenceLibraries.sourceActions.papers, { libraryId: set.libraryId, keys }) : [];
    return void (await give(papers, to - from + 1, to >= last));
  }
  if (set.kind === "zotero") {
    type Page = { papers: Array<{ key: string; paper: string; title: string; abstract?: string; authors: string[]; year?: number; doi?: string; venue?: string; pdfUrl: string }>; ended: boolean };
    const page = (collectionKey: string | undefined, first: number): Promise<Page> => ctx.runAction(internal.zotero.actions.papersOf, { userId: source.userId, ...(collectionKey ? { collectionKey } : {}), ...(set.groupId ? { groupId: set.groupId } : {}), first, last: first + ZOTERO_LIST_PAGE - 1 });
    const asPapers = (read: Page): Array<SearchPaper & { key: string }> => read.papers.map(({ key, paper, title, abstract, authors, year, doi, venue, pdfUrl }) => ({ key, paper, title, pdfUrl, authors: authors.slice(0, MAX_AUTHORS), ...(abstract ? { abstract } : {}), ...(year === undefined ? {} : { publicationYear: year }), ...(doi ? { doi } : {}), ...(venue ? { venue } : {}) }));
    // An item Zotero holds no abstract for is screened as the PDF attached to it, where it has one: the file is fetched as its adder, for the items this screening doesn't have yet.
    const withFiles = async (read: Array<SearchPaper & { key: string }>): Promise<SearchPaper[]> => {
      const bare = read.filter((one) => !one.abstract?.trim());
      const fresh: string[] = bare.length ? await ctx.runQuery(internal.screening.gathering.lacking, { checkId, papers: bare.map((one) => one.paper) }) : [];
      const files: Array<{ key: string; file: Id<"_storage">; pages: number }> = fresh.length ? await ctx.runAction(internal.zotero.actions.pdfsOf, { userId: source.userId, ...(set.groupId ? { groupId: set.groupId } : {}), itemKeys: bare.filter((one) => fresh.includes(one.paper)).map((one) => one.key) }) : [];
      return read.map(({ key, ...paper }) => { const own = files.find((one) => one.key === key); return own ? { ...paper, file: own.file, pages: own.pages } : paper; });
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
    // The collections still to read, in a line. One is a collection's key, or a key with where the list of the collections inside it goes on, for one that has more of them than a page.
    type Waiting = string | [key: string, inside: string];
    const deep: { keys: Waiting[]; at: number } | null = set.deep && source.resume ? JSON.parse(source.resume) : null;
    if (deep) {
      if (!deep.keys.length) return void (await give([], 0, true));
      const library = { userId: source.userId, ...(set.groupId ? { groupId: set.groupId } : {}) };
      const front = deep.keys.slice(0, ZOTERO_AT_ONCE).map((one) => (typeof one === "string" ? { key: one, inside: null, own: true } : { key: one[0], inside: one[1], own: false }));
      // The next ones are read at once, each from its own start, and an empty one is asked nothing. They are taken in their order as far as the first that has more than a page: that one is read on in the next step, and the ones after it again.
      const kept: Array<{ items: number } | null> = await Promise.all(front.map((one) => (one.own ? ctx.runQuery(internal.zotero.tree.one, { ...library, key: one.key }) : null)));
      const reads = await Promise.all(front.map((one, at): Promise<Page> => (one.own && kept[at]?.items ? page(one.key, (at === 0 ? deep.at : 0) + 1) : Promise.resolve({ papers: [], ended: true }))));
      const open = reads.findIndex((read) => !read.ended);
      const papers = await withFiles((open === -1 ? reads : reads.slice(0, open + 1)).flatMap(asPapers).slice(0, room));
      // A collection read to its end hands on to the ones inside it, which join the end of the line.
      const ended = open === -1 ? front : front.slice(0, open);
      const under: Array<{ page: Array<{ key: string }>; isDone: boolean; continueCursor: string }> = await Promise.all(ended.map((one) => ctx.runQuery(internal.zotero.tree.inside, { ...library, parent: one.key, paginationOpts: { cursor: one.inside, numItems: ZOTERO_LIST_PAGE } })));
      const joining = under.flatMap((found, at): Waiting[] => [...found.page.map((one) => one.key), ...(found.isDone ? [] : [[ended[at]!.key, found.continueCursor] as [string, string]])]);
      const next = { keys: [...deep.keys.slice(ended.length), ...joining], at: open === -1 ? 0 : (open === 0 ? deep.at : 0) + ZOTERO_LIST_PAGE };
      return void (await hand(papers, !next.keys.length || papers.length >= room, JSON.stringify(next)));
    }
    // A library or one collection is read by its papers' places in it, several pages at once: each is asked for by where it starts, so they come back in order.
    const starts = Array.from({ length: Math.min(ZOTERO_AT_ONCE, Math.ceil(room / ZOTERO_LIST_PAGE)) }, (_, at) => from + at * ZOTERO_LIST_PAGE);
    const reads = await Promise.all(starts.map((first) => page(set.collectionKey, first)));
    const ends = reads.findIndex((read) => read.ended);
    const papers = await withFiles((ends === -1 ? reads : reads.slice(0, ends + 1)).flatMap(asPapers).slice(0, room));
    return void (await hand(papers, ends !== -1 || papers.length >= room));
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
  args: { checkId: v.id("screeningChecks"), sourceId: v.id("screeningSources"), papers: v.array(screeningPaperInputValidator), read: v.number(), resume: v.optional(v.string()), ended: v.boolean(), /** What the source's own reading left out before any paper was made of it: a DOI nothing is known of, a file that doesn't open. */ leftOut: v.optional(v.array(v.object({ name: v.string(), why: leftOutWhyValidator, key: v.optional(v.string()) }))) },
  returns: v.null(),
  handler: async (ctx, { checkId, sourceId, papers, read, resume, ended, leftOut }) => {
    const [check, source] = await Promise.all([ctx.db.get("screeningChecks", checkId), ctx.db.get("screeningSources", sourceId)]);
    const job = check?.state === "running" && source?.state === "reading" ? await ctx.db.get("screeningJobs", check.jobId) : null;
    if (!check || !source || !job) return null;
    const reviewers = await reviewersOf(ctx, job._id);
    const dealt = new Map<Id<"screeningReviewers">, number>();
    const now = Date.now();
    let [taken, duplicates, left, bare, back, filed, filePages] = [0, 0, 0, 0, 0, 0, 0];
    // The most papers the workspace's plan gives one screening: past it, a source's reading stops, and says so.
    const most = await planLimit(ctx, job.workspaceId, "request_papers");
    let capped = false;
    const leave = async (name: string, why: Why, paperKey?: string) => {
      left++;
      if (why === "abstract") bare++;
      // A check that reads a source again finds what it left out before: counted again, and named once.
      if (paperKey && (await ctx.db.query("screeningLeftOut").withIndex("by_source_and_paperKey", (q) => q.eq("sourceId", sourceId).eq("paperKey", paperKey)).first())) return;
      await ctx.db.insert("screeningLeftOut", { jobId: job._id, sourceId, name: name.slice(0, 300), why, ...(paperKey ? { paperKey } : {}) });
    };
    for (const one of leftOut ?? []) await leave(one.name, one.why, one.key);
    for (const sent of papers) {
      const paper: PaperInput = { ...sent, paper: requirePaperKey(sent.paper) };
      const title = paper.title.trim();
      if (!title) { await leave(paper.doi ?? "A record with no title", "title", paper.paper); continue; }
      if (!paper.abstract?.trim() && !paper.file) { await leave(title, "abstract", paper.paper); continue; }
      const abstract = paper.abstract?.trim() ? unglued(paper.abstract) : undefined;
      const identity = identityOf(parsePaperKey(paper.paper)!, { openalexId: paper.crossRefs?.openalexId, doi: paper.doi ?? paper.crossRefs?.doi });
      const keys = { paperKey: identity.paperKey, doiKey: doiKeyOf(paper.doi ?? paper.crossRefs?.doi), titleKey: titleKeyOf(title, paper.publicationYear) };
      // It finds the papers this step already took too: a mutation reads what it wrote.
      const twin = await twinOf(ctx, job._id, keys);
      if (twin?.withdrawn) {
        // Its source was taken out, and this one holds it too: it comes back as this source's paper, in the place it had, with the votes cast on it. The worker gives its open places out again.
        await ctx.db.patch("screeningResults", twin._id, { withdrawn: undefined, sourceId, doneAt: ctx.db.vars.commitTs });
        back++;
        continue;
      }
      if (twin) {
        // The first source added keeps the paper. One this source brought before, or holds twice, is neither new nor merged.
        if (twin.sourceId !== sourceId) duplicates++;
        continue;
      }
      const place = check.from + check.added + taken;
      if (typeof most === "number" && place >= most) { capped = true; break; }
      const resultId = await ctx.db.insert("screeningResults", {
        ...sourceMetadata(paper),
        jobId: job._id,
        ...identity,
        title,
        ...(abstract ? { abstract } : {}),
        ...(paper.file ? { file: paper.file, ...(paper.pages === undefined ? {} : { pages: paper.pages }) } : {}),
        // An index can list one author once for each of their affiliations.
        authors: paper.authors && [...new Set(paper.authors)].slice(0, MAX_AUTHORS),
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
      await dealNew(ctx, job, { _id: resultId, place }, reviewers, dealt);
      taken++;
      if (!abstract) { filed++; filePages += paper.pages ?? 0; }
    }
    if (back) await bookkeepLater(ctx);
    await ctx.db.patch("screeningSources", sourceId, { read: source.read + read, resume, taken: source.taken + taken + back, duplicates: source.duplicates + duplicates, left: source.left + left, ...(bare ? { bare: (source.bare ?? 0) + bare } : {}), ...(filed ? { filed: (source.filed ?? 0) + filed, filePages: (source.filePages ?? 0) + filePages } : {}), ...(ended || capped ? { state: "done" as const, checkedAt: now } : {}), ...(capped ? { capped: true as const } : {}) });
    await ctx.db.patch("screeningChecks", checkId, { found: check.found + papers.length, added: check.added + taken, beat: now });
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
    const job = await ctx.db.get("screeningJobs", check.jobId);
    await ctx.db.patch("screeningChecks", checkId, { state: "done", endedAt: Date.now() });
    if (!job) return null;
    await ctx.db.patch("screeningJobs", job._id, { reading: undefined, totalPapers: check.from + check.added, ...touched() });
    await ctx.scheduler.runAfter(0, internal.paperSets.libraryKeys.drop, { job: job._id });
    await checked(ctx, job, check);
    return null;
  },
});

/**
 * Has a screening that isn't started yet read the sources it was just given. They all belong to its first look: the
 * one it has goes on where it ended, so none of its papers counts as one a later check brought.
 */
export async function readOn(ctx: MutationCtx, job: Doc<"screeningJobs">, by: Id<"users">) {
  const check = await ctx.db.query("screeningChecks").withIndex("by_job", (q) => q.eq("jobId", job._id)).first();
  if (!check) return void (await startCheck(ctx, job, by, 0));
  if (check.state === "running") return;
  await ctx.db.patch("screeningChecks", check._id, { state: "running", endedAt: undefined, beat: Date.now() });
  await ctx.db.patch("screeningJobs", job._id, { reading: true });
  await ctx.scheduler.runAfter(0, internal.screening.gathering.gather, { checkId: check._id });
  await ctx.scheduler.runAfter(QUIET_MS, internal.screening.gathering.watch, { checkId: check._id, restarts: 0 });
}

/** Starts a look in a screening's sources: every source that isn't taken out is read again from where it stands. */
export async function startCheck(ctx: MutationCtx, job: Doc<"screeningJobs">, by: Id<"users"> | undefined, from: number) {
  const checkId = await ctx.db.insert("screeningChecks", { jobId: job._id, at: Date.now(), ...(by ? { by } : {}), state: "running", from, found: 0, added: 0, beat: Date.now() });
  await ctx.scheduler.runAfter(0, internal.screening.gathering.gather, { checkId });
  await ctx.scheduler.runAfter(QUIET_MS, internal.screening.gathering.watch, { checkId, restarts: 0 });
  return checkId;
}

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
      await ctx.db.patch("screeningChecks", checkId, { state: "failed", endedAt: Date.now() });
      await ctx.db.patch("screeningJobs", check.jobId, { reading: undefined, ...touched() });
      return null;
    }
    await ctx.scheduler.runAfter(0, internal.screening.gathering.gather, { checkId });
    await ctx.scheduler.runAfter(QUIET_MS, internal.screening.gathering.watch, { checkId, restarts: restarts + 1 });
    return null;
  },
});
