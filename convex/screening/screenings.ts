/**
 * Making a screening with reviewers and running it (plans/screening-reviewers): starting one, pausing its models and
 * letting them go on, finishing it and opening it again. Its settings are changed in ./settings.ts, its people and
 * models in ./reviewers.ts, and its sources are read in ./gathering.ts.
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { planLimit } from "../billing/accounts";
import { effortValidator } from "../aiModelConfig/validators";
import { requireActiveUser } from "../lib/auth";
import { createError } from "../lib/errors";
import { internalMutation } from "../lib/functions";
import type { Doc } from "../_generated/dataModel";
import { MAX_QUESTIONS, MAX_STARS } from "../lib/listCaps";
import { workspaceAction, workspaceMutation } from "../lib/userActions";
import { actorIn, requireMakerOrAdmin } from "../workspaces/actor";
import { usableFor } from "../../lib/ai/tasks";
import { defaultPoints, defaultStars, EVERY_MS, MAX_SOURCES, shortOf, type Criterion } from "../../lib/screening/rules";
import { requireMember } from "./access";
import { MAX_REVIEWERS, MAX_SOURCE_ROWS, countDealt, keepVersion, placeGuests, dealNew, readingModel, readsOf, reviewersOf, sourcesOf, touched, votesOf, papersOf } from "./dealing";
import { readInTurn } from "./living";
import { startWaitingVotes } from "./slots";
import { readOn, startCheck } from "./gathering";
import { logChange } from "./log";
import { destination } from "./mutations";
import { NO_RESULTS } from "./settling";
import { everyValidator, libraryDestinationValidator, MAX_TERMS, modelVotesValidator, prunable, saveToValidator, SCREENING_TEXT, SOURCE_FACTS, sourceSetValidator } from "./validators";

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
export const ruleInput = v.object({ each: v.union(v.number(), v.literal("all")), settle: v.union(v.literal("all"), v.literal("most"), v.literal("one")), resolver: v.optional(v.id("users")), blind: v.union(v.literal("after"), v.literal("always")), models: v.optional(modelVotesValidator) });
/** How many people read each paper, when a paper is settled, who sees the votes and how a model's counts, as a screening keeps them. Under "first vote decides" a paper goes to one person: a second would read it for nothing. */
export function ruleFrom(sent: Infer<typeof ruleInput>) {
  const each = sent.settle === "one" ? 1 : sent.each === "all" ? ("all" as const) : Math.floor(sent.each);
  if (each !== "all" && !(each >= 0 && each <= MAX_REVIEWERS)) throw createError("VALIDATION_ERROR", "Pick how many people read each paper.");
  return { each, settle: sent.settle, blind: sent.blind, models: sent.models ?? ("vote" as const) };
}
export const sourceInput = v.object({ set: sourceSetValidator, name: v.string(), detail: v.optional(v.string()), facts: v.optional(v.array(v.string())), first: v.optional(v.number()), last: v.optional(v.number()) });
export const modelInput = v.object({ model: v.string(), effort: v.optional(effortValidator) });

/** The most sources one screening has, and the most models where its workspace's plan sets no number. */
export { MAX_SOURCES };
const MODELS_A_SCREENING = 5;
/** How many models one screening in the workspace may have reading: its plan's number (lib/billing/plans.ts `screening_models`). */
export const modelsLimit = async (ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces">) => (await planLimit(ctx, workspaceId, "screening_models")) ?? MODELS_A_SCREENING;

/** A model votes by answering the criteria: with none it would include every paper it reads. People vote without them. */
/** A model votes Exclude only on a must-have it finds unmet: with no must-have it would include every paper. */
export const NEEDS_CRITERIA = "A model excludes a paper only for a must-have it fails. Make at least one criterion a must-have, or take the models off.";

/** Criteria as a screening keeps them, from what a form sent: checked, trimmed, each with a key that never changes. People alone can screen with none. */
export function criteriaFrom(sent: Infer<typeof criterionInput>[], kept: Criterion[] = [], now = Date.now()): Criterion[] {
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
    return { key, text, short: (one.short?.trim() || shortOf(text)).slice(0, SCREENING_TEXT.short), must: one.must, ...(one.note?.trim() ? { note: one.note.trim() } : {}), terms, addedAt: before?.addedAt ?? now, ...(before && before.text !== text ? { changedAt: now } : before?.changedAt ? { changedAt: before.changedAt } : {}), points: one.points ?? before?.points ?? defaultPoints() };
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
  /** Its models wait to read until the people the form invites are on it (`resume` with `quiet`), so a paper meant for them isn't settled first. */
  hold: v.optional(v.boolean()),
  /** People from outside the workspace the form invites as reviewers once it is made: they count as its reviewers. */
  guests: v.optional(v.number()),
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
export { EVERY_MS };

/** Whether a source's row is the source the form holds: the same thing read, and the same papers of it. */
const stable = (value: unknown): string => (Array.isArray(value) ? `[${value.map(stable).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${key}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}` : JSON.stringify(value) ?? "");
const sameSource = (row: Doc<"screeningSources">, sent: Infer<typeof sourceInput>) => row.removedAt === undefined && stable(row.set) === stable(sent.set) && row.first === sent.first && row.last === sent.last;

/** A screening that isn't started yet, if it is this person's to go on with. */
async function draftOf(ctx: Pick<QueryCtx, "db">, actor: { userId: Id<"users">; workspaceId: Id<"workspaces"> }, jobId: Id<"screeningJobs"> | undefined) {
  const job = jobId ? await ctx.db.get("screeningJobs", jobId) : null;
  return job?.status === "draft" && job.createdBy === actor.userId && job.workspaceId === actor.workspaceId ? job : null;
}

/**
 * Reads the sources a form that starts a screening holds, before it starts: the screening is made as one not
 * started yet, with no reviewers, and its sources are read by the same look that reads a running screening's
 * (./gathering.ts). So the form says what each source holds, what another source already brought and what is left
 * out, as counted by the code that will take the papers, and starting it has nothing left to read.
 *
 * `draft` is the one this form made before. Sources added at the end are read on. Any other change, a source taken
 * out or other papers of one, makes a new one from the start, and the old one goes: which source keeps a paper two
 * of them hold depends on their order.
 */
export const sync = workspaceMutation({
  args: { draft: v.optional(v.id("screeningJobs")), sources: v.array(sourceInput) },
  returns: v.union(v.null(), v.object({ jobId: v.id("screeningJobs"), sources: v.array(v.id("screeningSources")) })),
  handler: async (ctx, actor, { draft, sources }) => {
    if (sources.length > MAX_SOURCES) throw createError("VALIDATION_ERROR", `A screening reads up to ${MAX_SOURCES} sources.`);
    const now = Date.now();
    const was = await draftOf(ctx, actor, draft);
    const rows = was ? await sourcesOf(ctx, was._id) : [];
    if (was && sources.length >= rows.length && rows.length > 0 && rows.every((row, at) => sameSource(row, sources[at]!))) {
      const added = [];
      for (const source of sources.slice(rows.length)) added.push(await addSource(ctx, was._id, actor.userId, source, now));
      if (added.length) {
        await ctx.db.patch("screeningJobs", was._id, touched(now));
        await readOn(ctx, was, actor.userId);
      }
      return { jobId: was._id, sources: [...rows.map((row) => row._id), ...added] };
    }
    if (was) await ctx.scheduler.runAfter(0, internal.screening.screenings.erase, { jobId: was._id });
    if (!sources.length) return null;
    const stars = starsFrom(undefined, 0);
    const jobId = await ctx.db.insert("screeningJobs", {
      workspaceId: actor.workspaceId,
      createdBy: actor.userId,
      status: "draft",
      totalPapers: 0,
      reading: true,
      shape: 2,
      criteria: [],
      stars,
      rule: { each: "all", settle: "all", resolver: actor.userId, blind: "after" },
      ...legacyOf([], stars),
      screeningId: await ctx.db.insert("screenings", { workspaceId: actor.workspaceId, version: 0, createdAt: now }),
      createdAt: now,
      ...touched(now),
    });
    await ctx.db.insert("screeningJobProgress", { jobId, completed: 0, skipped: 0, failed: 0, qualified: 0, counts: NO_RESULTS });
    const made = [];
    for (const source of sources) made.push(await addSource(ctx, jobId, actor.userId, source, now));
    await readOn(ctx, (await ctx.db.get("screeningJobs", jobId))!, actor.userId);
    return { jobId, sources: made };
  },
});

/** Papers one step gives to the reviewers of a screening that was read before it started. */
const DEAL_STEP = 100;

/**
 * Gives the papers a screening read before it started to its reviewers, a step at a time, in their order: each by
 * the sum that deals a paper as it arrives (./dealing.ts `dealNew`), so who gets which is what it would have been
 * had the screening started first. A paper that arrived since has its places already.
 */
export const deal = internalMutation({
  args: { jobId: v.id("screeningJobs"), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { jobId, cursor }) => {
    const job = await ctx.db.get("screeningJobs", jobId);
    if (!job) return null;
    const reviewers = await reviewersOf(ctx, jobId);
    const reads = await readsOf(ctx, reviewers);
    const dealt = new Map<Id<"screeningReviewers">, number>();
    const page = await ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).paginate({ cursor, numItems: DEAL_STEP });
    for (const paper of page.page) if (!paper.withdrawn && !(await votesOf(ctx, paper._id)).length) await dealNew(ctx, job, paper, reviewers, reads, dealt);
    await countDealt(ctx, dealt);
    if (dealt.size && reviewers.some(readingModel)) await startWaitingVotes(ctx, job.workspaceId);
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.screening.screenings.deal, { jobId, cursor: page.continueCursor });
    return null;
  },
});

/** How long a screening that was never started is kept before it goes. */
const DRAFT_KEPT_MS = 7 * 24 * 60 * 60 * 1000;
const DRAFTS_A_SWEEP = 50;

/** Takes away the screenings that were given sources and never started, once nobody has touched them for a week. */
export const sweepDrafts = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const old = await ctx.db.query("screeningJobs").withIndex("by_status_and_updatedAt", (q) => q.eq("status", "draft").lt("updatedAt", Date.now() - DRAFT_KEPT_MS)).take(DRAFTS_A_SWEEP);
    for (const job of old) await ctx.scheduler.runAfter(0, internal.screening.screenings.erase, { jobId: job._id });
    return null;
  },
});

/**
 * Makes a screening, with its sources, its reviewers and its first look in the sources. Whoever makes it starts it
 * and settles its conflicts unless someone else is named. Where the form read these sources before starting
 * (`sync`), that one is started: its papers are there already, and are given to the reviewers.
 */
export const open = internalMutation({
  args: { userId: v.id("users"), workspaceId: v.id("workspaces"), author: v.union(v.literal("user"), v.literal("assistant")), ...setup, draft: v.optional(v.id("screeningJobs")), libraryDestination: v.optional(libraryDestinationValidator), pruneName: v.optional(v.string()) },
  returns: v.object({ jobId: v.id("screeningJobs") }),
  handler: async (ctx, { userId, workspaceId, author, hold, guests, name, question, criteria: sent, stars: sentStars, rule, sources, people, models, saveTo, prune, living, draft, libraryDestination, pruneName }) => {
    const user = await requireActiveUser(ctx, userId);
    const writer = { userId, workspaceId };
    const title = name.trim();
    if (!title || title.length > SCREENING_TEXT.name) throw createError("VALIDATION_ERROR", "Give the screening a name of up to 200 characters.");
    if ((question?.length ?? 0) > SCREENING_TEXT.question) throw createError("VALIDATION_ERROR", "That research question is too long.");
    // It may start with no source: its reviewers and criteria are set, and it waits for papers until one is added.
    if (sources.length > MAX_SOURCES) throw createError("VALIDATION_ERROR", `A screening reads up to ${MAX_SOURCES} sources.`);
    if (!people.length && !models.length && !guests) throw createError("VALIDATION_ERROR", "Add at least one reviewer, a person or a model.");
    if (new Set(people).size !== people.length || new Set(models.map((one) => `${one.model}:${one.effort ?? ""}`)).size !== models.length) throw createError("VALIDATION_ERROR", "Each reviewer is on a screening once.");
    const most = await modelsLimit(ctx, workspaceId);
    if (models.length > most) throw createError("VALIDATION_ERROR", `This workspace's plan runs up to ${most} models on a screening.`);
    if (people.length + models.length > MAX_REVIEWERS) throw createError("VALIDATION_ERROR", `A screening has up to ${MAX_REVIEWERS} reviewers.`);
    const now = Date.now();
    const criteria = criteriaFrom(sent, [], now);
    if (!criteria.some((criterion) => criterion.must) && models.length) throw createError("VALIDATION_ERROR", NEEDS_CRITERIA);
    const stars = starsFrom(sentStars, criteria.length);
    const kept = ruleFrom(rule);
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
    const settings = {
      ...(hold && models.length ? { paused: true as const } : {}),
      status: "processing" as const,
      name: title,
      ...(question?.trim() ? { question: question.trim() } : {}),
      criteria,
      stars,
      rule: { ...kept, resolver },
      ...(living ? { living: { every: living, next: now + EVERY_MS[living] } } : {}),
      ...legacyOf(criteria, stars),
      ...(later ? { newCollection: later } : await destination(ctx, writer, saveTo)),
      ...(libraryDestination ? { libraryDestination } : {}),
      ...(prune ? { prune: true as const } : {}),
      ...(pruneName ? { pruneName } : {}),
      createdAt: now,
      ...touched(now),
    };
    // The one the form read before starting is started where it holds these very sources, in this order. Any other is left to go, and the sources are read from the start.
    const read = await draftOf(ctx, writer, draft);
    const rows = read ? await sourcesOf(ctx, read._id) : [];
    const adopted = read && rows.length === sources.length && rows.every((row, at) => sameSource(row, sources[at]!)) ? read : null;
    if (read && !adopted) await ctx.scheduler.runAfter(0, internal.screening.screenings.erase, { jobId: read._id });
    const jobId = adopted?._id ?? (await ctx.db.insert("screeningJobs", { workspaceId, createdBy: user._id, totalPapers: 0, reading: true, shape: 2, screeningId: await ctx.db.insert("screenings", { workspaceId, version: 0, createdAt: now }), ...settings }));
    if (adopted) await ctx.db.patch("screeningJobs", jobId, settings);
    else {
      await ctx.db.insert("screeningJobProgress", { jobId, completed: 0, skipped: 0, failed: 0, qualified: 0, counts: NO_RESULTS });
      for (const source of sources) await addSource(ctx, jobId, userId, source, now);
    }
    for (const person of people) await ctx.db.insert("screeningReviewers", { jobId, kind: "person", userId: person, addedAt: now, addedBy: userId, dealt: 0 });
    for (const { model, effort } of picked) await ctx.db.insert("screeningReviewers", { jobId, kind: "model", modelId: model._id, ...(effort ? { effort } : {}), addedAt: now, addedBy: userId, dealt: 0 });
    await keepVersion(ctx, (await ctx.db.get("screeningJobs", jobId))!, userId);
    // Papers read before it started are given out now. The ones still to arrive are dealt as they come, by the look that is reading them.
    if (adopted) await ctx.scheduler.runAfter(0, internal.screening.screenings.deal, { jobId, cursor: null });
    else await startCheck(ctx, (await ctx.db.get("screeningJobs", jobId))!, userId);
    await logChange(ctx, { userId, author }, { _id: jobId, workspaceId }, "started", { detail: title, more: [{ code: "sources", count: sources.length }, ...(people.length ? [{ code: "people", count: people.length }] : []), ...(picked.length ? [{ code: "models", count: picked.length }] : [])] });
    return { jobId };
  },
});

/** A source's row, waiting to be read. */
export async function addSource(ctx: MutationCtx, jobId: Id<"screeningJobs">, userId: Id<"users">, { set, name, detail, facts, first, last }: Infer<typeof sourceInput>, now: number) {
  if (first !== undefined && (!Number.isSafeInteger(first) || first < 1)) throw createError("VALIDATION_ERROR", "Pick papers from 1 up, with the first before the last");
  if (last !== undefined && (!Number.isSafeInteger(last) || last < (first ?? 1))) throw createError("VALIDATION_ERROR", "Pick papers from 1 up, with the first before the last");
  if ((await sourcesOf(ctx, jobId)).length >= MAX_SOURCE_ROWS) throw createError("VALIDATION_ERROR", "This screening has had as many sources as one can have. Start another screening for more.");
  return await ctx.db.insert("screeningSources", { jobId, set, // A source with no name of its own (a search with no words) is saved with none: each reader's page names it in their language.
    name: name.trim().slice(0, SCREENING_TEXT.name), ...(detail?.trim() ? { detail: detail.trim().slice(0, SCREENING_TEXT.name) } : {}), ...(facts?.length ? { facts: facts.slice(0, SOURCE_FACTS).map((fact) => fact.trim().slice(0, 120)).filter(Boolean) } : {}), ...(first === undefined ? {} : { first }), ...(last === undefined ? {} : { last }), addedAt: now, addedBy: userId, state: "waiting", read: 0, taken: 0, duplicates: 0, left: 0 });
}

/**
 * Starts a screening in the workspace: papers from one or more sources are given to its reviewers, people and AI
 * models, who each vote include, maybe or exclude, and a rule settles each paper. It is made at once and its papers
 * are read after, a step at a time. Models answer every criterion and are paid for from the workspace's credits, a
 * paper at a time; people's votes cost nothing.
 */
export const create = workspaceAction({
  args: { ...setup, draft: v.optional(v.id("screeningJobs")) },
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
    await ctx.db.patch("screeningJobs", jobId, { paused: true, ...touched() });
    await ctx.scheduler.runAfter(0, internal.screening.readings.hold, { jobId, cursor: null });
    await logChange(ctx, actor, job, "paused");
    return null;
  },
});

/**
 * Lets a screening's models go on reading: after a pause, or once the workspace has credits again.
 */
export const resume = workspaceMutation({
  args: { ...byId, /** The form letting its models go once its invitations are out: nothing to say in Activity, since nobody paused it. */ quiet: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, actor, { jobId, quiet }) => {
    const job = await requireMember(ctx, actor, jobId);
    if ((!job.paused && !job.outOfCredits) || job.finishedAt !== undefined) return null;
    await ctx.db.patch("screeningJobs", jobId, { paused: undefined, outOfCredits: undefined, ...touched() });
    await ctx.scheduler.runAfter(0, internal.screening.readings.release, { jobId, cursor: null });
    if (!quiet) await logChange(ctx, actor, job, "resumed");
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
    // A look under way stops with it: no paper joins a screening nobody votes on. Its sources stay where they were read to, and Reopen reads on from there.
    const running = await ctx.db.query("screeningChecks").withIndex("by_job_and_state", (q) => q.eq("jobId", jobId).eq("state", "running")).first();
    if (running) await ctx.db.patch("screeningChecks", running._id, { state: "done", endedAt: now });
    await ctx.db.patch("screeningJobs", jobId, { finishedAt: now, status: "completed", completedAt: now, reading: undefined, ...touched(now) });
    await ctx.scheduler.runAfter(0, internal.screening.readings.hold, { jobId, cursor: null });
    // What it leaves open is said with it: the papers nobody settled, and a living screening's checks.
    const progress = await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", jobId)).unique();
    const settled = (progress?.counts?.include ?? 0) + (progress?.counts?.maybe ?? 0) + (progress?.counts?.exclude ?? 0);
    // Counted as its pages count it: papers that left with their source are in it no more.
    const total = papersOf(job, progress);
    await logChange(ctx, actor, job, "finished", { more: [...(total > settled ? [{ code: "unsettled", count: total - settled }] : []), ...(job.living ? [{ code: "checksStopped" }] : [])] });
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
    await ctx.db.patch("screeningJobs", jobId, { finishedAt: undefined, status: "processing", completedAt: undefined, ...touched(now), ...(job.living ? { living: { ...job.living, next: now + EVERY_MS[job.living.every] } } : {}) });
    await placeGuests(ctx, jobId);
    await ctx.scheduler.runAfter(0, internal.screening.readings.release, { jobId, cursor: null });
    // Sources left part read when it was finished are read on from where they stopped.
    if ((await sourcesOf(ctx, jobId)).some((source) => source.removedAt === undefined && (source.state === "waiting" || source.state === "reading"))) await readInTurn(ctx, (await ctx.db.get("screeningJobs", jobId))!, actor.userId);
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
    await ctx.db.patch("screeningJobs", jobId, { name: title, ...touched() });
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
    // A reading that held one of its workspace's slots gives it back as its row goes.
    const held = votes.filter((vote) => vote.slot).length;
    const job = held ? await ctx.db.get("screeningJobs", jobId) : null;
    if (job) await startWaitingVotes(ctx, job.workspaceId, held);
    const messages = votes.length ? [] : await ctx.db.query("screeningMessages").withIndex("by_job_and_to_and_open", (q) => q.eq("jobId", jobId)).take(DELETE_STEP);
    for (const message of messages) await ctx.db.delete("screeningMessages", message._id);
    const left = votes.length || messages.length ? [] : await ctx.db.query("screeningLeftOut").withIndex("by_job_and_why", (q) => q.eq("jobId", jobId)).take(DELETE_STEP);
    for (const one of left) await ctx.db.delete("screeningLeftOut", one._id);
    const merged = votes.length || messages.length || left.length ? [] : await ctx.db.query("screeningMerged").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(DELETE_STEP);
    for (const one of merged) await ctx.db.delete("screeningMerged", one._id);
    const papers = votes.length || messages.length || left.length || merged.length ? [] : await ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(DELETE_STEP);
    for (const paper of papers) await ctx.db.delete("screeningResults", paper._id);
    if (votes.length || messages.length || left.length || merged.length || papers.length) return void (await ctx.scheduler.runAfter(0, internal.screening.screenings.erase, { jobId }));
    // The small tables go the same way: a step of each, and the screening itself once none is left.
    const pairs = await ctx.db.query("screeningAgreement").withIndex("by_job_and_a_and_b", (q) => q.eq("jobId", jobId)).take(DELETE_STEP);
    for (const row of pairs) await ctx.db.delete("screeningAgreement", row._id);
    const notices = await ctx.db.query("screeningNotices").withIndex("by_job_and_user", (q) => q.eq("jobId", jobId)).take(DELETE_STEP);
    for (const row of notices) await ctx.db.delete("screeningNotices", row._id);
    const checks = await ctx.db.query("screeningChecks").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(DELETE_STEP);
    for (const row of checks) await ctx.db.delete("screeningChecks", row._id);
    const versions = await ctx.db.query("screeningVersions").withIndex("by_job_and_at", (q) => q.eq("jobId", jobId)).take(DELETE_STEP);
    for (const row of versions) await ctx.db.delete("screeningVersions", row._id);
    if (pairs.length || notices.length || checks.length || versions.length) return void (await ctx.scheduler.runAfter(0, internal.screening.screenings.erase, { jobId }));
    for (const row of await reviewersOf(ctx, jobId)) await ctx.db.delete("screeningReviewers", row._id);
    for (const row of await sourcesOf(ctx, jobId)) await ctx.db.delete("screeningSources", row._id);
    const progress = await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", jobId)).unique();
    if (progress) await ctx.db.delete("screeningJobProgress", progress._id);
    await ctx.scheduler.runAfter(0, internal.paperSets.libraryKeys.drop, { job: jobId });
    await ctx.db.delete("screeningJobs", jobId);
    return null;
  },
});
