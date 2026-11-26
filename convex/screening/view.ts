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
import { availableCredits } from "../billing/accounts";
import { countOf, screeningsOf } from "../lib/listCounts";
import { personName } from "../lib/people";
import { defineUserQuery, userQuery } from "../lib/userActions";
import schema from "../schema";
import { grantOf } from "../sharing/items";
import { actorIn, inOwnWorkspace, type InWorkspace } from "../workspaces/actor";
import { standingOn, type Standing } from "./access";
import { progressRow } from "./bookkeeping";
import { reviewersOf } from "./dealing";
import { NO_RESULTS } from "./settling";
import { criteriaValidator, everyValidator, leftOutWhyValidator, sourceSetValidator } from "./validators";


const personValidator = v.object({ id: v.id("users"), name: v.string(), imageUrl: v.optional(v.string()) });
type Person = Infer<typeof personValidator>;
const personOf = (user: Doc<"users">): Person => ({ id: user._id, name: personName(user) || user.email, ...(user.avatarUrl ? { imageUrl: user.avatarUrl } : {}) });
/** Someone whose account is gone still has a name where their votes are. */
const SOMEONE = "Someone who left";

const modelValidator = v.object({ _id: v.id("models"), modelId: v.string(), name: v.string(), inputPricePerMillion: v.number(), outputPricePerMillion: v.number(), effort: v.optional(effortValidator), available: v.boolean() });

/**
 * A reviewer as every page shows them. `id` is what a vote, a rule or a link names them by: a person's account, an
 * address not joined yet as `invite:<address>`, and a model's own row. `row` is their row, which changes to them take.
 */
const reviewerValidator = v.object({
  row: v.id("screeningReviewers"),
  id: v.string(),
  kind: v.union(v.literal("person"), v.literal("model")),
  name: v.string(),
  imageUrl: v.optional(v.string()),
  email: v.optional(v.string()),
  model: v.optional(modelValidator),
  // From outside the screening's workspace: they vote as a guest of it.
  guest: v.optional(v.literal(true)),
  addedAt: v.number(),
  left: v.optional(v.number()),
  discarded: v.optional(v.number()),
  reminded: v.optional(v.number()),
  // Papers given to them, the ones they voted on by how, the ones a model couldn't read, the ones that still wait for them, and what a model has cost.
  dealt: v.number(),
  cast: v.number(),
  include: v.number(),
  maybe: v.number(),
  exclude: v.number(),
  failed: v.number(),
  waiting: v.number(),
  spent: v.number(),
});
export type ReviewerView = Infer<typeof reviewerValidator>;

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

/** What a list's row and a screening's frame both say of it. */
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
  reviewers: v.array(reviewerValidator),
  total: v.number(),
  counts: countsValidator,
  // What waits for the person looking: papers to vote on, conflicts to settle, and the papers a reviewer asked them about.
  forYou: v.number(),
  conflicts: v.number(),
  asked: v.array(v.id("screeningResults")),
  models: modelsStateValidator,
  // The screening whose models read before this one's, while its own wait for the workspace's slots.
  ahead: v.optional(v.object({ id: v.id("screeningJobs"), name: v.string() })),
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
  if (!user) return { ...base, id: reviewer.email ? `invite:${reviewer.email}` : reviewer._id, kind: "person", name: reviewer.email ?? SOMEONE, ...(reviewer.email ? { email: reviewer.email } : {}) };
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
    const head = await ctx.db.query("screeningVotes").withIndex("by_waitingWorkspace_and_waitingSince", (q) => q.eq("waitingWorkspace", job.workspaceId).gte("waitingSince", 0)).first();
    const ahead = head && head.jobId !== job._id ? await ctx.db.get("screeningJobs", head.jobId) : null;
    if (ahead) return { state: "waiting" as const, ahead: { id: ahead._id, name: ahead.name ?? "Another screening" } };
  }
  return { state: "reading" as const };
}

/** The papers of a screening a reviewer put a question to this person about, which still waits for their answer. */
async function askedOf(ctx: Pick<QueryCtx, "db">, jobId: Id<"screeningJobs">, userId: Id<"users">) {
  const open = await ctx.db.query("screeningMessages").withIndex("by_job_and_to_and_open", (q) => q.eq("jobId", jobId).eq("to", userId).eq("open", true)).take(50);
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
  const sources = check ? await ctx.db.query("screeningSources").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(200) : [];
  const total = check ? sources.reduce((sum, source) => sum + (source.removedAt === undefined ? source.taken : 0), 0) : job.totalPapers;
  const counts = { ...settled, waiting: Math.max(0, total - settled.include - settled.maybe - settled.exclude - settled.conflict) };
  const mine = reviewer ? reviewers.find((one) => one.row === reviewer._id) : undefined;
  const canResolve = job.rule?.resolver === actor.userId;
  const open = job.finishedAt === undefined;
  const { state, ahead } = await modelsNow(ctx, job, reviewers, progress, check);
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
    asked: await askedOf(ctx, job._id, actor.userId),
    models: state,
    ...(ahead ? { ahead } : {}),
    ...(check ? { gathering: { done: check.added, ...(check.by ? { by: check.by } : {}), first: check.from === 0 } } : {}),
    activeAt: Math.max(job.activeAt ?? 0, job.updatedAt),
  };
}

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

/** Screenings read at most for what waits for one person, and for what is shared with them. */
const MINE_MAX = 100;

export const mineAction = defineUserQuery({
  path: "screening/view:mine",
  description: "Lists the screenings that wait for the person in the workspace they act in, and in their own workspace the ones shared with them from elsewhere: `needs` are the open ones with papers for them to vote on, conflicts for them to settle or questions put to them, and `shared` the ones from other workspaces.",
  args: {},
  returns: v.object({ needs: v.array(summaryValidator), shared: v.array(summaryValidator) }),
  run: async (ctx, actor) => {
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
    const all = [...seen, ...settled];
    return { needs: all.filter((one) => one.member && one.forYou + one.conflicts + one.asked.length > 0), shared: all.filter((one) => !one.member) };
  },
});
export const mine = userQuery(mineAction);

export const tallyAction = defineUserQuery({
  path: "screening/view:tally",
  description: "Counts the workspace's screenings: the ones still open and the ones finished.",
  args: {},
  returns: v.object({ open: v.number(), finished: v.number() }),
  run: async (ctx, { workspaceId }) => ({ open: await countOf(ctx, screeningsOf(workspaceId, false)), finished: await countOf(ctx, screeningsOf(workspaceId, true)) }),
});
export const tally = userQuery(tallyAction);

const sourceValidator = v.object({
  id: v.id("screeningSources"),
  set: sourceSetValidator,
  name: v.string(),
  detail: v.optional(v.string()),
  first: v.optional(v.number()),
  last: v.optional(v.number()),
  addedAt: v.number(),
  removedAt: v.optional(v.number()),
  state: v.union(v.literal("waiting"), v.literal("reading"), v.literal("done"), v.literal("failed")),
  failure: v.optional(v.string()),
  // What it holds, how many of its papers were read, and of those the ones taken, merged with another source's and left out.
  total: v.optional(v.number()),
  read: v.number(),
  taken: v.number(),
  duplicates: v.number(),
  left: v.number(),
  checkedAt: v.optional(v.number()),
});

const checkValidator = v.object({ id: v.id("screeningChecks"), at: v.number(), by: v.optional(personValidator), state: v.union(v.literal("running"), v.literal("done"), v.literal("failed")), found: v.number(), added: v.number() });

/** Checks of its sources a screening's page lists: the latest. */
const CHECKS_SHOWN = 50;

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
      stars: v.array(v.number()),
      each: v.union(v.number(), v.literal("all")),
      blind: v.union(v.literal("after"), v.literal("always")),
      sources: v.array(sourceValidator),
      // Where its included papers go.
      destination: v.object({ kind: v.union(v.literal("none"), v.literal("new"), v.literal("collection"), v.literal("community")), name: v.optional(v.string()), collectionId: v.optional(v.id("collections")), prune: v.boolean() }),
      checks: v.array(checkValidator),
      // Whether its workspace is out of credits for its models, and what the workspace has, for someone who may see that.
      outOfCredits: v.boolean(),
      credits: v.optional(v.number()),
      // The person's own place on it, where they are a guest: to vote, or to look.
      guest: v.optional(v.union(v.literal("viewer"), v.literal("editor"))),
      // How many votes of theirs were cast before a criterion became a must-have, and ask for a new one.
      flagged: v.number(),
    }),
  ),
  run: async (ctx, actor, { jobId }) => {
    const standing = await standingOn(ctx, actor, jobId);
    if (!standing || standing.job.shape !== 2 || !standing.job.rule) return null;
    const { job, member, reviewer } = standing;
    const rule = standing.job.rule;
    const [summary, sources, checks, collection] = await Promise.all([
      summaryOf(ctx, actor, standing),
      ctx.db.query("screeningSources").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(200),
      ctx.db.query("screeningChecks").withIndex("by_job", (q) => q.eq("jobId", jobId)).order("desc").take(CHECKS_SHOWN),
      job.targetCollectionId ? ctx.db.get("collections", job.targetCollectionId) : null,
    ]);
    const checkers = new Map<Id<"users">, Person>();
    for (const check of checks) if (check.by && !checkers.has(check.by)) { const user = await ctx.db.get("users", check.by); checkers.set(check.by, user ? personOf(user) : { id: check.by, name: SOMEONE }); }
    const flagged = reviewer ? (await ctx.db.query("screeningVotes").withIndex("by_reviewer_and_flagged_and_place", (q) => q.eq("reviewerId", reviewer._id).eq("flagged", true)).take(1000)).length : 0;
    const guest = member ? null : ((await grantOf(ctx, jobId, actor.userId))?.role ?? null);
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
      checks: checks.map((check) => ({ id: check._id, at: check.at, ...(check.by ? { by: checkers.get(check.by)! } : {}), state: check.state, found: check.found, added: check.added })),
      outOfCredits: job.outOfCredits === true,
      // The workspace's credits are its members' to see.
      ...(member ? { credits: await availableCredits(ctx, job.workspaceId) } : {}),
      ...(guest ? { guest } : {}),
      flagged,
    };
  },
});
export const get = userQuery(getAction);

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
