/**
 * An extraction over a paper set (#341) the server reads, as the assistant starts one from a
 * chat. The person approves it up to a figure (#328): that figure is held once, the job's
 * papers are charged under the hold, and the job reads no more once it's reached
 * (./paperWorker.ts). The page's own start sends its bucket (./mutations/jobs.ts).
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type ActionCtx, type QueryCtx } from "../lib/functions";
import { assistantAction, defineUserAction, userAction, type ChangeCall } from "../lib/userActions";
import { createError } from "../lib/errors";
import { extractionPricing, extractionStamp } from "../ai/serverModel";
import { getFlag, requireFeature } from "../featureFlags/guard";
import { checkRateLimit } from "../lib/rateLimit";
import { startHeld } from "../billing/charge";
import { personalWorkspaceOf, type InWorkspace } from "../workspaces/actor";
import { papersIn } from "../screening/estimate";
import { paperSetValidator } from "../screening/validators";
import { extractionPaperCredits } from "../../lib/pricing";
import { startJobFor } from "./mutations/jobs";
import { checkRange, paperPickValidator, screeningPicked, searchFilters, sourcesFor, type PaperSet } from "./picks";
import { MAX_QUESTIONS_PER_JOB, MAX_QUESTION_TEXT_LENGTH, questionInputValidator, questionTypeValidator } from "./validators";
import { checkRequestPapers } from "../billing/accounts";
import { noteActivity } from "../activity/notes";


const askedValidator = v.object({ question: v.string(), type: questionTypeValidator, description: v.optional(v.string()) });
const extractArgs = { name: v.string(), set: paperSetValidator, first: v.number(), last: v.number(), questions: v.array(askedValidator), usePdfs: v.optional(v.boolean()) };

/** How often an ended job is looked at again while a paper of it is still being read, and for how long at most: longer than a paper's worker can run. */
const RUNNING_CHECK_MS = 15_000;
const RUNNING_WAIT_MS = 12 * 60_000;
/** How long after its last paper stopped being read a job's hold is settled: the paper's cost is recorded a moment after its row says it's done. */
const SETTLE_AFTER_MS = 30_000;

const invalid = (message: string) => createError("VALIDATION_ERROR", message);

/** Full texts are read only where they're turned on: a job asked for them otherwise would be approved at their price and read abstracts. */
async function checkPdfs(ctx: QueryCtx, usePdfs: boolean | undefined) {
  if (usePdfs && (await getFlag(ctx, "extraction.pdf"))?.enabled === false) throw invalid("Full texts are turned off here. Start it without `usePdfs`, from abstracts.");
}

/** The questions a job takes: at least one, at most MAX_QUESTIONS_PER_JOB, none too long to keep. */
function checkQuestions(questions: Array<{ question: string }>) {
  if (!questions.length) throw invalid("Give at least one question to answer for each paper.");
  if (questions.length > MAX_QUESTIONS_PER_JOB) throw invalid(`An extraction takes up to ${MAX_QUESTIONS_PER_JOB} questions.`);
  if (questions.some((asked) => asked.question.length > MAX_QUESTION_TEXT_LENGTH)) throw invalid(`A question can be at most ${MAX_QUESTION_TEXT_LENGTH.toLocaleString("en")} characters.`);
}

/**
 * What starting an extraction refuses that can be read before the person is asked to pay for
 * it (see `start`), so that a yes is never followed by a refusal: its switches, its questions,
 * and its papers. Only what OpenAlex says of a search, and a balance that changed since, are left.
 */
async function checkExtraction(ctx: QueryCtx, { userId, workspaceId }: InWorkspace, { set, first, last, questions, usePdfs }: { set: PaperSet; first: number; last: number; questions: Array<{ question: string }>; usePdfs?: boolean }) {
  await requireFeature(ctx, "extraction.enabled", userId);
  await requireFeature(ctx, "extraction.start", userId);
  // Read, not spent: the start spends it (./mutations/jobs.ts).
  const limited = await checkRateLimit(ctx, { name: "start-extraction", key: userId });
  if (!limited.ok) throw createError("CONFLICT", `This account has started as many extractions as an hour allows. This one can start in ${Math.max(1, Math.ceil(((limited.retryAt ?? Date.now()) - Date.now()) / 60_000))} minutes.`);
  await checkPdfs(ctx, usePdfs);
  checkQuestions(questions);
  if (set.kind === "screening") {
    await screeningPicked(ctx, workspaceId, set.jobId);
    return void (await checkRequestPapers(ctx, workspaceId, (await papersIn(ctx, { userId, workspaceId }, set)) ?? 0, "extraction"));
  }
  checkRange(first, last);
  if (set.kind === "search") {
    await searchFilters(ctx, workspaceId, set.searchId);
    return void (await checkRequestPapers(ctx, workspaceId, last - first + 1, "extraction"));
  }
  if (set.kind === "collection" && (await ctx.db.get("collections", set.collectionId))?.workspaceId !== workspaceId) throw createError("NOT_FOUND", "Collection not found");
  const held = await papersIn(ctx, { userId, workspaceId }, set);
  if (held !== null && first > held) throw invalid("There are no papers in that range");
  await checkRequestPapers(ctx, workspaceId, Math.min(last, held ?? last) - first + 1, "extraction");
}

/** How many papers a request is for. A screening is all its included papers. */
async function papersOf(ctx: QueryCtx, reader: InWorkspace, { set, first, last }: { set: PaperSet; first: number; last: number }) {
  const held = await papersIn(ctx, reader, set);
  if (set.kind === "screening") return held ?? 0;
  return Math.max(0, Math.min(last, held ?? last) - first + 1);
}

/** The most an extraction of these papers holds: every paper at its most, on the models the job sends its questions to (../ai/serverModel.ts `extractionStamp`). */
async function extractionHold(ctx: QueryCtx, { userId, workspaceId }: InWorkspace, { questions, usePdfs, ...range }: { set: PaperSet; first: number; last: number; questions: Array<{ type: string; question: string }>; usePdfs?: boolean }) {
  await checkExtraction(ctx, { userId, workspaceId }, { ...range, questions, usePdfs });
  const pricing = await extractionPricing(ctx, await extractionStamp(ctx, { userId, workspaceId }));
  return (await papersOf(ctx, { userId, workspaceId }, range)) * extractionPaperCredits(pricing, questions, usePdfs === true);
}

/** The same figure, for the start to check what was approved against (see `start`). */
export const figure = internalQuery({
  // Optional only for a call from an action already running when this deployed (#650), which reads in its person's own; required again in slice 8.
  args: { userId: v.id("users"), workspaceId: v.optional(v.id("workspaces")), ...extractArgs },
  returns: v.number(),
  handler: async (ctx, { userId, workspaceId, ...args }) => extractionHold(ctx, { userId, workspaceId: workspaceId ?? (await personalWorkspaceOf(ctx, userId)) }, args),
});

/** Starts the job from the set the action was asked for, as the page's start does, with the hold it's charged under when it has one. */
export const begin = internalMutation({
  // `workspaceId` is optional only for a call from an action already running when this deployed (#650), which starts the job in its person's own; required again in slice 8.
  // `author` is optional only for a call from an action already running when this deployed.
  args: { userId: v.id("users"), workspaceId: v.optional(v.id("workspaces")), author: v.optional(v.union(v.literal("user"), v.literal("assistant"))), name: v.string(), sources: v.array(paperPickValidator), questions: v.array(questionInputValidator), usePdfs: v.boolean(), spend: v.optional(v.object({ hold: v.string(), cap: v.number() })), chatStep: v.optional(v.id("assistantSteps")) },
  returns: v.object({ jobId: v.id("extractionJobs") }),
  handler: async (ctx, { userId, workspaceId: given, author, spend, chatStep, sources, ...args }) => {
    await checkPdfs(ctx, args.usePdfs);
    const workspaceId = given ?? (await personalWorkspaceOf(ctx, userId));
    const bucketItems = await sourcesFor(ctx, { userId, workspaceId }, sources);
    const started = await startJobFor(ctx, { userId, workspaceId }, { ...args, bucketItems }, spend, chatStep);
    await noteActivity(ctx, { workspaceId, by: userId, viaAssistant: author === "assistant" }, { kind: "extraction", id: started.jobId, happened: "created", detail: args.name });
    return started;
  },
});

/**
 * Settles the hold of a job that has ended (../lib/triggers.ts), once none of its papers is
 * still being read: one read when the job stopped or was cancelled is recorded under the
 * hold when it ends, and every charge of the job goes through the hold's one confirm. A job
 * the person has carried on meanwhile left the hold behind, and it is settled as it stands.
 */
export const settleHold = internalMutation({
  args: { jobId: v.id("extractionJobs"), hold: v.string(), waited: v.number() },
  returns: v.null(),
  handler: async (ctx, { jobId, hold, waited }) => {
    const job = await ctx.db.get("extractionJobs", jobId);
    const reading = job?.spendHold === hold && (await ctx.db.query("extractionPaperQueue").withIndex("by_job_and_status", (q) => q.eq("jobId", jobId).eq("status", "running")).first()) !== null;
    if (reading && waited < RUNNING_WAIT_MS) await ctx.scheduler.runAfter(RUNNING_CHECK_MS, internal.extraction.start.settleHold, { jobId, hold, waited: waited + RUNNING_CHECK_MS });
    else await ctx.scheduler.runAfter(0, internal.billing.charge.laterSpent, { chargeId: hold, attempt: 0, delay: SETTLE_AFTER_MS });
    return null;
  },
});

/** Starts the job from the set. With the figure the person approved, it is held first (billing/charge.ts `startHeld`). */
async function start(ctx: ActionCtx, { userId, workspaceId }: InWorkspace, author: "user" | "assistant", { name, questions, usePdfs, ...range }: { name: string; set: PaperSet; first: number; last: number; questions: Array<Infer<typeof askedValidator>>; usePdfs?: boolean }, call?: ChangeCall): Promise<{ jobId: Id<"extractionJobs"> }> {
  const cap = call?.credits;
  checkQuestions(questions);
  // A job the assistant started keeps the step it started from, so its chat hears when it ends.
  const job = { userId, workspaceId, author, name, sources: [range], questions: questions.map((asked, at) => ({ ...asked, key: `q_${at}` })), usePdfs: usePdfs === true, ...(call?.from ? { chatStep: call.from } : {}) };
  if (cap === undefined) return await ctx.runMutation(internal.extraction.start.begin, job);
  // What was approved is what the job holds now, or more: the papers or the model may have changed since the person was asked, and a job that holds more than they said yes to is asked about again.
  const now: number = await ctx.runQuery(internal.extraction.start.figure, { userId, workspaceId, name, questions, ...(usePdfs === undefined ? {} : { usePdfs }), ...range });
  if (now > cap) throw invalid(`This extraction now holds up to ${Math.ceil(now).toLocaleString("en")} credits, more than the ${cap.toLocaleString("en")} approved: its papers or the model it runs on changed since. Call it again, and the person is asked with the new figure.`);
  return await startHeld(ctx, { userId, workspaceId, credits: cap, kind: "extraction" }, (hold) => ctx.runMutation(internal.extraction.start.begin, { ...job, spend: { hold, cap } }));
}

export const extractAction = defineUserAction({
  path: "extraction/start:extract",
  description:
    "Starts an extraction: answers each question for each paper of a paper set, with the passage each answer rests on. The set is one of the person's collections or all their saved papers, newest saved first, papers `first` to `last` (from 1); " +
    "one of their saved searches, its results `first` to `last` in its results page's order; or a finished screening, all its included papers, whatever `first` and `last` say. " +
    "It reads abstracts, or with `usePdfs` the full text of papers that have one, which costs a few times as much. A question's `type` is string, number, boolean or array, and `description` says what counts as an answer. " +
    `As many papers as the person's plan takes in one request, and up to ${MAX_QUESTIONS_PER_JOB} questions. Spends credits. Returns the job, which runs after the reply: read its results later with extraction/queries:listJobResults.`,
  args: extractArgs,
  returns: v.object({ jobId: v.id("extractionJobs") }),
  spendsCredits: true,
  outsideEffect: false,
  undoable: false,
  estimate: (ctx, actor, args) => extractionHold(ctx, actor, args),
  // The papers and the questions put to them.
  shown: ({ name, set, first, last, questions, usePdfs }) => ({
    name,
    ...(set.kind === "collection" ? { collectionId: set.collectionId, first, last } : set.kind === "search" ? { search: set.searchId, first, last } : set.kind === "screening" ? { screening: set.jobId } : { papers: "library", first, last }),
    question: questions.map((asked) => asked.question),
    ...(usePdfs ? { usePdfs } : {}),
  }),
  // Typed here: the generated API's types depend on this module, so inference would loop.
  run: (ctx, { userId, workspaceId, author }, args, call): Promise<{ jobId: Id<"extractionJobs"> }> => start(ctx, { userId, workspaceId }, author, args, call),
});
export const extract = userAction(extractAction);
export const extractForAssistant = assistantAction(extractAction);
