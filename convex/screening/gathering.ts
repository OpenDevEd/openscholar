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
import { readConvexErrorData } from "../lib/errors";
import { identityOf } from "../lib/paperRef";
import { MAX_AUTHORS } from "../lib/listCaps";
import { sourceMetadata } from "../../lib/library/paper-metadata";
import { normalDoi, parsePaperKey } from "../../lib/papers/paper-ref";
import { keepLibraryKeys, resolveLibraryKeys } from "../evidenceLibraries/sources";
import { requirePaperKey } from "../library/find";
import { heldPapers } from "../paperSets/held";
import { countSearch, numbered, PAGE_SIZE, searchSnapshotValidator, type SearchSnapshot } from "../paperSets/openalex";
import { searchPapers, snapshotOf, spender, type SavedSearchRequest, type SearchPaper } from "../paperSets/search";
import { ZOTERO_PAGE } from "../zotero/libraryValidators";
import { countDealt, dealNew, reviewersOf, sourcesOf, touched } from "./dealing";
import { checked } from "./living";
import { unglued } from "../../lib/papers/abstract-sections";
import { papersIn } from "./estimate";
import { handedPapers, handedStart, PDFS_A_STEP, type LeftOut } from "./held";
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
/** Collections read for one Zotero source that takes the ones under a collection too. ponytail: past this many, and past the first hundred inside any one collection, the rest are not read; page the walk if a tree that large is ever added whole. */
const DEEP_COLLECTIONS = 500;
/** How much of why a source couldn't be read is kept. */
const FAILURE_SHOWN = 600;

/** What makes two records one paper where their sources name them differently: the DOI, then the title with the year. */
export const doiKeyOf = (doi: string | undefined | null) => normalDoi(doi) ?? undefined;
export const titleKeyOf = (title: string, year: number | undefined) => `${title.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "")}|${year ?? ""}`;

type Reading = { sourceId: Id<"screeningSources">; part: number; set: SourceSet; first: number; last?: number; read: number; resume?: string; snapshot?: SearchSnapshot; state: "waiting" | "reading"; total?: number; userId: Id<"users">; workspaceId: Id<"workspaces"> };

/** The next of a check's sources that still has papers to read, with where its reading stands. Null once every source is read, or the check has ended. */
export const next = internalQuery({
  args: { checkId: v.id("screeningChecks") },
  returns: v.union(v.null(), v.object({ sourceId: v.id("screeningSources"), part: v.number(), set: sourceSetValidator, first: v.number(), last: v.optional(v.number()), read: v.number(), resume: v.optional(v.string()), snapshot: v.optional(searchSnapshotValidator), state: v.union(v.literal("waiting"), v.literal("reading")), total: v.optional(v.number()), userId: v.id("users"), workspaceId: v.id("workspaces") })),
  handler: async (ctx, { checkId }): Promise<Reading | null> => {
    const check = await ctx.db.get("screeningChecks", checkId);
    const job = check?.state === "running" ? await ctx.db.get("screeningJobs", check.jobId) : null;
    if (!job) return null;
    const sources = await sourcesOf(ctx, job._id);
    const part = sources.findIndex((source) => source.removedAt === undefined && (source.state === "waiting" || source.state === "reading"));
    const source = sources[part];
    if (!source) return null;
    // Read as whoever added it: a Zotero library is theirs, and a community's records are the ones they may read.
    return { sourceId: source._id, part, set: source.set, first: source.first ?? 1, ...(source.last === undefined ? {} : { last: source.last }), read: source.read, ...(source.resume ? { resume: source.resume } : {}), ...(source.snapshot ? { snapshot: source.snapshot } : {}), state: source.state as "waiting" | "reading", ...(source.total === undefined ? {} : { total: source.total }), userId: source.addedBy, workspaceId: job.workspaceId };
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
        await step(ctx, checkId, source);
      } catch (error) {
        console.error(`[screening] Source ${source.sourceId} couldn't be read`, error);
        await ctx.runMutation(internal.screening.gathering.fail, { sourceId: source.sourceId, reason: readConvexErrorData(error)?.message ?? "Its papers couldn't be read." });
      }
    }
  },
});

/** One step of one source: the next papers of it, given to `fill`. */
async function step(ctx: ActionCtx, checkId: Id<"screeningChecks">, source: Reading) {
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
    // With the collections under it: they are read one after another, each adding the ones inside it to those still to read. `resume` keeps them, and how far into the first the reading is.
    if (set.kind === "zotero" && set.deep && set.collectionKey) return void (await ctx.runMutation(internal.screening.gathering.begin, { sourceId, resume: JSON.stringify({ keys: [set.collectionKey], at: 0, seen: 1 }) }));
    const total: number | null = await ctx.runQuery(internal.screening.gathering.heldTotal, { ...reader, set });
    return void (await ctx.runMutation(internal.screening.gathering.begin, { sourceId, ...(total === null ? {} : { total }) }));
  }
  const last = Math.min(source.last ?? Number.MAX_SAFE_INTEGER, source.total ?? Number.MAX_SAFE_INTEGER);
  const from = source.first + source.read;
  if (from > last) return void (await give([], 0, true));
  const to = Math.min(last, Math.ceil(from / READ_STEP) * READ_STEP);
  if (held) {
    // PDFs are opened and read one by one, so a step takes a few.
    const through = held.set.kind === "pdf" ? Math.min(to, from + PDFS_A_STEP - 1) : to;
    const { papers, left } = await handedPapers(ctx, held, from, through);
    return void (await give(papers, through - from + 1, through >= last, source.resume, left));
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
    const deep: { keys: string[]; at: number; seen: number } | null = set.deep && source.resume ? JSON.parse(source.resume) : null;
    if (deep && !deep.keys.length) return void (await give([], 0, true));
    const through = Math.min(to, from + ZOTERO_PAGE - 1);
    // One collection is read by its papers' places in it. One with those under it is read a collection at a time, each from its own start.
    const [first, upTo] = deep ? [deep.at + 1, deep.at + ZOTERO_PAGE] : [from, through];
    const read: { papers: Array<{ paper: string; title: string; abstract?: string; authors: string[]; year?: number; doi?: string; venue?: string; pdfUrl: string }>; ended: boolean } = await ctx.runAction(internal.zotero.actions.papersOf, { userId: source.userId, ...(deep ? { collectionKey: deep.keys[0]! } : set.collectionKey ? { collectionKey: set.collectionKey } : {}), ...(set.groupId ? { groupId: set.groupId } : {}), first, last: upTo });
    const papers = read.papers.map(({ paper, title, abstract, authors, year, doi, venue, pdfUrl }) => ({ paper, title, pdfUrl, authors: authors.slice(0, MAX_AUTHORS), ...(abstract ? { abstract } : {}), ...(year === undefined ? {} : { publicationYear: year }), ...(doi ? { doi } : {}), ...(venue ? { venue } : {}) }));
    if (deep) {
      // A collection read to its end hands on to the next, with the ones inside it added: one page of them, which is every one for all but the largest.
      const inside: { page: Array<{ key: string }> } = read.ended && deep.seen < DEEP_COLLECTIONS ? await ctx.runAction(internal.zotero.actions.collectionsOf, { userId: source.userId, ...(set.groupId ? { groupId: set.groupId } : {}), start: 0, under: deep.keys[0]! }) : { page: [] };
      const more = inside.page.map((one) => one.key).slice(0, DEEP_COLLECTIONS - deep.seen);
      const next = read.ended ? { keys: [...deep.keys.slice(1), ...more], at: 0, seen: deep.seen + more.length } : { ...deep, at: upTo };
      return void (await give(papers, read.papers.length, !next.keys.length || from + read.papers.length > last, JSON.stringify(next)));
    }
    return void (await give(papers, through - from + 1, read.ended || through >= last));
  }
  if (set.kind === "collection" || set.kind === "saved" || set.kind === "screening") {
    const { papers, resume } = await heldPapers(ctx, reader, set, { first: from, last: to }, source.resume);
    return void (await give(papers, to - from + 1, !resume || to >= last, resume));
  }
  throw new Error(`No reading for a source of this kind: ${set.kind}`);
}

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
 * record with no title or no abstract is left out, with why: a screening reads a title and an abstract. A paper
 * another source already brought is counted as merged, and one this source brought before is passed over. The rest
 * take the next places in the round and go to their reviewers.
 */
export const fill = internalMutation({
  args: { checkId: v.id("screeningChecks"), sourceId: v.id("screeningSources"), papers: v.array(screeningPaperInputValidator), read: v.number(), resume: v.optional(v.string()), ended: v.boolean(), /** What the source's own reading left out before any paper was made of it: a DOI nothing is known of, a scan, a file that doesn't open. */ leftOut: v.optional(v.array(v.object({ name: v.string(), why: leftOutWhyValidator, key: v.optional(v.string()) }))) },
  returns: v.null(),
  handler: async (ctx, { checkId, sourceId, papers, read, resume, ended, leftOut }) => {
    const [check, source] = await Promise.all([ctx.db.get("screeningChecks", checkId), ctx.db.get("screeningSources", sourceId)]);
    const job = check?.state === "running" && source?.state === "reading" ? await ctx.db.get("screeningJobs", check.jobId) : null;
    if (!check || !source || !job) return null;
    const reviewers = await reviewersOf(ctx, job._id);
    const dealt = new Map<Id<"screeningReviewers">, number>();
    const now = Date.now();
    let [taken, duplicates, left, bare] = [0, 0, 0, 0];
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
      if (!paper.abstract?.trim()) { await leave(title, "abstract", paper.paper); continue; }
      const abstract = unglued(paper.abstract);
      const identity = identityOf(parsePaperKey(paper.paper)!, { openalexId: paper.crossRefs?.openalexId, doi: paper.doi ?? paper.crossRefs?.doi });
      const keys = { paperKey: identity.paperKey, doiKey: doiKeyOf(paper.doi ?? paper.crossRefs?.doi), titleKey: titleKeyOf(title, paper.publicationYear) };
      // It finds the papers this step already took too: a mutation reads what it wrote.
      const twin = await twinOf(ctx, job._id, keys);
      if (twin) {
        // The first source added keeps the paper. One this source brought before, or holds twice, is neither new nor merged.
        if (twin.sourceId !== sourceId) duplicates++;
        continue;
      }
      const place = check.from + check.added + taken;
      const resultId = await ctx.db.insert("screeningResults", {
        ...sourceMetadata(paper),
        jobId: job._id,
        ...identity,
        title,
        abstract,
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
    }
    await ctx.db.patch("screeningSources", sourceId, { read: source.read + read, resume, taken: source.taken + taken, duplicates: source.duplicates + duplicates, left: source.left + left, ...(bare ? { bare: (source.bare ?? 0) + bare } : {}), ...(ended ? { state: "done" as const, checkedAt: now } : {}) });
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
