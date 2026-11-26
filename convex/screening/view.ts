/**
 * A screening with reviewers as someone sees it (plans/screening-reviewers): the list of a workspace's screenings,
 * and one screening with its settings, its reviewers, its sources and what waits for the person looking. Every
 * count here was kept by whoever wrote the rows (./settling.ts, ./dealing.ts), so nothing is a pass over papers.
 */
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { effortValidator } from "../aiModelConfig/validators";
import { itemKey, moreValidator } from "../activity/validators";
import { availableCredits, planLimit } from "../billing/accounts";
import { modelsLimit } from "./screenings";
import { paperLimit } from "./slots";
import { countOf, screeningsOf } from "../lib/listCounts";
import { personName } from "../lib/people";
import { assistantQuery, defineUserQuery, userQuery, workspaceQuery } from "../lib/userActions";
import schema from "../schema";
import { grantOf, itemGuestsOf } from "../sharing/items";
import { isFinal } from "../../lib/screening/rules";
import { actorIn, inOwnWorkspace, type InWorkspace } from "../workspaces/actor";
import { standingOn, type Standing } from "./access";
import { progressRow } from "./bookkeeping";
import { reviewersOf, sourcesOf } from "./dealing";
import { NO_RESULTS } from "./settling";
import { criteriaValidator, everyValidator, leftOutWhyValidator, reviewerViewsValidator, reviewerViewValidator, sourceViewsValidator, starsValidator } from "./validators";


const personValidator = v.object({ id: v.id("users"), name: v.string(), imageUrl: v.optional(v.string()) });
type Person = Infer<typeof personValidator>;
const personOf = (user: Doc<"users">): Person => ({ id: user._id, name: personName(user) || user.email, ...(user.avatarUrl ? { imageUrl: user.avatarUrl } : {}) });
/** Someone whose account is gone still has a name where their votes are. */
const SOMEONE = "Someone who left";

export type ReviewerView = Infer<typeof reviewerViewValidator>;

const countsValidator = v.object({ include: v.number(), maybe: v.number(), exclude: v.number(), conflict: v.number(), waiting: v.number() });
/** What a screening's models are doing, or null where none has a paper left to read. */
const modelsStateValidator = v.union(v.literal("gathering"), v.literal("checking"), v.literal("paused"), v.literal("credits"), v.literal("waiting"), v.literal("reading"), v.null());

const workspaceValidator = v.object({ id: v.id("workspaces"), kind: v.union(v.literal("personal"), v.literal("organization")), name: v.string(), slug: v.optional(v.string()), imageUrl: v.optional(v.string()), colour: v.optional(v.string()) });

/** The workspace a screening is in, as its tag shows it. */
async function workspaceOf(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">): Promise<Infer<typeof workspaceValidator>> {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (workspace?.kind === "organization") {
    const organization = await ctx.db.get("organizations", workspace.organizationId);
    return { id: workspaceId, kind: "organization", name: organization?.name ?? "A workspace", ...(organization?.slug ? { slug: organization.slug } : {}), ...(organization?.imageUrl ? { imageUrl: organization.imageUrl } : {}), ...(organization?.colour ? { colour: organization.colour } : {}) };
  }
  const owner = workspace ? await ctx.db.get("users", workspace.userId) : null;
  return { id: workspaceId, kind: "personal", name: owner ? personName(owner) || owner.email : "A workspace", ...(owner?.avatarUrl ? { imageUrl: owner.avatarUrl } : {}) };
}

/** Questions put to one person on one screening that its pages count and open: the first of them. */
const ASKED_SHOWN = 50;

/** What a list's row and a screening's frame both say of it. */
const aheadValidator = v.object({ id: v.id("screeningJobs"), name: v.string(), done: v.number(), of: v.number() });
const summaryFields = {
  id: v.id("screeningJobs"),
  name: v.string(),
  createdBy: personValidator,
  createdAt: v.number(),
  finishedAt: v.optional(v.number()),
  paused: v.optional(v.boolean()),
  living: v.optional(v.object({ every: everyValidator, next: v.number() })),
  // Who settles its conflicts, and how papers are settled.
  resolver: personValidator,
  settle: v.union(v.literal("all"), v.literal("most"), v.literal("one")),
  workspace: workspaceValidator,
  // What the person looking is to it.
  me: v.id("users"),
  member: v.boolean(),
  isReviewer: v.boolean(),
  canResolve: v.boolean(),
  reviewers: reviewerViewsValidator,
  total: v.number(),
  counts: countsValidator,
  // What waits for the person looking: papers to vote on, conflicts to settle, and the papers a reviewer asked them about.
  forYou: v.number(),
  conflicts: v.number(),
  // How many, counted up to a few dozen, and the first of them, which a link to "your questions" opens.
  asked: v.number(),
  askedFirst: v.optional(v.id("screeningResults")),
  models: modelsStateValidator,
  // The screening whose models read before this one's, while its own wait for the workspace's slots.
  ahead: v.optional(aheadValidator),
  // How many criteria it has: another screening can take them.
  criteria: v.number(),
  // Its papers are still being fetched from its sources: how many have arrived.
  gathering: v.optional(v.object({ done: v.number(), by: v.optional(v.id("users")), first: v.boolean() })),
  activeAt: v.number(),
};
const summaryValidator = v.object(summaryFields);
export type Summary = Infer<typeof summaryValidator>;

/** A reviewer's row as the pages read it, with their counts. */
async function reviewerView(ctx: Pick<QueryCtx, "db">, job: Doc<"screeningJobs">, reviewer: Doc<"screeningReviewers">, counts: NonNullable<Doc<"screeningJobProgress">["reviewers"]>[Id<"screeningReviewers">] | undefined, members: Map<Id<"users">, boolean>): Promise<ReviewerView> {
  const tally = { cast: counts?.cast ?? 0, include: counts?.include ?? 0, maybe: counts?.maybe ?? 0, exclude: counts?.exclude ?? 0, failed: counts?.failed ?? 0, spent: counts?.spent ?? 0 };
  const waiting = Math.max(0, reviewer.dealt - tally.cast - tally.failed - (counts?.closed ?? 0));
  const base = { row: reviewer._id, addedAt: reviewer.addedAt, ...(reviewer.left === undefined ? {} : { left: reviewer.left }), ...(reviewer.discarded === undefined ? {} : { discarded: reviewer.discarded }), ...(reviewer.reminded === undefined ? {} : { reminded: reviewer.reminded }), dealt: reviewer.dealt, ...tally, waiting };
  if (reviewer.kind === "model") {
    const model = reviewer.modelId ? await ctx.db.get("models", reviewer.modelId) : null;
    return { ...base, id: reviewer._id, kind: "model", name: model?.name ?? "A model", ...(model ? { model: { _id: model._id, modelId: model.modelId, name: model.name, inputPricePerMillion: model.inputPricePerMillion, outputPricePerMillion: model.outputPricePerMillion, ...(reviewer.effort ? { effort: reviewer.effort } : {}), available: model.retiredAt === undefined && !model.hidden } } : {}) };
  }
  const user = reviewer.userId ? await ctx.db.get("users", reviewer.userId) : null;
  if (!user) return { ...base, id: reviewer._id, kind: "person", name: SOMEONE };
  if (!members.has(user._id)) members.set(user._id, (await actorIn(ctx, user, job.workspaceId)) !== null);
  return { ...base, ...personOf(user), kind: "person", ...(members.get(user._id) ? {} : { guest: true as const }) };
}

/** What a screening's models are doing, and the screening whose models read first where its own wait their turn. */
async function modelsNow(ctx: Pick<QueryCtx, "db">, job: Doc<"screeningJobs">, reviewers: ReviewerView[], progress: Doc<"screeningJobProgress"> | null, check: Doc<"screeningChecks"> | null) {
  if (check) return { state: check.from === 0 ? ("gathering" as const) : ("checking" as const) };
  if (job.finishedAt !== undefined) return { state: null };
  const models = reviewers.filter((one) => one.kind === "model" && one.left === undefined);
  // Paused models are paused whether or not a paper waits for them: the next one that arrives will.
  if (job.paused && models.length) return { state: "paused" as const };
  if (!models.some((model) => model.waiting > 0)) return { state: null };
  if (job.outOfCredits) return { state: "credits" as const };
  if (!(progress?.running ?? 0)) {
    // None of its papers is being read: the workspace's slots are taken by a screening that started before it.
    const ahead = await readingFirst(ctx, job.workspaceId, job._id);
    if (ahead) return { state: "waiting" as const, ahead };
  }
  return { state: "reading" as const };
}

/** The screening whose models the workspace's slots go to first, other than `except`, and how far they have read. */
async function readingFirst(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">, except?: Id<"screeningJobs">) {
  const head = await ctx.db.query("screeningVotes").withIndex("by_waitingWorkspace_and_waitingSince", (q) => q.eq("waitingWorkspace", workspaceId).gte("waitingSince", 0)).first();
  const ahead = head && head.jobId !== except ? await ctx.db.get("screeningJobs", head.jobId) : null;
  if (!ahead) return null;
  // How far its models have read: the place of the slowest of them.
  const [theirs, counted] = await Promise.all([reviewersOf(ctx, ahead._id), progressRow(ctx as QueryCtx, ahead._id)]);
  const read = theirs.filter((one) => one.kind === "model" && one.left === undefined).map((one) => (counted?.reviewers?.[one._id]?.cast ?? 0) + (counted?.reviewers?.[one._id]?.failed ?? 0));
  return { id: ahead._id, name: ahead.name ?? "Another screening", done: read.length ? Math.min(...read) : 0, of: ahead.totalPapers };
}

/** The papers of a screening a reviewer put a question to this person about, which still waits for their answer. */
export async function askedOf(ctx: Pick<QueryCtx, "db">, jobId: Id<"screeningJobs">, userId: Id<"users">) {
  const open = await ctx.db.query("screeningMessages").withIndex("by_job_and_to_and_open", (q) => q.eq("jobId", jobId).eq("to", userId).eq("open", true)).take(ASKED_SHOWN);
  return [...new Set(open.map((message) => message.resultId))];
}

/** The summary of a screening for someone who may see it. */
export async function summaryOf(ctx: Pick<QueryCtx, "db">, actor: InWorkspace, { job, member, reviewer }: Standing): Promise<Summary> {
  const [rows, progress, check, creator, resolver] = await Promise.all([
    reviewersOf(ctx, job._id),
    progressRow(ctx as QueryCtx, job._id),
    ctx.db.query("screeningChecks").withIndex("by_job_and_state", (q) => q.eq("jobId", job._id).eq("state", "running")).first(),
    ctx.db.get("users", job.createdBy),
    job.rule ? ctx.db.get("users", job.rule.resolver) : null,
  ]);
  const members = new Map<Id<"users">, boolean>();
  const reviewers = await Promise.all(rows.map((row) => reviewerView(ctx, job, row, progress?.reviewers?.[row._id], members)));
  const settled = { ...NO_RESULTS, ...progress?.counts };
  // What has arrived so far: the sources' own counts while they are read, since the screening's total is written when the reading ends.
  const sources = check ? await sourcesOf(ctx, job._id) : [];
  const total = check ? sources.reduce((sum, source) => sum + (source.removedAt === undefined ? source.taken : 0), 0) : job.totalPapers;
  const counts = { ...settled, waiting: Math.max(0, total - settled.include - settled.maybe - settled.exclude - settled.conflict) };
  const mine = reviewer ? reviewers.find((one) => one.row === reviewer._id) : undefined;
  const canResolve = job.rule?.resolver === actor.userId;
  const open = job.finishedAt === undefined;
  const { state, ahead } = await modelsNow(ctx, job, reviewers, progress, check);
  const asked = await askedOf(ctx, job._id, actor.userId);
  return {
    id: job._id,
    name: job.name ?? "Screening",
    createdBy: creator ? personOf(creator) : { id: job.createdBy, name: SOMEONE },
    createdAt: job.createdAt,
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
    ...(job.paused ? { paused: true } : {}),
    ...(job.living ? { living: job.living } : {}),
    resolver: resolver ? personOf(resolver) : { id: job.rule?.resolver ?? job.createdBy, name: SOMEONE },
    settle: job.rule?.settle ?? "all",
    workspace: await workspaceOf(ctx, job.workspaceId),
    me: actor.userId,
    member,
    isReviewer: reviewer !== null,
    canResolve,
    reviewers,
    total,
    counts,
    forYou: open ? (mine?.waiting ?? 0) : 0,
    conflicts: open && canResolve ? counts.conflict : 0,
    asked: asked.length,
    ...(asked[0] ? { askedFirst: asked[0] } : {}),
    models: state,
    ...(ahead ? { ahead } : {}),
    criteria: job.criteria?.length ?? 0,
    ...(check ? { gathering: { done: check.added, ...(check.by ? { by: check.by } : {}), first: check.from === 0 } } : {}),
    activeAt: Math.max(job.activeAt ?? 0, job.updatedAt),
  };
}

/**
 * What starting a screening in the workspace depends on: the person starting it, the credits the workspace has for
 * AI models, how many papers and how many models its plan gives one screening (`papers` is null where it sets no
 * limit), and a screening whose models are reading now, which a new one's models would wait behind.
 */
export const setup = workspaceQuery({
  args: {},
  returns: v.object({ me: personValidator, credits: v.number(), limits: v.object({ papers: v.union(v.number(), v.null()), models: v.number(), atOnce: v.number() }), reading: v.optional(aheadValidator) }),
  handler: async (ctx, { userId, workspaceId }) => {
    const [me, credits, papers, models, atOnce, reading] = await Promise.all([ctx.db.get("users", userId), availableCredits(ctx, workspaceId), planLimit(ctx, workspaceId, "request_papers"), modelsLimit(ctx, workspaceId), paperLimit(ctx, workspaceId), readingFirst(ctx, workspaceId)]);
    return { me: me ? personOf(me) : { id: userId, name: SOMEONE }, credits, limits: { papers: papers ?? null, models, atOnce }, ...(reading ? { reading } : {}) };
  },
});

const SORTS = v.union(v.literal("active"), v.literal("newest"), v.literal("oldest"), v.literal("name"));
/** Screenings one page of the list holds at most, and rows a page looks through for the ones its filters keep. */
const PAGE_MAX = 50;
const FILTER_ROWS = 500;

export const listAction = defineUserQuery({
  path: "screening/view:list",
  description:
    "Lists the workspace's screenings, a page at a time: each with who started it, its reviewers (people and AI models), how many papers it has and where they stand (included, maybe, excluded, in conflict, waiting for votes), what waits for the person (papers to vote on, conflicts to settle, questions put to them) and what its models are doing. " +
    "`show` keeps the ones still open or the finished ones, `by` the ones one person started, and `text` the ones whose name matches. In order of last activity, newest or oldest started, or name.",
  args: { show: v.union(v.literal("all"), v.literal("open"), v.literal("finished")), sort: SORTS, by: v.optional(v.id("users")), text: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(summaryValidator),
  run: async (ctx, actor, { show, sort, by, text, paginationOpts }) => {
    const { workspaceId } = actor;
    const needle = text?.trim() ?? "";
    const keeps = (job: Doc<"screeningJobs">) => job.shape === 2 && (show === "all" || (show === "finished") === (job.finishedAt !== undefined)) && (!by || job.createdBy === by);
    const options = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, PAGE_MAX) };
    const jobs = stream(ctx.db, schema).query("screeningJobs");
    const read = needle
      ? // A name is found by its words, best match first.
        await ctx.db.query("screeningJobs").withSearchIndex("search_name", (q) => q.search("name", needle).eq("workspaceId", workspaceId)).paginate(options)
      : await (sort === "name" ? jobs.withIndex("by_workspace_and_name", (q) => q.eq("workspaceId", workspaceId)).order("asc") : sort === "active" ? jobs.withIndex("by_workspace_and_activeAt", (q) => q.eq("workspaceId", workspaceId)).order("desc") : jobs.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).order(sort === "oldest" ? "asc" : "desc"))
          .filterWith(async (job) => keeps(job))
          .paginate({ ...options, maximumRowsRead: FILTER_ROWS });
    const page = await Promise.all(read.page.filter(keeps).map(async (job) => summaryOf(ctx, actor, (await standingOn(ctx, actor, job._id))!)));
    return { ...read, page };
  },
});
export const list = userQuery(listAction);
export const listForAssistant = assistantQuery(listAction);

/** Screenings read at most for what waits for one person, and for what is shared with them. */
const MINE_MAX = 100;

/**
 * Lists, in one page, the screenings that wait for the person in the workspace they act in (papers for them to vote
 * on, conflicts for them to settle or questions put to them), and in their own workspace the ones shared with them
 * from elsewhere, which say they aren't its member.
 */
export const mine = workspaceQuery({
  args: {},
  returns: paginationResultValidator(summaryValidator),
  handler: async (ctx, actor) => {
    const { userId, workspaceId } = actor;
    const own = await inOwnWorkspace(ctx, actor);
    // The ones they review, the ones whose conflicts they settle, and in their own workspace the ones given to them from outside.
    const reviewing = await ctx.db.query("screeningReviewers").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(MINE_MAX);
    const given = own ? await ctx.db.query("itemAccess").withIndex("by_user_and_kind_and_grantedAt", (q) => q.eq("userId", userId).eq("kind", "screening")).order("desc").take(MINE_MAX) : [];
    const ids = [...new Set([...reviewing.map((row) => row.jobId as string), ...given.map((row) => row.item)])];
    const seen = (await Promise.all(ids.map(async (id) => {
      const jobId = ctx.db.normalizeId("screeningJobs", id);
      const standing = jobId ? await standingOn(ctx, actor, jobId) : null;
      return standing?.job.shape === 2 ? [await summaryOf(ctx, actor, standing)] : [];
    }))).flat();
    // Conflicts go to one person, who may not be among the reviewers: the workspace's open screenings they settle are looked at too.
    const settles = (await ctx.db.query("screeningJobs").withIndex("by_workspace_status", (q) => q.eq("workspaceId", workspaceId).eq("status", "processing")).order("desc").take(MINE_MAX)).filter((job) => job.shape === 2 && job.rule?.resolver === userId && !ids.includes(job._id));
    const settled = await Promise.all(settles.map(async (job) => summaryOf(ctx, actor, (await standingOn(ctx, actor, job._id))!)));
    // What waits for them, and what is shared with them whether or not anything waits.
    return { page: [...seen, ...settled].filter((one) => !one.member || one.forYou + one.conflicts + one.asked > 0), isDone: true, continueCursor: "" };
  },
});

/**
 * Counts the workspace's screenings: the ones still open and the ones finished.
 */
export const tally = workspaceQuery({
  args: {},
  returns: v.object({ open: v.number(), finished: v.number() }),
  handler: async (ctx, { workspaceId }) => ({ open: await countOf(ctx, screeningsOf(workspaceId, false)), finished: await countOf(ctx, screeningsOf(workspaceId, true)) }),
});

const checkValidator = v.object({ id: v.id("screeningChecks"), at: v.number(), by: v.optional(personValidator), state: v.union(v.literal("running"), v.literal("done"), v.literal("failed")), first: v.boolean(), found: v.number(), added: v.number() });

/** Checks one page of a screening's checks holds at most, and the latest of them looked through for the last that brought papers. */
const CHECKS_PAGE = 50;
const CHECKS_LOOKED = 20;
/** Votes that ask for a new one, counted for their reviewer's tab: past it the tab says so many and more. */
const FLAGGED_COUNTED = 500;
/** Papers of its last check counted for what is still open among them. */
const LATEST_COUNTED = 500;

export const getAction = defineUserQuery({
  path: "screening/view:get",
  description:
    "Reads one screening the person may see: its name and research question, its criteria (each with its short name, whether a paper must meet it, its guidance and its points), the rule that settles a paper, its sources with what each held, took, merged and left out, its reviewers with how many papers each has voted on and how, " +
    "where its papers stand, what waits for the person, where included papers go, each check of its sources, and what its models have cost. Null when there is none, or it isn't theirs to see.",
  args: { jobId: v.id("screeningJobs") },
  returns: v.union(
    v.null(),
    v.object({
      ...summaryFields,
      question: v.optional(v.string()),
      criteria: criteriaValidator,
      stars: starsValidator,
      each: v.union(v.number(), v.literal("all")),
      blind: v.union(v.literal("after"), v.literal("always")),
      sources: sourceViewsValidator,
      // Where its included papers go.
      destination: v.object({ kind: v.union(v.literal("none"), v.literal("new"), v.literal("collection"), v.literal("community")), name: v.optional(v.string()), collectionId: v.optional(v.id("collections")), prune: v.boolean() }),
      // Whether its workspace is out of credits for its models, and what the workspace has, for someone who may see that.
      outOfCredits: v.boolean(),
      credits: v.optional(v.number()),
      // The person's own place on it, where they are a guest: to vote, or to look.
      guest: v.optional(v.union(v.literal("viewer"), v.literal("editor"))),
      // How many votes of theirs were cast before a criterion became a must-have, and ask for a new one.
      flagged: v.number(),
      // The people it is shared with from outside its workspace, invitations still waiting included.
      guests: v.number(),
      // The last check of its sources that brought papers: how many, how many of them still wait for votes, and how many wait for the person's own.
      latest: v.optional(v.object({ id: v.id("screeningChecks"), at: v.number(), added: v.number(), open: v.number(), mine: v.number() })),
      // The last check there was, whatever it found, and how many checks it has had since it started.
      lastCheck: v.optional(v.object({ at: v.number(), found: v.number(), added: v.number() })),
    }),
  ),
  run: async (ctx, actor, { jobId }) => {
    const standing = await standingOn(ctx, actor, jobId);
    if (!standing || standing.job.shape !== 2 || !standing.job.rule) return null;
    const { job, member, reviewer } = standing;
    const rule = standing.job.rule;
    const [summary, sources, collection] = await Promise.all([
      summaryOf(ctx, actor, standing),
      sourcesOf(ctx, jobId),
      job.targetCollectionId ? ctx.db.get("collections", job.targetCollectionId) : null,
    ]);
    const flagged = reviewer ? (await ctx.db.query("screeningVotes").withIndex("by_reviewer_and_flagged_and_place", (q) => q.eq("reviewerId", reviewer._id).eq("flagged", true)).take(FLAGGED_COUNTED)).length : 0;
    const guest = member ? null : ((await grantOf(ctx, jobId, actor.userId))?.role ?? null);
    // The first look in its sources is the screening starting: only a later one "brought new papers".
    const lately = (await ctx.db.query("screeningChecks").withIndex("by_job", (q) => q.eq("jobId", jobId)).order("desc").take(CHECKS_LOOKED)).filter((check) => check.state === "done" && check.from > 0);
    const last = lately.find((check) => check.added > 0);
    const brought = last ? await ctx.db.query("screeningResults").withIndex("by_job_and_check", (q) => q.eq("jobId", jobId).eq("checkId", last._id)).take(LATEST_COUNTED) : [];
    const theirs = last && reviewer ? await ctx.db.query("screeningVotes").withIndex("by_reviewer_and_status_and_place", (q) => q.eq("reviewerId", reviewer._id).eq("status", "waiting").gte("place", last.from)).take(LATEST_COUNTED) : [];
    return {
      ...summary,
      ...(job.question ? { question: job.question } : {}),
      criteria: job.criteria ?? [],
      stars: job.stars ?? [],
      each: rule.each,
      blind: rule.blind,
      sources: sources.map((source) => ({ id: source._id, set: source.set, name: source.name, ...(source.detail ? { detail: source.detail } : {}), ...(source.first === undefined ? {} : { first: source.first }), ...(source.last === undefined ? {} : { last: source.last }), addedAt: source.addedAt, ...(source.removedAt === undefined ? {} : { removedAt: source.removedAt }), state: source.state, ...(source.failure ? { failure: source.failure } : {}), ...(source.total === undefined ? {} : { total: source.total }), read: source.read, taken: source.taken, duplicates: source.duplicates, left: source.left, ...(source.checkedAt === undefined ? {} : { checkedAt: source.checkedAt }) })),
      destination: job.libraryDestination
        ? { kind: "community" as const, name: job.libraryDestination.name, prune: job.prune === true }
        : job.newCollection
          ? { kind: "new" as const, name: job.newCollection, prune: job.prune === true }
          : collection
            ? { kind: "collection" as const, name: collection.name, collectionId: collection._id, prune: job.prune === true }
            : { kind: "none" as const, prune: job.prune === true },
      outOfCredits: job.outOfCredits === true,
      // The workspace's credits are its members' to see.
      ...(member ? { credits: await availableCredits(ctx, job.workspaceId) } : {}),
      ...(guest ? { guest } : {}),
      flagged,
      guests: await countOf(ctx, itemGuestsOf(jobId)),
      ...(lately[0] ? { lastCheck: { at: lately[0].endedAt ?? lately[0].at, found: lately[0].found, added: lately[0].added } } : {}),
      ...(last ? { latest: { id: last._id, at: last.endedAt ?? last.at, added: last.added, open: brought.filter((paper) => !isFinal(paper.result)).length, mine: theirs.filter((vote) => vote.place < last.from + last.added).length } } : {}),
    };
  },
});
export const get = userQuery(getAction);
export const getForAssistant = assistantQuery(getAction);

/** What a source held that the screening doesn't take, a page at a time. */
export const leftOutAction = defineUserQuery({
  path: "screening/view:leftOut",
  description: "Lists what one of a screening's sources held and the screening doesn't take, a page at a time, each with why: no abstract, no title, a DOI that wasn't found, a scan with no text, or a file that doesn't open.",
  args: { jobId: v.id("screeningJobs"), sourceId: v.id("screeningSources"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ id: v.id("screeningLeftOut"), name: v.string(), why: leftOutWhyValidator })),
  run: async (ctx, actor, { jobId, sourceId, paginationOpts }) => {
    const standing = await standingOn(ctx, actor, jobId);
    const source = standing ? await ctx.db.get("screeningSources", sourceId) : null;
    if (source?.jobId !== jobId) return { page: [], isDone: true, continueCursor: "" };
    const read = await ctx.db.query("screeningLeftOut").withIndex("by_source", (q) => q.eq("sourceId", sourceId)).paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 100) });
    return { ...read, page: read.page.map((one) => ({ id: one._id, name: one.name, why: one.why })) };
  },
});
export const leftOut = userQuery(leftOutAction);
export const leftOutForAssistant = assistantQuery(leftOutAction);

/** Changes one page of a screening's activity holds at most. */
const ACTIVITY_PAGE = 50;

export const activityAction = defineUserQuery({
  path: "screening/view:activity",
  description: "Lists what has happened in a screening the person may see, newest first, a page at a time: each change with who made it, when, its code (such as `reviewerAdded`, `checked`, `settings`), the name or count it is about, and under it what the change did, a line each.",
  args: { jobId: v.id("screeningJobs"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ id: v.id("activity"), at: v.number(), by: personValidator, happened: v.string(), code: v.optional(v.string()), count: v.optional(v.number()), detail: v.optional(v.string()), more: moreValidator })),
  run: async (ctx, actor, { jobId, paginationOpts }) => {
    const standing = await standingOn(ctx, actor, jobId);
    if (!standing) return { page: [], isDone: true, continueCursor: "" };
    const read = await ctx.db.query("activity").withIndex("by_workspace_and_item", (q) => q.eq("workspaceId", standing.job.workspaceId).eq("item", itemKey("screening", jobId))).order("desc").paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, ACTIVITY_PAGE) });
    const people = new Map<Id<"users">, Person>();
    for (const row of read.page) if (!people.has(row.by)) { const user = await ctx.db.get("users", row.by); people.set(row.by, user ? personOf(user) : { id: row.by, name: SOMEONE }); }
    return { ...read, page: read.page.map((row) => ({ id: row._id, at: row._creationTime, by: people.get(row.by)!, happened: row.happened, ...(row.code ? { code: row.code } : {}), ...(row.count === undefined ? {} : { count: row.count }), ...(row.detail ? { detail: row.detail } : {}), ...(row.more ? { more: row.more } : {}) })) };
  },
});
export const activity = userQuery(activityAction);
export const activityForAssistant = assistantQuery(activityAction);

export const checksAction = defineUserQuery({
  path: "screening/view:checks",
  description: "Lists each look in a screening's sources, a page at a time, the latest first: the one it started with, then each check for new papers, by hand or on its schedule (no `by`), with how many papers it found and how many of those were new to the screening.",
  args: { jobId: v.id("screeningJobs"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(checkValidator),
  run: async (ctx, actor, { jobId, paginationOpts }) => {
    if (!(await standingOn(ctx, actor, jobId))) return { page: [], isDone: true, continueCursor: "" };
    const read = await ctx.db.query("screeningChecks").withIndex("by_job", (q) => q.eq("jobId", jobId)).order("desc").paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, CHECKS_PAGE) });
    const people = new Map<Id<"users">, Person>();
    for (const check of read.page) if (check.by && !people.has(check.by)) { const user = await ctx.db.get("users", check.by); people.set(check.by, user ? personOf(user) : { id: check.by, name: SOMEONE }); }
    return { ...read, page: read.page.map((check) => ({ id: check._id, at: check.at, ...(check.by ? { by: people.get(check.by)! } : {}), state: check.state, first: check.from === 0, found: check.found, added: check.added })) };
  },
});
export const checks = userQuery(checksAction);
export const checksForAssistant = assistantQuery(checksAction);
