/**
 * Making a screening with reviewers and running it (plans/screening-reviewers): starting one, pausing its models and
 * letting them go on, finishing it and opening it again. Its settings are changed in ./settings.ts, its people and
 * models in ./reviewers.ts, and its sources are read in ./gathering.ts.
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { planLimit } from "../billing/accounts";
import { effortValidator } from "../aiModelConfig/validators";
import { requireActiveUser } from "../lib/auth";
import { createError } from "../lib/errors";
import { internalMutation } from "../lib/functions";
import { MAX_QUESTIONS, MAX_STARS } from "../lib/listCaps";
import { workspaceAction, workspaceMutation } from "../lib/userActions";
import { actorIn, requireMakerOrAdmin } from "../workspaces/actor";
import { usableFor } from "../../lib/ai/tasks";
import { defaultPoints, defaultStars, shortOf, type Criterion } from "../../lib/screening/rules";
import { requireMember } from "./access";
import { MAX_REVIEWERS, MAX_SOURCE_ROWS, reviewersOf, sourcesOf } from "./dealing";
import { startCheck } from "./gathering";
import { logChange } from "./log";
import { destination } from "./mutations";
import { NO_RESULTS } from "./settling";
import { everyValidator, libraryDestinationValidator, MAX_TERMS, prunable, saveToValidator, SCREENING_TEXT, sourceSetValidator } from "./validators";

/** A criterion as a form sends it: one with no key is new, and what it leaves out takes its usual value. */
export const criterionInput = v.object({
  key: v.optional(v.string()),
  text: v.string(),
  short: v.optional(v.string()),
  must: v.boolean(),
  note: v.optional(v.string()),
  terms: v.optional(v.array(v.string())),
  points: v.optional(v.object({ yes: v.number(), no: v.number(), unclear: v.number() })),
});
export const ruleInput = v.object({ each: v.union(v.number(), v.literal("all")), settle: v.union(v.literal("all"), v.literal("most"), v.literal("one")), resolver: v.optional(v.id("users")), blind: v.union(v.literal("after"), v.literal("always")) });
export const sourceInput = v.object({ set: sourceSetValidator, name: v.string(), detail: v.optional(v.string()), first: v.optional(v.number()), last: v.optional(v.number()) });
export const modelInput = v.object({ model: v.string(), effort: v.optional(effortValidator) });

/** The most sources one screening has, and the most models where its workspace's plan sets no number. */
export const MAX_SOURCES = 20;
const MODELS_A_SCREENING = 5;
/** How many models one screening in the workspace may have reading: its plan's number (lib/billing/plans.ts `screening_models`). */
export const modelsLimit = async (ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces">) => (await planLimit(ctx, workspaceId, "screening_models")) ?? MODELS_A_SCREENING;

/** Criteria as a screening keeps them, from what a form sent: checked, trimmed, each with a key that never changes. */
export function criteriaFrom(sent: Infer<typeof criterionInput>[], kept: Criterion[] = [], now = Date.now()): Criterion[] {
  if (!sent.length) throw createError("VALIDATION_ERROR", "Add at least one criterion.");
  if (sent.length > MAX_QUESTIONS) throw createError("VALIDATION_ERROR", `A screening has up to ${MAX_QUESTIONS} criteria.`);
  const keys = new Set<string>();
  return sent.map((one) => {
    const text = one.text.trim();
    if (!text) throw createError("VALIDATION_ERROR", "Write each criterion's question.");
    if (text.length > SCREENING_TEXT.criterion || (one.note?.length ?? 0) > SCREENING_TEXT.note) throw createError("VALIDATION_ERROR", "That criterion is too long.");
    const before = one.key ? kept.find((criterion) => criterion.key === one.key) : undefined;
    let key = before?.key ?? `c${crypto.randomUUID().slice(0, 8)}`;
    while (keys.has(key)) key = `c${crypto.randomUUID().slice(0, 8)}`;
    keys.add(key);
    const terms = [...new Set((one.terms ?? []).map((term) => term.trim().slice(0, SCREENING_TEXT.term)).filter(Boolean))].slice(0, MAX_TERMS);
    return { key, text, short: (one.short?.trim() || shortOf(text)).slice(0, SCREENING_TEXT.short), must: one.must, ...(one.note?.trim() ? { note: one.note.trim() } : {}), terms, addedAt: before?.addedAt ?? now, points: one.points ?? before?.points ?? defaultPoints() };
  });
}

/** The points each star starts at: five of them, never falling. */
export function starsFrom(sent: number[] | undefined, criteria: number) {
  const stars = sent ?? defaultStars(criteria);
  if (stars.length !== MAX_STARS || stars.some((from, at) => !Number.isFinite(from) || (at > 0 && from < stars[at - 1]!))) throw createError("VALIDATION_ERROR", "Give the points each of the five stars starts at, lowest first.");
  return stars;
}

/** What a screening still writes for the pages and jobs from before reviewers, until those fields go: its criteria as questions, and their points as scoring rules. */
export const legacyOf = (criteria: Criterion[], stars: number[]) => ({
  questions: criteria.map(({ key, text }) => ({ key, question: text })),
  scoringConfig: { rules: criteria.map((criterion) => ({ questionKey: criterion.key, yesPoints: criterion.points.yes, noPoints: criterion.points.no, nullPoints: criterion.points.unclear, required: criterion.must })), starThresholds: stars.map((minScore, at) => ({ minScore, stars: at + 1 })) },
});

/** A model as a screening runs it: one of the catalogue's that can screen, by its slug. */
export async function modelFor(ctx: Pick<MutationCtx, "db">, slug: string) {
  const model = await ctx.db.query("models").withIndex("by_model_id", (q) => q.eq("modelId", slug)).first();
  if (!model || model.retiredAt !== undefined || model.hidden || !usableFor(model, "screenAll")) throw createError("VALIDATION_ERROR", "That model can't screen papers. Pick another.");
  return model;
}

const setup = {
  name: v.string(),
  question: v.optional(v.string()),
  criteria: v.array(criterionInput),
  stars: v.optional(v.array(v.number())),
  rule: ruleInput,
  sources: v.array(sourceInput),
  // The people who vote, each a member of the workspace, and the models that do.
  people: v.array(v.id("users")),
  models: v.array(modelInput),
  saveTo: saveToValidator,
  prune: v.optional(v.boolean()),
  living: v.optional(everyValidator),
};

/** How long until a living screening's next check. */
export const EVERY_MS = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 } as const;

/**
 * Makes a screening, with its sources, its reviewers and its first look in the sources. Whoever makes it starts it
 * and settles its conflicts unless someone else is named.
 */
export const open = internalMutation({
  args: { userId: v.id("users"), workspaceId: v.id("workspaces"), author: v.union(v.literal("user"), v.literal("assistant")), ...setup, libraryDestination: v.optional(libraryDestinationValidator), pruneName: v.optional(v.string()) },
  returns: v.object({ jobId: v.id("screeningJobs") }),
  handler: async (ctx, { userId, workspaceId, author, name, question, criteria: sent, stars: sentStars, rule, sources, people, models, saveTo, prune, living, libraryDestination, pruneName }) => {
    const user = await requireActiveUser(ctx, userId);
    const writer = { userId, workspaceId };
    const title = name.trim();
    if (!title || title.length > SCREENING_TEXT.name) throw createError("VALIDATION_ERROR", "Give the screening a name of up to 200 characters.");
    if ((question?.length ?? 0) > SCREENING_TEXT.question) throw createError("VALIDATION_ERROR", "That research question is too long.");
    if (!sources.length || sources.length > MAX_SOURCES) throw createError("VALIDATION_ERROR", `A screening reads 1 to ${MAX_SOURCES} sources.`);
    if (!people.length && !models.length) throw createError("VALIDATION_ERROR", "Add at least one reviewer: a person or a model.");
    if (new Set(people).size !== people.length || new Set(models.map((one) => `${one.model}:${one.effort ?? ""}`)).size !== models.length) throw createError("VALIDATION_ERROR", "Each reviewer is on a screening once.");
    const most = await modelsLimit(ctx, workspaceId);
    if (models.length > most) throw createError("VALIDATION_ERROR", `Your plan runs up to ${most} models on a screening.`);
    if (people.length + models.length > MAX_REVIEWERS) throw createError("VALIDATION_ERROR", `A screening has up to ${MAX_REVIEWERS} reviewers.`);
    const now = Date.now();
    const criteria = criteriaFrom(sent, [], now);
    const stars = starsFrom(sentStars, criteria.length);
    const each = rule.each === "all" ? ("all" as const) : Math.floor(rule.each);
    if (each !== "all" && (each < 0 || each > MAX_REVIEWERS)) throw createError("VALIDATION_ERROR", "Pick how many people read each paper.");
    // People vote as members of the workspace. Someone from outside is invited from the screening's People panel.
    const members = await Promise.all(people.map((id) => ctx.db.get("users", id)));
    for (const member of members) if (!member || member.state !== "active" || !(await actorIn(ctx, member, workspaceId))) throw createError("VALIDATION_ERROR", "Only members of this workspace are added here. Invite anyone else by email.");
    const resolver = rule.resolver ?? userId;
    const settles = await ctx.db.get("users", resolver);
    if (!settles || !(await actorIn(ctx, settles, workspaceId))) throw createError("VALIDATION_ERROR", "Conflicts are settled by a member of this workspace.");
    const picked = await Promise.all(models.map(async (one) => ({ model: await modelFor(ctx, one.model), effort: one.effort })));
    if (prune && !sources.some((source) => prunable(source.set.kind === "upload" || source.set.kind === "pdf" || source.set.kind === "dois" ? undefined : source.set))) throw createError("VALIDATION_ERROR", "Only a collection's papers can leave it.");
    // A new collection is made with the first paper that is included, so a screening that includes none leaves none behind.
    const later = saveTo.kind === "new" ? saveTo.name.trim() : undefined;
    if (later === "") throw createError("VALIDATION_ERROR", "Collection name cannot be empty");
    const jobId = await ctx.db.insert("screeningJobs", {
      workspaceId,
      createdBy: user._id,
      status: "processing",
      totalPapers: 0,
      reading: true,
      shape: 2,
      name: title,
      ...(question?.trim() ? { question: question.trim() } : {}),
      criteria,
      stars,
      rule: { each, settle: rule.settle, resolver, blind: rule.blind },
      ...(living ? { living: { every: living, next: now + EVERY_MS[living] } } : {}),
      ...legacyOf(criteria, stars),
      screeningId: await ctx.db.insert("screenings", { workspaceId, version: 0, createdAt: now }),
      ...(later ? { newCollection: later } : await destination(ctx, writer, saveTo)),
      ...(libraryDestination ? { libraryDestination } : {}),
      ...(prune ? { prune: true as const } : {}),
      ...(pruneName ? { pruneName } : {}),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("screeningJobProgress", { jobId, completed: 0, skipped: 0, failed: 0, qualified: 0, counts: NO_RESULTS });
    for (const source of sources) await addSource(ctx, jobId, userId, source, now);
    for (const person of people) await ctx.db.insert("screeningReviewers", { jobId, kind: "person", userId: person, addedAt: now, addedBy: userId, dealt: 0 });
    for (const { model, effort } of picked) await ctx.db.insert("screeningReviewers", { jobId, kind: "model", modelId: model._id, ...(effort ? { effort } : {}), addedAt: now, addedBy: userId, dealt: 0 });
    await startCheck(ctx, (await ctx.db.get("screeningJobs", jobId))!, userId, 0);
    await logChange(ctx, { userId, author }, { _id: jobId, workspaceId }, "started", { detail: title, more: [{ code: "sources", count: sources.length }, ...(people.length ? [{ code: "people", count: people.length }] : []), ...(picked.length ? [{ code: "models", count: picked.length }] : [])] });
    return { jobId };
  },
});

/** A source's row, waiting to be read. */
export async function addSource(ctx: MutationCtx, jobId: Id<"screeningJobs">, userId: Id<"users">, { set, name, detail, first, last }: Infer<typeof sourceInput>, now: number) {
  if (first !== undefined && (!Number.isSafeInteger(first) || first < 1)) throw createError("VALIDATION_ERROR", "Pick papers from 1 up, with the first before the last");
  if (last !== undefined && (!Number.isSafeInteger(last) || last < (first ?? 1))) throw createError("VALIDATION_ERROR", "Pick papers from 1 up, with the first before the last");
  if ((await sourcesOf(ctx, jobId)).length >= MAX_SOURCE_ROWS) throw createError("VALIDATION_ERROR", "This screening has had as many sources as one can have. Start another screening for more.");
  return await ctx.db.insert("screeningSources", { jobId, set, name: name.trim().slice(0, SCREENING_TEXT.name) || "Papers", ...(detail?.trim() ? { detail: detail.trim().slice(0, SCREENING_TEXT.name) } : {}), ...(first === undefined ? {} : { first }), ...(last === undefined ? {} : { last }), addedAt: now, addedBy: userId, state: "waiting", read: 0, taken: 0, duplicates: 0, left: 0 });
}

/**
 * Starts a screening in the workspace: papers from one or more sources are given to its reviewers, people and AI
 * models, who each vote include, maybe or exclude, and a rule settles each paper. It is made at once and its papers
 * are read after, a step at a time. Models answer every criterion and are paid for from the workspace's credits, a
 * paper at a time; people's votes cost nothing.
 */
export const create = workspaceAction({
  args: setup,
  returns: v.object({ jobId: v.id("screeningJobs") }),
  // Typed here: the generated API's types depend on this module, so inference would loop.
  handler: async (ctx, actor, args): Promise<{ jobId: Id<"screeningJobs"> }> => {
    const { saveTo } = args;
    // A community collection it saves to, or takes papers out of, is one the person changes there: checked, or made, before the screening is.
    const pruned = args.prune ? args.sources.flatMap((source) => (source.set.kind === "evidenceLibrary" && "readerCollection" in source.set.source && source.set.source.readerCollection ? [{ libraryId: source.set.libraryId, collection: source.set.source.readerCollection }] : []))[0] : undefined;
    const pruneName = pruned ? await ctx.runAction(internal.evidenceLibraries.sourceActions.requireEditable, { userId: actor.userId, ...pruned }) : undefined;
    const libraryDestination = saveTo.kind === "libraryCollection" || saveTo.kind === "newLibraryCollection" ? await ctx.runAction(internal.evidenceLibraries.sourceActions.destination, { userId: actor.userId, saveTo }) : undefined;
    return await ctx.runMutation(internal.screening.screenings.open, { userId: actor.userId, workspaceId: actor.workspaceId, author: "user", ...args, ...(libraryDestination ? { libraryDestination } : {}), ...(pruneName ? { pruneName } : {}) });
  },
});

const byId = { jobId: v.id("screeningJobs") };

/**
 * Holds a screening's models where they are: the papers they are reading are finished and paid for, and no more are
 * started until someone lets them go on. People go on voting.
 */
export const pause = workspaceMutation({
  args: byId,
  returns: v.null(),
  handler: async (ctx, actor, { jobId }) => {
    const job = await requireMember(ctx, actor, jobId);
    if (job.paused || job.finishedAt !== undefined) return null;
    await ctx.db.patch("screeningJobs", jobId, { paused: true, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.screening.readings.hold, { jobId, cursor: null });
    await logChange(ctx, actor, job, "paused");
    return null;
  },
});

/**
 * Lets a screening's models go on reading: after a pause, or once the workspace has credits again.
 */
export const resume = workspaceMutation({
  args: byId,
  returns: v.null(),
  handler: async (ctx, actor, { jobId }) => {
    const job = await requireMember(ctx, actor, jobId);
    if ((!job.paused && !job.outOfCredits) || job.finishedAt !== undefined) return null;
    await ctx.db.patch("screeningJobs", jobId, { paused: undefined, outOfCredits: undefined, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.screening.readings.release, { jobId, cursor: null });
    await logChange(ctx, actor, job, "resumed");
    return null;
  },
});

/**
 * Finishes a screening: nobody votes on it any more, its models stop, and a living one stops looking in its sources.
 * Its papers and votes are kept, and it can be opened again.
 */
export const finish = workspaceMutation({
  args: byId,
  returns: v.null(),
  handler: async (ctx, actor, { jobId }) => {
    const job = await requireMember(ctx, actor, jobId);
    if (job.finishedAt !== undefined) return null;
    const now = Date.now();
    await ctx.db.patch("screeningJobs", jobId, { finishedAt: now, status: "completed", completedAt: now, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.screening.readings.hold, { jobId, cursor: null });
    // What it leaves open is said with it: the papers nobody settled, and a living screening's checks.
    const progress = await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", jobId)).unique();
    const settled = (progress?.counts?.include ?? 0) + (progress?.counts?.maybe ?? 0) + (progress?.counts?.exclude ?? 0);
    await logChange(ctx, actor, job, "finished", { more: [...(job.totalPapers > settled ? [{ code: "unsettled", count: job.totalPapers - settled }] : []), ...(job.living ? [{ code: "checksStopped" }] : [])] });
    return null;
  },
});

/**
 * Opens a finished screening again: its reviewers vote on what is left, and its models go on reading.
 */
export const reopen = workspaceMutation({
  args: byId,
  returns: v.null(),
  handler: async (ctx, actor, { jobId }) => {
    const job = await requireMember(ctx, actor, jobId);
    if (job.finishedAt === undefined) return null;
    const now = Date.now();
    await ctx.db.patch("screeningJobs", jobId, { finishedAt: undefined, status: "processing", completedAt: undefined, updatedAt: now, ...(job.living ? { living: { ...job.living, next: now + EVERY_MS[job.living.every] } } : {}) });
    await ctx.scheduler.runAfter(0, internal.screening.readings.release, { jobId, cursor: null });
    await logChange(ctx, actor, job, "reopened");
    return null;
  },
});

/**
 * Gives a screening another name.
 */
export const rename = workspaceMutation({
  args: { ...byId, name: v.string() },
  returns: v.null(),
  handler: async (ctx, actor, { jobId, name }) => {
    const job = await requireMember(ctx, actor, jobId);
    const title = name.trim();
    if (!title || title.length > SCREENING_TEXT.name) throw createError("VALIDATION_ERROR", "Give the screening a name of up to 200 characters.");
    if (title === job.name) return null;
    await ctx.db.patch("screeningJobs", jobId, { name: title, updatedAt: Date.now() });
    await logChange(ctx, actor, job, "renamed", { detail: title });
    return null;
  },
});

/** Rows one step of a screening's deletion takes. */
const DELETE_STEP = 100;

/**
 * Deletes a screening with its papers, votes and discussion, for whoever started it or an admin of its workspace.
 * Papers it saved to the library or a collection stay there. This can't be undone.
 */
export const remove = workspaceMutation({
  args: byId,
  returns: v.null(),
  handler: async (ctx, actor, { jobId }) => {
    const job = await requireMember(ctx, actor, jobId);
    requireMakerOrAdmin(actor, job.createdBy);
    // Finished first, so its models stop while its rows go.
    await ctx.db.patch("screeningJobs", jobId, { finishedAt: job.finishedAt ?? Date.now(), status: "completed", living: undefined, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.screening.screenings.erase, { jobId });
    return null;
  },
});

/** Deletes a screening's rows a step at a time, the screening itself last, so nothing is left that names it. */
export const erase = internalMutation({
  args: byId,
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const votes = await ctx.db.query("screeningVotes").withIndex("by_job_and_place", (q) => q.eq("jobId", jobId)).take(DELETE_STEP);
    for (const vote of votes) await ctx.db.delete("screeningVotes", vote._id);
    const messages = votes.length ? [] : await ctx.db.query("screeningMessages").withIndex("by_job_and_to_and_open", (q) => q.eq("jobId", jobId)).take(DELETE_STEP);
    for (const message of messages) await ctx.db.delete("screeningMessages", message._id);
    const left = votes.length || messages.length ? [] : await ctx.db.query("screeningLeftOut").withIndex("by_job_and_why", (q) => q.eq("jobId", jobId)).take(DELETE_STEP);
    for (const one of left) await ctx.db.delete("screeningLeftOut", one._id);
    const papers = votes.length || messages.length || left.length ? [] : await ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(DELETE_STEP);
    for (const paper of papers) await ctx.db.delete("screeningResults", paper._id);
    if (votes.length || messages.length || left.length || papers.length) return void (await ctx.scheduler.runAfter(0, internal.screening.screenings.erase, { jobId }));
    // The small tables go the same way: a step of each, and the screening itself once none is left.
    const pairs = await ctx.db.query("screeningAgreement").withIndex("by_job_and_a_and_b", (q) => q.eq("jobId", jobId)).take(DELETE_STEP);
    for (const row of pairs) await ctx.db.delete("screeningAgreement", row._id);
    const notices = await ctx.db.query("screeningNotices").withIndex("by_job_and_user", (q) => q.eq("jobId", jobId)).take(DELETE_STEP);
    for (const row of notices) await ctx.db.delete("screeningNotices", row._id);
    const checks = await ctx.db.query("screeningChecks").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(DELETE_STEP);
    for (const row of checks) await ctx.db.delete("screeningChecks", row._id);
    if (pairs.length || notices.length || checks.length) return void (await ctx.scheduler.runAfter(0, internal.screening.screenings.erase, { jobId }));
    for (const row of await reviewersOf(ctx, jobId)) await ctx.db.delete("screeningReviewers", row._id);
    for (const row of await sourcesOf(ctx, jobId)) await ctx.db.delete("screeningSources", row._id);
    const progress = await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", jobId)).unique();
    if (progress) await ctx.db.delete("screeningJobProgress", progress._id);
    await ctx.scheduler.runAfter(0, internal.paperSets.libraryKeys.drop, { job: jobId });
    await ctx.db.delete("screeningJobs", jobId);
    return null;
  },
});
