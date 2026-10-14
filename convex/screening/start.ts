import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx } from "../lib/functions";
import type { ChangeCall } from "../lib/userActions";
import { startHeld } from "../billing/charge";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { createError, readConvexErrorData } from "../lib/errors";
import { heldPapers } from "../paperSets/held";
import { countSearch, numbered, PAGE_SIZE, type SearchSnapshot } from "../paperSets/openalex";
import { searchPapers, snapshotOf, spender, type SavedSearchRequest, type SearchPaper } from "../paperSets/search";
import { checkScreening, firstZoteroPaper, papersIn, requireMinimum, screeningHold } from "./estimate";
import { personalWorkspaceOf, type InWorkspace } from "../workspaces/actor";
import { paperSetValidator, saveToValidator, screeningQuestionValidator, screeningScoringConfigValidator } from "./validators";
import { MAX_AUTHORS } from "../lib/listCaps";
import { ZOTERO_PAGE } from "../zotero/libraryValidators";
import { keepLibraryKeys, resolveLibraryKeys } from "../evidenceLibraries/sources";
import { LIBRARY_KEYS_WINDOW } from "../paperSets/libraryKeys";

type PaperSet = Infer<typeof paperSetValidator>;

const jobArgs = {
  questions: v.array(screeningQuestionValidator),
  scoringConfig: screeningScoringConfigValidator,
};
type Config = { questions: Infer<typeof jobArgs.questions>; scoringConfig: Infer<typeof jobArgs.scoringConfig>; saveTo?: Infer<typeof saveToValidator>; prune?: boolean; name?: string };

/** Papers one step of a job's reading takes: up to the end of one of OpenAlex's pages, so no page is asked for twice. */
const READ_STEP = PAGE_SIZE;
/** How long one reading action reads before it hands on to the next: well inside an action's ten minutes. */
const READ_ACTION_MS = 4 * 60_000;

/** How many papers a held set has, as the account counts them: what a job on it can take at most. */
export const heldCount = internalQuery({
  // `workspaceId` is optional only for a call from an action already running when this deployed (#650); required again in slice 8.
  args: { userId: v.id("users"), workspaceId: v.optional(v.id("workspaces")), set: paperSetValidator },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { userId, workspaceId, set }) => papersIn(ctx, { userId, workspaceId: workspaceId ?? (await personalWorkspaceOf(ctx, userId)) }, set),
});

/**
 * Starts a job on papers `first` to `last` of a set, however many: it's made at once, and its
 * papers follow a step at a time (`read`), so nobody waits on the form for them. A search is
 * counted first, so a query OpenAlex won't take, or a range past the search's last paper, is
 * refused here; a held set's count is the account's.
 */
async function start(ctx: ActionCtx, { userId, workspaceId }: InWorkspace, author: "user" | "assistant", { set, first, last: through, name, ...config }: Config & { set: PaperSet; first: number; last: number }, call?: ChangeCall): Promise<{ jobId: Id<"screeningJobs"> }> {
  const spendCap = call?.credits;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(through) || first < 1 || through < first) {
    throw createError("VALIDATION_ERROR", "Pick papers from 1 up, with the first before the last");
  }
  requireMinimum(config.scoringConfig);
  // Everything the estimate checks before the person is asked, checked again by the start itself, so no path skips it.
  await ctx.runQuery(internal.screening.start.check, { userId, workspaceId, set, first, last: through, ...config });
  let total: number;
  let snapshot: SearchSnapshot | undefined;
  let libraryKeys: string[] | undefined;
  if (set.kind === "evidenceLibrary") {
    // The library turns its source into keys once, as the person may read it: the job reads those and no others.
    libraryKeys = await resolveLibraryKeys(ctx, { libraryId: set.libraryId, userId, source: set.source, first, last: through });
    total = first - 1 + libraryKeys.length;
  } else if (set.kind === "search") {
    // Typed here: the generated API's types depend on this module, so inference would loop.
    const found: SavedSearchRequest = await ctx.runQuery(internal.paperSets.search.readSearch, { userId, workspaceId, searchId: set.searchId });
    snapshot = snapshotOf(found);
    total = await countSearch(snapshot.request, spender(ctx, found.clerkId));
  } else {
    // A set the account doesn't count is read to its end, or to `last`.
    total = (await ctx.runQuery(internal.screening.start.heldCount, { userId, workspaceId, set })) ?? through;
  }
  if (first > total) throw createError("VALIDATION_ERROR", "There are no papers in that range");
  // A Zotero collection is read for its first paper before a job is made: one gone, or a group out of reach, is refused here.
  if (set.kind === "zotero") await firstZoteroPaper(ctx, userId, set, first);
  // No further than the set goes: papers past its last are never asked for.
  const last = Math.min(through, total);
  // A library collection it saves to, or takes papers out of, is one the person changes there: checked, or made, before
  // the job is. The one it prunes is checked first, so a refusal never leaves a new collection behind.
  const saveTo = config.saveTo;
  const pruneName = config.prune && set.kind === "evidenceLibrary" && "readerCollection" in set.source && set.source.readerCollection ? await ctx.runAction(internal.evidenceLibraries.sourceActions.requireEditable, { userId, libraryId: set.libraryId, collection: set.source.readerCollection }) : undefined;
  const libraryDestination = saveTo?.kind === "libraryCollection" || saveTo?.kind === "newLibraryCollection" ? await ctx.runAction(internal.evidenceLibraries.sourceActions.destination, { userId, saveTo }) : undefined;
  // A job the assistant started keeps the step it started from, so its chat hears when it ends.
  const step = call?.from ? { chatStep: call.from } : {};
  const keys = libraryKeys?.slice(0, last - first + 1);
  // A Convex array holds 8,192 values: the job is made with the first window of its keys, and the start keeps the rest before it reads.
  const more = keys !== undefined && keys.length > LIBRARY_KEYS_WINDOW;
  const open = (spend: { spendCap?: number; spendHold?: string }) =>
    ctx.runMutation(internal.screening.mutations.openScreeningJob, { userId, workspaceId, author, set, first, last, ...(snapshot ? { snapshot } : {}), ...(keys ? { libraryKeys: keys.slice(0, LIBRARY_KEYS_WINDOW), readLater: more } : {}), ...config, ...(libraryDestination ? { libraryDestination } : {}), ...(pruneName ? { pruneName } : {}), ...(name ? { name } : {}), papers: last - first + 1, ...step, ...spend });
  // What the person approved is held once, and the job's papers are charged under the hold (../billing/charge.ts): the job is made with both, or not at all.
  const started = spendCap === undefined ? await open({}) : await startHeld(ctx, { userId, workspaceId, credits: spendCap, kind: "screening" }, (spendHold) => open({ spendCap, spendHold }));
  if (more && (await keepLibraryKeys(ctx, started.jobId, keys, { from: LIBRARY_KEYS_WINDOW }))) await ctx.runMutation(internal.screening.mutations.beginReading, { jobId: started.jobId });
  return started;
}

/** How often an ended job is looked at again while a paper of it is still being read, and for how long at most: longer than a paper's worker can run. */
const RUNNING_CHECK_MS = 15_000;
const RUNNING_WAIT_MS = 12 * 60_000;
/** How long after its last paper stopped being read a job's hold is settled: the paper's cost is recorded a moment after it's counted as done. */
const SETTLE_AFTER_MS = 30_000;

/**
 * Settles the hold of a job that has ended (../lib/triggers.ts), once none of its papers is
 * still being read: one read when the job stopped or was cancelled is recorded under the
 * hold when it ends, and every charge of the job goes through the hold's one confirm
 * (../billing/charge.ts).
 */
export const settleHold = internalMutation({
  args: { jobId: v.id("screeningJobs"), hold: v.string(), waited: v.number() },
  returns: v.null(),
  handler: async (ctx, { jobId, hold, waited }) => {
    const progress = await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", jobId)).unique();
    if ((progress?.running ?? 0) > 0 && waited < RUNNING_WAIT_MS) await ctx.scheduler.runAfter(RUNNING_CHECK_MS, internal.screening.start.settleHold, { jobId, hold, waited: waited + RUNNING_CHECK_MS });
    else await ctx.scheduler.runAfter(0, internal.billing.charge.laterSpent, { chargeId: hold, attempt: 0, delay: SETTLE_AFTER_MS });
    return null;
  },
});

/**
 * Reads a job's papers a step at a time and gives each step to it (`fillScreeningJob`): a
 * search's from where its cursor pages stopped, a held set's from where it goes on, so a set
 * of any size is never held whole. Past a few minutes it hands on to another action. A
 * search's rating filter can leave a step with no papers, which is passed over; a job whose
 * papers OpenAlex won't return ends as failed with why.
 */
export const read = internalAction({
  args: { jobId: v.id("screeningJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const started = Date.now();
    try {
      for (;;) {
        // Typed here: the generated API's types depend on this module, so inference would loop.
        const job: { userId: Id<"users">; workspaceId: Id<"workspaces">; set: PaperSet; first: number; last: number; read: number; resume?: string; snapshot?: SearchSnapshot } | null = await ctx.runQuery(internal.screening.queries.readingJob, { jobId });
        if (!job) return null;
        if (Date.now() - started > READ_ACTION_MS) return void (await ctx.scheduler.runAfter(0, internal.screening.start.read, { jobId }));
        const from = job.first + job.read;
        const to = Math.min(job.last, Math.ceil(from / READ_STEP) * READ_STEP);
        if (job.set.kind === "search") {
          // Numbered pages when the search's order has them as far as the job goes, each step its own; otherwise one cursor page a step, carrying on from where the last stopped.
          const paged = job.snapshot !== undefined && numbered(job.snapshot.request, job.last);
          const { papers, ended, resume, taken } = await searchPapers(ctx, { userId: job.userId, workspaceId: job.workspaceId }, { searchId: job.set.searchId, first: from, last: to }, job.snapshot, paged ? { goesOn: false } : { resume: job.resume, goesOn: true });
          const read = paged ? to - from + 1 : taken;
          const done = ended || from + read > job.last;
          await ctx.runMutation(internal.screening.mutations.fillScreeningJob, { jobId, papers, read, ...(resume ? { resume } : {}), ended: done });
          if (done) return null;
        } else if (job.set.kind === "evidenceLibrary") {
          // The keys the library gave when the job started, a step at a time.
          const keys: string[] = await ctx.runQuery(internal.paperSets.libraryKeys.slice, { job: jobId, offset: from - job.first, count: to - from + 1 });
          const papers: SearchPaper[] = keys.length ? await ctx.runAction(internal.evidenceLibraries.sourceActions.papers, { libraryId: job.set.libraryId, keys }) : [];
          const done = to >= job.last;
          await ctx.runMutation(internal.screening.mutations.fillScreeningJob, { jobId, papers, read: to - from + 1, ended: done });
          if (done) return null;
        } else if (job.set.kind === "zotero") {
          // Read through the person's own Zotero account, one page of its items a step.
          const { collectionKey, groupId } = job.set;
          const through = Math.min(to, from + ZOTERO_PAGE - 1);
          const read: { papers: Array<{ paper: string; title: string; abstract?: string; authors: string[]; year?: number; doi?: string; venue?: string; pdfUrl: string }>; ended: boolean } = await ctx.runAction(internal.zotero.actions.papersOf, { userId: job.userId, ...(collectionKey ? { collectionKey } : {}), ...(groupId ? { groupId } : {}), first: from, last: through });
          const papers = read.papers.map(({ paper, title, abstract, authors, year, doi, venue, pdfUrl }) => ({ paper, title, pdfUrl, authors: authors.slice(0, MAX_AUTHORS), ...(abstract ? { abstract } : {}), ...(year === undefined ? {} : { publicationYear: year }), ...(doi ? { doi } : {}), ...(venue ? { venue } : {}) }));
          const done = read.ended || through >= job.last;
          await ctx.runMutation(internal.screening.mutations.fillScreeningJob, { jobId, papers, read: through - from + 1, ended: done });
          if (done) return null;
        } else {
          const { papers, resume } = await heldPapers(ctx, { userId: job.userId, workspaceId: job.workspaceId }, job.set, { first: from, last: to }, job.resume);
          const done = !resume || to >= job.last;
          await ctx.runMutation(internal.screening.mutations.fillScreeningJob, { jobId, papers, read: to - from + 1, ...(resume ? { resume } : {}), ended: done });
          if (done) return null;
        }
      }
    } catch (error) {
      console.error(`[screening] Job ${jobId} couldn't get its papers`, error);
      await ctx.runMutation(internal.screening.mutations.failScreeningRead, { jobId, reason: readConvexErrorData(error)?.message ?? "Its papers couldn't be read. Run it again." });
    }
    return null;
  },
});

/** What starting a screening refuses before it reads a paper (./estimate.ts `checkScreening`). */
export const check = internalQuery({
  // Optional only for a call from an action already running when this deployed (#650), which reads in its person's own; required again in slice 8.
  args: { userId: v.id("users"), workspaceId: v.optional(v.id("workspaces")), set: paperSetValidator, first: v.number(), last: v.number(), ...jobArgs, saveTo: v.optional(saveToValidator), prune: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { userId, workspaceId, ...request }) => {
    await checkScreening(ctx, { userId, workspaceId: workspaceId ?? (await personalWorkspaceOf(ctx, userId)) }, request);
    return null;
  },
});

export const screenAction = defineUserAction({
  path: "screening/start:screen",
  description:
    "Screens papers `first` to `last` (from 1) of a paper set: one of the person's saved searches, in its results page's order and rating filter; one of their collections or all their saved papers, newest saved first; " +
    "the included papers of an earlier screening; the items of the person's own Zotero library, a collection of it (not its sub-collections) or a group's, in Zotero's order (`kind: \"zotero\"`, found with zotero/library:collections); or an Evidence Library's records as the person may read them, in the source's order (`kind: \"evidenceLibrary\"`, with a `source` as evidenceLibraries/library:sources or :address gives it: the whole library, a collection, a search or records). Answers the questions for each paper and scores them by the rules. A search's answers show on its page, and papers that page already answered every question for keep their answers and cost nothing. " +
    "The job is made at once and its papers are read after, a step at a time, however many: until then the job is `reading`, and one whose papers can't be read ends `failed`, with why in its `failure`. " +
    "Included papers go to `saveTo`: nowhere, a new or existing collection of the workspace, a collection in an Evidence Library the person owns or edits there (`libraryCollection`, its ID as evidenceLibraries/library:sources lists it), or a new one of theirs there (`newLibraryCollection`, made once for its `requestId`); a library collection takes the papers the library holds a record of, and the job names the rest. " +
    "With `prune`, papers of a collection (the workspace's, or a reader's library collection the person edits) that end excluded or failed leave it. Give it a `name` when the person names it; without one it goes by its papers' set. Spends credits.",
  args: { set: paperSetValidator, first: v.number(), last: v.number(), ...jobArgs, saveTo: saveToValidator, prune: v.optional(v.boolean()), name: v.optional(v.string()) },
  returns: v.object({ jobId: v.id("screeningJobs") }),
  spendsCredits: true,
  outsideEffect: false,
  undoable: false,
  // One that writes to an Evidence Library collection asks first, however much the chat allows: whoever the collection
  // is shared with, or anyone for a public one, sees what it puts in or takes out.
  asksFirst: async (_ctx, _actor, { set, saveTo, prune }) => saveTo.kind === "libraryCollection" || saveTo.kind === "newLibraryCollection" || (prune === true && set.kind === "evidenceLibrary"),
  seenOutside: true,
  estimate: (ctx, actor, args) => screeningHold(ctx, actor, args),
  // The papers, the questions put to them and where the included ones go. How each answer scores is the job's own business.
  shown: ({ set, first, last, questions, saveTo, prune, name }) => ({
    ...(name?.trim() ? { name: name.trim() } : {}),
    ...(set.kind === "collection" ? { collectionId: set.collectionId } : set.kind === "search" ? { search: set.searchId } : set.kind === "screening" ? { screening: set.jobId } : set.kind === "zotero" ? { zotero: set.collectionKey ?? "library", ...(set.groupId ? { group: set.groupId } : {}) } : set.kind === "evidenceLibrary" ? { evidenceLibrary: set.libraryId, ...set.source } : { papers: "library" }),
    first,
    last,
    question: questions.map((asked) => asked.question),
    ...(saveTo.kind === "new" ? { saveTo: saveTo.name } : saveTo.kind === "collection" ? { saveTo: saveTo.collectionId } : {}),
    // A library collection with the library it's in, which may not be the one the papers come from.
    ...(saveTo.kind === "newLibraryCollection" ? { saveTo: saveTo.name, saveToLibrary: saveTo.libraryId } : saveTo.kind === "libraryCollection" ? { saveTo: saveTo.collection, saveToLibrary: saveTo.libraryId } : {}),
    ...(prune ? { prune } : {}),
  }),
  // Typed here: the generated API's types depend on this module, so inference would loop.
  run: (ctx, { userId, workspaceId, author }, args, call): Promise<{ jobId: Id<"screeningJobs"> }> => start(ctx, { userId, workspaceId }, author, args, call),
});
export const screen = userAction(screenAction);
export const screenForAssistant = assistantAction(screenAction);
