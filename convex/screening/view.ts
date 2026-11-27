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
import { itemKey, moreValidator } from "../activity/validators";
import { availableCredits, planLimit } from "../billing/accounts";
import { modelsLimit } from "./screenings";
import { paperLimit } from "./slots";
import { countOf, screeningsOf } from "../lib/listCounts";
import { personName } from "../lib/people";
import { assistantQuery, defineUserQuery, userQuery, workspaceQuery } from "../lib/userActions";
import schema from "../schema";
import { grantOf, itemGuestsOf } from "../sharing/items";
import { hidesVotes, isFinal, modelsProgress, nameHas, readersFor, showsEarly, twinsNamed } from "../../lib/screening/rules";
import { readsPdfs } from "../../lib/assistant/files";
import { actorIn, inOwnWorkspace, type InWorkspace } from "../workspaces/actor";
import { standingOn, type Standing } from "./access";
import { progressRow } from "./bookkeeping";
import { dealable, inWhole, invitationsTo, laterChecks, modelName, modelsFree, nameOf, newFor, papersOf, readingModel, reviewersOf, SOMEONE, sourcesOf, viewId, waitingOf, waitsOn, wholePass } from "./dealing";
import { noticeOf } from "./notices";
import { NO_RESULTS } from "./settling";
import { invitedViewValidator, libraryWriteProblemValidator, retiredCriteriaValidator, unreadSourcesValidator, modelVotesValidator, checkSourcesValidator, criteriaValidator, ELSEWHERE_MAX, elsewhereValidator, everyValidator, figuresValidator, leftOutWhyValidator, PAIRS_MAX, reviewerViewsValidator, reviewerViewValidator, sourceViewsValidator, starsValidator } from "./validators";


const personValidator = v.object({ id: v.id("users"), name: v.string(), imageUrl: v.optional(v.string()) });
type Person = Infer<typeof personValidator>;
/** A person as a page shows them. One whose account is gone still has a name where their votes are. */
export const personOf = (user: Doc<"users"> | null, id: Id<"users">): Person => ({ id, name: nameOf(user), ...(user?.avatarUrl ? { imageUrl: user.avatarUrl } : {}) });

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
  // How the others voted is kept from the person looking (`keepsVotes`).
  keeps: v.boolean(),
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

type Counts = NonNullable<Doc<"screeningJobProgress">["reviewers"]>[Id<"screeningReviewers">];

/**
 * Whether how the other reviewers voted is kept from whoever looks: where votes are hidden until one has voted, a
 * reviewer who still has papers to vote on sees how far the others are, and not how they voted or how far they
 * agree. A count of someone's votes by how they went moves when they vote, which would tell their vote on a paper
 * the person has yet to vote on. A finished screening keeps nothing: no vote can be cast in it any more. One
 * function, for every figure a page or a file shows of the others.
 */
export const keepsVotes = (job: Pick<Doc<"screeningJobs">, "rule" | "finishedAt">, reviewer: Doc<"screeningReviewers"> | null, counts: Record<string, Counts> | undefined, reviewers: Iterable<Doc<"screeningReviewers">>, /** People invited who haven't answered: they count among its readers, as its pages count them (components/screening/data.ts `readersOf`). */ invited: number) =>
  job.rule !== undefined && hidesVotes(job.rule, readersFor(job.rule.each, [...reviewers].filter(dealable).length + invited)) && job.finishedAt === undefined && reviewer !== null && waitingOf(reviewer, counts?.[reviewer._id]) > 0;

/** A reviewer's row as the pages read it, with their counts. `kept`: how they voted is kept from whoever looks (`keepsVotes`). */
async function reviewerView(ctx: Pick<QueryCtx, "db">, job: Doc<"screeningJobs">, reviewer: Doc<"screeningReviewers">, counts: Counts | undefined, members: Map<Id<"users">, boolean>, kept = false): Promise<ReviewerView> {
  const tally = { cast: counts?.cast ?? 0, include: kept ? 0 : (counts?.include ?? 0), maybe: kept ? 0 : (counts?.maybe ?? 0), exclude: kept ? 0 : (counts?.exclude ?? 0), failed: counts?.failed ?? 0, closed: counts?.closed ?? 0, spent: counts?.spent ?? 0, missed: kept ? 0 : (counts?.missed ?? 0), ...(kept ? { kept: true as const } : {}) };
  const waiting = waitingOf(reviewer, tally);
  const base = { row: reviewer._id, addedAt: reviewer.addedAt, ...(reviewer.left === undefined ? {} : { left: reviewer.left }), ...(reviewer.discarded === undefined ? {} : { discarded: reviewer.discarded }), ...(reviewer.reminded === undefined ? {} : { reminded: reviewer.reminded }), dealt: reviewer.dealt, ...tally, waiting };
  if (reviewer.kind === "model") {
    const model = reviewer.modelId ? await ctx.db.get("models", reviewer.modelId) : null;
    return { ...base, id: reviewer._id, kind: "model", name: modelName(model), ...(model ? { model: { _id: model._id, modelId: model.modelId, name: modelName(model), inputPricePerMillion: model.inputPricePerMillion, outputPricePerMillion: model.outputPricePerMillion, ...(model.longPrompt ? { longPrompt: model.longPrompt } : {}), ...(model.contextLength === undefined ? {} : { contextLength: model.contextLength }), ...(reviewer.effort ? { effort: reviewer.effort } : {}), available: model.retiredAt === undefined && !model.hidden, files: readsPdfs(model.inputModalities) } } : {}) };
  }
  const user = reviewer.userId ? await ctx.db.get("users", reviewer.userId) : null;
  if (!user) return { ...base, id: reviewer._id, kind: "person", name: SOMEONE };
  if (!members.has(user._id)) members.set(user._id, (await actorIn(ctx, user, job.workspaceId)) !== null);
  return { ...base, ...personOf(user, user._id), kind: "person", ...(members.get(user._id) ? {} : { guest: true as const }) };
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
  // How far its models have read: the one furthest behind, as every page says it (`modelsProgress`).
  const [theirs, counted] = await Promise.all([reviewersOf(ctx, ahead._id), progressRow(ctx as QueryCtx, ahead._id)]);
  const read = modelsProgress(theirs.filter(readingModel).map((one) => ({ dealt: one.dealt, ...counted?.reviewers?.[one._id] })));
  // With none of its models behind, it is read through: the same figure its own frame shows then.
  const all = papersOf(ahead, counted);
  return { id: ahead._id, name: ahead.name ?? "Another screening", done: read?.done ?? all, of: read?.of ?? all };
}

/** The screenings something may wait for one person on, in any workspace: the ones they review, and the open ones whose conflicts they settle, reviewer or not. */
async function theirs(ctx: Pick<QueryCtx, "db">, userId: Id<"users">) {
  const [reviewing, settling] = await Promise.all([
    ctx.db.query("screeningReviewers").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(MINE_MAX),
    ctx.db.query("screeningJobs").withIndex("by_resolver_and_status", (q) => q.eq("rule.resolver", userId).eq("status", "processing")).order("desc").take(MINE_MAX),
  ]);
  return [...new Set([...reviewing.map((row) => row.jobId), ...settling.map((job) => job._id)])];
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
  const keeps = keepsVotes(job, reviewer, progress?.reviewers, rows, (await invitationsTo(ctx, job._id)).length);
  const viewed = await Promise.all(rows.map((row) => reviewerView(ctx, job, row, progress?.reviewers?.[row._id], members, keeps && row._id !== reviewer?._id && !showsEarly(job.rule!, row.kind))));
  // One model put on it at two efforts is two reviewers: each then says its effort, so a filter, a row or a vote names the one it means.
  const reviewers = twinsNamed(viewed, (model) => model.modelId);
  const settled = { ...NO_RESULTS, ...progress?.counts };
  const total = papersOf(job, progress, check);
  const counts = { ...settled, waiting: Math.max(0, total - settled.include - settled.maybe - settled.exclude - settled.conflict) };
  const canResolve = job.rule?.resolver === actor.userId;
  const { state, ahead } = await modelsNow(ctx, job, reviewers, progress, check);
  const waits = await waitsOn(ctx, job, actor.userId, reviewer, progress);
  return {
    id: job._id,
    name: job.name ?? "Screening",
    createdBy: personOf(creator, job.createdBy),
    createdAt: job.createdAt,
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
    ...(job.paused ? { paused: true } : {}),
    ...(job.living ? { living: job.living } : {}),
    resolver: personOf(resolver, job.rule?.resolver ?? job.createdBy),
    settle: job.rule?.settle ?? "all",
    workspace: await workspaceOf(ctx, job.workspaceId),
    me: actor.userId,
    member,
    isReviewer: reviewer !== null,
    canResolve,
    keeps,
    reviewers,
    total,
    counts,
    forYou: waits.forYou,
    conflicts: waits.conflicts,
    asked: waits.asked.length,
    ...(waits.asked[0] ? { askedFirst: waits.asked[0] } : {}),
    models: state,
    ...(ahead ? { ahead } : {}),
    criteria: job.criteria?.length ?? 0,
    ...(check ? { gathering: { done: check.added, ...(check.by ? { by: check.by } : {}), first: check.from === 0 } } : {}),
    activeAt: job.activeAt ?? job.updatedAt,
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
    return { me: personOf(me, userId), credits, limits: { papers: papers ?? null, models, atOnce }, ...(reading ? { reading } : {}) };
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
  args: { show: v.union(v.literal("all"), v.literal("open"), v.literal("finished")), sort: SORTS, by: v.optional(v.id("users")), text: v.optional(v.string()), /** Only the ones that have included a paper: what another screening or an extraction can take its papers from. */ included: v.optional(v.literal(true)), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(summaryValidator),
  run: async (ctx, actor, { show, sort, by, text, included, paginationOpts }) => {
    const { workspaceId } = actor;
    // A name is found by its words among all of the workspace's screenings, in the order asked for.
    const fits = (job: Doc<"screeningJobs">) => job.shape === 2 && job.status !== "draft" && (show === "all" || (show === "finished") === (job.finishedAt !== undefined)) && (!by || job.createdBy === by) && nameHas(job.name ?? "", text ?? "");
    const keeps = async (job: Doc<"screeningJobs">) => fits(job) && (!included || ((await progressRow(ctx as QueryCtx, job._id))?.counts?.include ?? 0) > 0);
    const options = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, PAGE_MAX) };
    const jobs = stream(ctx.db, schema).query("screeningJobs");
    const read = await (sort === "name" ? jobs.withIndex("by_workspace_and_name", (q) => q.eq("workspaceId", workspaceId)).order("asc") : sort === "active" ? jobs.withIndex("by_workspace_and_activeAt", (q) => q.eq("workspaceId", workspaceId)).order("desc") : jobs.withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).order(sort === "oldest" ? "asc" : "desc"))
          .filterWith(keeps)
          .paginate({ ...options, maximumRowsRead: FILTER_ROWS });
    const page = await Promise.all(read.page.map(async (job) => summaryOf(ctx, actor, (await standingOn(ctx, actor, job._id))!)));
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
    const { userId } = actor;
    const own = await inOwnWorkspace(ctx, actor);
    // The ones they review or settle, and in their own workspace the ones given to them from outside.
    const given = own ? await ctx.db.query("itemAccess").withIndex("by_user_and_kind_and_grantedAt", (q) => q.eq("userId", userId).eq("kind", "screening")).order("desc").take(MINE_MAX) : [];
    const ids = [...new Set([...(await theirs(ctx, userId)).map((id) => id as string), ...given.map((row) => row.item)])];
    // What waits for them, and what is shared with them whether or not anything waits: only those are summarised.
    const kept = (await Promise.all(ids.map(async (id) => {
      const jobId = ctx.db.normalizeId("screeningJobs", id);
      const standing = jobId ? await standingOn(ctx, actor, jobId) : null;
      if (standing?.job.shape !== 2) return [];
      const { job, member, reviewer } = standing;
      if (member) {
        const waits = await waitsOn(ctx, job, userId, reviewer, await progressRow(ctx as QueryCtx, job._id));
        if (job.finishedAt !== undefined || !(waits.forYou + waits.conflicts + waits.asked.length)) return [];
      }
      return [await summaryOf(ctx, actor, standing)];
    }))).flat();
    return { page: kept, isDone: true, continueCursor: "" };
  },
});

/** Open screenings looked at for one whose models are reading. */
const READING_LOOKED = 5;

/** The open screenings something waits for the person on, in any workspace, with what waits on each. */
async function waitsFor(ctx: Pick<QueryCtx, "db">, userId: Id<"users">) {
  const found = await Promise.all((await theirs(ctx, userId)).map(async (jobId) => {
    const job = await ctx.db.get("screeningJobs", jobId);
    if (!job || job.shape !== 2 || job.finishedAt !== undefined) return [];
    const [reviewer, progress] = await Promise.all([ctx.db.query("screeningReviewers").withIndex("by_job_and_user", (q) => q.eq("jobId", jobId).eq("userId", userId)).first(), progressRow(ctx as QueryCtx, jobId)]);
    const waits = await waitsOn(ctx, job, userId, reviewer, progress);
    return waits.forYou + waits.conflicts + waits.asked.length ? [{ job, forYou: waits.forYou, conflicts: waits.conflicts, asked: waits.asked.length }] : [];
  }));
  return found.flat();
}

/**
 * What the rail says of Screen. `reading`: the workspace's newest open screening whose models still have papers to
 * read, with how many of their readings are done, for the ring around its icon; null where none is reading, since a
 * screening stays open while its people vote and that is no run to wait on. `waiting`: how many screenings wait for
 * the person, in whichever workspace, for the count on the icon.
 */
export const rail = workspaceQuery({
  args: {},
  returns: v.union(v.null(), v.object({ reading: v.union(v.null(), v.object({ jobId: v.id("screeningJobs"), done: v.number(), total: v.number() })), waiting: v.number() })),
  signedOut: null,
  handler: async (ctx, { userId, workspaceId }) => {
    const waiting = (await waitsFor(ctx, userId)).length;
    const open = await ctx.db.query("screeningJobs").withIndex("by_workspace_status", (q) => q.eq("workspaceId", workspaceId).eq("status", "processing")).order("desc").take(READING_LOOKED);
    for (const job of open) {
      if (job.shape !== 2 || !modelsFree(job)) continue;
      const [reviewers, progress] = await Promise.all([reviewersOf(ctx, job._id), progressRow(ctx as QueryCtx, job._id)]);
      const read = modelsProgress(reviewers.filter(readingModel).map((one) => ({ dealt: one.dealt, ...progress?.reviewers?.[one._id] })));
      if (read) return { reading: { jobId: job._id, done: read.done, total: read.of }, waiting };
    }
    return { reading: null, waiting };
  },
});

/**
 * Lists the screenings that wait for the person in a workspace other than the one they are in, which that
 * workspace's own list doesn't hold: the ones of another workspace they belong to, and, from an organization's
 * pages, the ones shared with them from outside, which open in their own workspace.
 */
export const elsewhere = workspaceQuery({
  args: {},
  returns: elsewhereValidator,
  handler: async (ctx, actor) => {
    const [user, own] = await Promise.all([ctx.db.get("users", actor.userId), inOwnWorkspace(ctx, actor)]);
    if (!user) return [];
    const there = (await waitsFor(ctx, actor.userId)).filter(({ job }) => job.workspaceId !== actor.workspaceId);
    const pointed = await Promise.all(there.map(async ({ job, forYou, conflicts, asked }) => {
      const member = (await actorIn(ctx, user, job.workspaceId)) !== null;
      // One shared with them from outside is in their own workspace's list already.
      if (!member && own) return [];
      const workspace = await workspaceOf(ctx, job.workspaceId);
      return [{ id: job._id, name: job.name ?? "Screening", in: workspace.name, ...(member && workspace.slug ? { slug: workspace.slug } : {}), forYou, conflicts, asked }];
    }));
    return pointed.flat().slice(0, ELSEWHERE_MAX);
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

const checkValidator = v.object({
  id: v.id("screeningChecks"),
  at: v.number(),
  by: v.optional(personValidator),
  state: v.union(v.literal("running"), v.literal("done"), v.literal("failed")),
  first: v.boolean(),
  found: v.number(),
  added: v.number(),
  // Of what it found, the records left out: the rest of what it found was in the screening already.
  left: v.optional(v.number()),
  unread: unreadSourcesValidator,
  // Where the papers it added stand now, for a check that added few enough to count.
  counts: v.optional(countsValidator),
  // The papers a later check added, by the source that brought them.
  sources: checkSourcesValidator,
});
/** The most papers a check may have added for where they stand to be counted with it. */
const CHECK_COUNTED = 200;

/** Checks one page of a screening's checks holds at most, and the latest of them looked through for the last that brought papers. */
const CHECKS_PAGE = 50;
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
      retired: retiredCriteriaValidator,
      stars: starsValidator,
      each: v.union(v.number(), v.literal("all")),
      blind: v.union(v.literal("after"), v.literal("always")),
      modelVotes: modelVotesValidator,
      sources: sourceViewsValidator,
      // Where its included papers go.
      destination: v.object({ kind: v.union(v.literal("none"), v.literal("new"), v.literal("collection"), v.literal("community")), name: v.optional(v.string()), collectionId: v.optional(v.id("collections")), libraryId: v.optional(v.id("evidenceLibraries")), libraryCollection: v.optional(v.string()), prune: v.boolean(), problem: v.optional(libraryWriteProblemValidator), pruneProblem: v.optional(libraryWriteProblemValidator) }),
      // The papers its workspace's models read at once, as its plan gives.
      atOnce: v.number(),
      // Whether it emails the person looking: new papers to vote on, conflicts to settle, a colleague's reminder. Theirs to turn off (./notices.ts `setEmails`).
      emails: v.boolean(),
      // Whether its workspace is out of credits for its models, and what the workspace has, for someone who may see that.
      outOfCredits: v.boolean(),
      credits: v.optional(v.number()),
      // The person's own place on it, where they are a guest: to vote, or to look.
      guest: v.optional(v.union(v.literal("viewer"), v.literal("editor"))),
      // How many votes of theirs were cast before a criterion became a must-have, and ask for a new one.
      flagged: v.number(),
      // The people it is shared with from outside its workspace, invitations still waiting included.
      guests: v.number(),
      // The invitations to vote on it that wait for an answer, for its workspace's members: who was asked. Its list of people has every invitation.
      invited: invitedViewValidator,
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
    const lately = await laterChecks(ctx, jobId);
    const last = lately.find((check) => check.added > 0);
    const brought = last ? await ctx.db.query("screeningResults").withIndex("by_job_and_check", (q) => q.eq("jobId", jobId).eq("checkId", last._id)).take(LATEST_COUNTED) : [];
    const theirs = last && reviewer ? await newFor(ctx, reviewer._id, last, LATEST_COUNTED) : 0;
    return {
      ...summary,
      atOnce: await paperLimit(ctx, job.workspaceId),
      emails: !(await noticeOf(ctx, jobId, actor.userId))?.off,
      ...(job.question ? { question: job.question } : {}),
      criteria: job.criteria ?? [],
      retired: job.retiredCriteria ?? [],
      stars: job.stars ?? [],
      each: rule.each,
      blind: rule.blind,
      modelVotes: rule.models ?? "vote",
      sources: sources.map((source) => ({ id: source._id, set: source.set, name: source.name, ...(source.detail ? { detail: source.detail } : {}), ...(source.facts?.length ? { facts: source.facts } : {}), ...(source.first === undefined ? {} : { first: source.first }), ...(source.last === undefined ? {} : { last: source.last }), addedAt: source.addedAt, ...(source.removedAt === undefined ? {} : { removedAt: source.removedAt }), state: source.state, ...(source.failure ? { failure: source.failure } : {}), ...(source.total === undefined ? {} : { total: source.total }), read: source.read, taken: source.taken, duplicates: source.duplicates, left: source.left, bare: source.bare ?? 0, filed: source.filed ?? 0, filePages: source.filePages ?? 0, ...(source.fileSpread ? { fileSpread: source.fileSpread } : {}), ...(source.capped ? { capped: true as const } : {}), ...(source.checkedAt === undefined ? {} : { checkedAt: source.checkedAt }) })),
      destination: job.libraryDestination
        ? { kind: "community" as const, name: job.libraryDestination.name, libraryId: job.libraryDestination.libraryId, libraryCollection: job.libraryDestination.collection, prune: job.prune === true, ...(job.libraryWriteProblem ? { problem: job.libraryWriteProblem } : {}), ...(job.libraryPruneProblem ? { pruneProblem: job.libraryPruneProblem } : {}) }
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
      // The invitations still waiting, which papers wait for as for anyone: a guest is told how many, and never whose address.
      invited: (await invitationsTo(ctx, jobId)).map((one) => (member ? { email: one.email, ...(one.delivery === "failed" ? { undelivered: true as const } : {}) } : {})),
      ...(lately[0] ? { lastCheck: { at: lately[0].endedAt ?? lately[0].at, found: lately[0].found, added: lately[0].added } } : {}),
      ...(last ? { latest: { id: last._id, at: last.endedAt ?? last.at, added: last.added, open: brought.filter((paper) => !paper.withdrawn && !isFinal(paper.result)).length, mine: theirs } } : {}),
    };
  },
});
export const get = userQuery(getAction);
export const getForAssistant = assistantQuery(getAction);

const CHANGED = new Set(["settings", "reviewerAdded", "reviewerRemoved", "madeViewer"]);
/** Checks counted for a methods paragraph, saves of its settings counted, and votes counted for a person's pace. */
const CHECKS_COUNTED = 400;
const CHANGES_COUNTED = 200;
const RECENT_VOTES = 500;

export const figuresAction = defineUserQuery({
  path: "screening/view:figures",
  description:
    "Reads the figures a screening's overview and its files are drawn from: its excluded papers by the reason, its included papers by the source that brought each, how far each pair of reviewers agrees (a 3 by 3 count of their votes on the papers both voted on, include, maybe and exclude by the same three), " +
    "how many votes each person cast since `since`, how many papers it started with, its later checks for new papers with what they found and added, and how many times its settings were changed.",
  args: { jobId: v.id("screeningJobs"), since: v.number() },
  returns: v.union(v.null(), figuresValidator),
  run: async (ctx, actor, { jobId, since }) => {
    const standing = await standingOn(ctx, actor, jobId);
    if (!standing || standing.job.shape !== 2) return null;
    const [progress, reviewers, pairs, checks, saves] = await Promise.all([
      progressRow(ctx as QueryCtx, jobId),
      reviewersOf(ctx, jobId),
      ctx.db.query("screeningAgreement").withIndex("by_job_and_a_and_b", (q) => q.eq("jobId", jobId)).take(PAIRS_MAX),
      ctx.db.query("screeningChecks").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(CHECKS_COUNTED),
      ctx.db.query("activity").withIndex("by_workspace_and_item", (q) => q.eq("workspaceId", standing.job.workspaceId).eq("item", itemKey("screening", jobId))).take(CHANGES_COUNTED),
    ]);
    const idOf = new Map(reviewers.map((one) => [one._id, viewId(one)]));
    const people = reviewers.filter((one) => one.kind === "person" && one.left === undefined && one.userId);
    const recent = await Promise.all(people.map(async (one) => [viewId(one), (await ctx.db.query("screeningVotes").withIndex("by_reviewer_and_status_and_at", (q) => q.eq("reviewerId", one._id).eq("status", "cast").gte("at", since)).take(RECENT_VOTES)).length] as const));
    // The searches for papers its sources gained. A save that read a source it added or widened searched nothing again.
    const later = checks.filter((check) => check.search && check.state === "done");
    return {
      reasons: progress?.reasons ?? {},
      included: progress?.included ?? {},
      // How far two reviewers agree is how they voted, for someone who still has papers to vote on.
      pairs: keepsVotes(standing.job, standing.reviewer, progress?.reviewers, reviewers, (await invitationsTo(ctx, jobId)).length) ? [] : pairs.flatMap((pair) => (idOf.has(pair.a) && idOf.has(pair.b) ? [{ a: idOf.get(pair.a)!, b: idOf.get(pair.b)!, matrix: pair.matrix }] : [])),
      recent: Object.fromEntries(recent),
      startedWith: checks.find((check) => check.from === 0)?.added ?? 0,
      checks: { later: later.length, ...(later.length ? { lastAt: later.at(-1)!.endedAt ?? later.at(-1)!.at } : {}), found: later.reduce((sum, check) => sum + check.found, 0), added: later.reduce((sum, check) => sum + check.added, 0), unread: later.filter((check) => (check.unread?.length ?? 0) > 0).length },
      // What the methods paragraph says was changed: the settings, and who reviews.
      changes: saves.filter((row) => CHANGED.has(row.code ?? "")).length,
      changedParts: [...new Set(saves.flatMap((row) => (row.code === "settings" ? (row.more ?? []).flatMap((line) => (line.code === "part" && line.detail ? [line.detail] : [])) : CHANGED.has(row.code ?? "") ? ["reviewers"] : [])))].slice(0, 12),
    };
  },
});
export const figures = userQuery(figuresAction);
export const figuresForAssistant = assistantQuery(figuresAction);

/** What a source held that the screening doesn't take, a page at a time. */
export const leftOutAction = defineUserQuery({
  path: "screening/view:leftOut",
  description: "Lists what one of a screening's sources held and the screening doesn't take, a page at a time, each with why: no abstract and no PDF of its own, no title, a DOI that wasn't found, or a file that doesn't open.",
  args: { jobId: v.id("screeningJobs"), sourceId: v.id("screeningSources"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ id: v.id("screeningLeftOut"), name: v.string(), why: leftOutWhyValidator })),
  run: async (ctx, actor, { jobId, sourceId, paginationOpts }) => {
    const standing = await standingOn(ctx, actor, jobId);
    const source = standing ? await ctx.db.get("screeningSources", sourceId) : null;
    if (source?.jobId !== jobId) return { page: [], isDone: true, continueCursor: "" };
    // What its last whole reading left out: a paper an earlier one left out that has an abstract now, or is outside its range now, is not listed.
    const read = await stream(ctx.db, schema).query("screeningLeftOut").withIndex("by_source_and_pass", (q) => q.eq("sourceId", sourceId).gte("pass", wholePass(source))).filterWith(async (row) => inWhole(source, row)).paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 100), maximumRowsRead: FILTER_ROWS });
    return { ...read, page: read.page.map((one) => ({ id: one._id, name: one.name, why: one.why })) };
  },
});
export const leftOut = userQuery(leftOutAction);
export const leftOutForAssistant = assistantQuery(leftOutAction);

export const mergedAction = defineUserQuery({
  path: "screening/view:merged",
  description: "Lists the records one of a screening's sources held that the screening already had, a page at a time: each with the paper it was merged into, and the source that brought that paper.",
  args: { jobId: v.id("screeningJobs"), sourceId: v.id("screeningSources"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ id: v.id("screeningMerged"), name: v.string(), paper: v.union(v.null(), v.object({ id: v.id("screeningResults"), title: v.string(), sourceId: v.optional(v.id("screeningSources")) })) })),
  run: async (ctx, actor, { jobId, sourceId, paginationOpts }) => {
    const standing = await standingOn(ctx, actor, jobId);
    const source = standing ? await ctx.db.get("screeningSources", sourceId) : null;
    if (source?.jobId !== jobId) return { page: [], isDone: true, continueCursor: "" };
    // What its last whole reading merged, as its left-out records are listed (`leftOut`).
    const read = await stream(ctx.db, schema).query("screeningMerged").withIndex("by_source_and_pass", (q) => q.eq("sourceId", sourceId).gte("pass", wholePass(source))).filterWith(async (row) => inWhole(source, row)).paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 100), maximumRowsRead: FILTER_ROWS });
    const page = await Promise.all(read.page.map(async (one) => {
      const paper = await ctx.db.get("screeningResults", one.into);
      // The paper it was merged into may since have left with its source.
      return { id: one._id, name: one.name, paper: paper && paper.jobId === jobId && !paper.withdrawn ? { id: paper._id, title: paper.title, ...(paper.sourceId ? { sourceId: paper.sourceId } : {}) } : null };
    }));
    return { ...read, page };
  },
});
export const merged = userQuery(mergedAction);
export const mergedForAssistant = assistantQuery(mergedAction);

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
    for (const row of read.page) if (!people.has(row.by)) { const user = await ctx.db.get("users", row.by); people.set(row.by, personOf(user, row.by)); }
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
    for (const check of read.page) if (check.by && !people.has(check.by)) { const user = await ctx.db.get("users", check.by); people.set(check.by, personOf(user, check.by)); }
    const stand = async (check: Doc<"screeningChecks">) => {
      if (check.from === 0 || !check.added || check.added > CHECK_COUNTED) return undefined;
      const papers = await ctx.db.query("screeningResults").withIndex("by_job_and_check", (q) => q.eq("jobId", jobId).eq("checkId", check._id)).take(CHECK_COUNTED);
      const counts = { include: 0, maybe: 0, exclude: 0, conflict: 0, waiting: 0 };
      for (const paper of papers) if (!paper.withdrawn) counts[paper.result ?? "waiting"]++;
      return counts;
    };
    return { ...read, page: await Promise.all(read.page.map(async (check) => { const counts = await stand(check); return { id: check._id, at: check.at, ...(check.by ? { by: people.get(check.by)! } : {}), state: check.state, first: check.from === 0, found: check.found, added: check.added, ...(check.left ? { left: check.left } : {}), ...(check.unread?.length ? { unread: check.unread } : {}), ...(counts ? { counts } : {}), ...(check.from === 0 || !check.bySource ? {} : { sources: Object.entries(check.bySource).map(([id, added]) => ({ id: id as Id<"screeningSources">, added })) }) }; })) };
  },
});
export const checks = userQuery(checksAction);
export const checksForAssistant = assistantQuery(checksAction);
