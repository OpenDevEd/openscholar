/**
 * The jobs replies start (#328): the live card each shows in its chat, and the end of each,
 * told to the chat once (./jobEnds.ts) so the assistant writes a readout as the person who
 * started it.
 */
import { saveMessages } from "@convex-dev/agent";
import { v, type Infer } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { creditsAgg } from "../extraction/aggregates";
import { requireFeature } from "../featureFlags/guard";
import { requireAuth } from "../lib/auth";
import { internalMutation, query } from "../lib/functions";
import { MAX_QUESTIONS_PER_JOB } from "../extraction/validators";
import { getScreeningJobAction } from "../screening/queries";
import { readJobCounters } from "../extraction/jobCounters";
import { formatAnswerForDisplay } from "../../lib/extraction/analysis";
import { requireThread } from "./access";
import { extractionCardValidator, JOB_CARD_ROWS, JOBS_TOLD_AT_ONCE, screeningCardValidator } from "./validators";
import { JOB_ENDED } from "./jobEnds";
import { admit, startReply } from "./replies";
import { healCalls, settleAsked } from "./steps";
import { writing } from "./threads";

const FLAG = "assistant.enabled";
/** The actions that start a job, and the kind each starts. */
const STARTS: Record<string, Doc<"assistantJobEnds">["kind"]> = { "screening/start:screen": "screening", "extraction/start:extract": "extraction" };
/** How long a chat whose person has as many replies going as they may waits before it's told again. */
const BUSY_RETRY_MS = 60_000;

const cardValidator = v.union(screeningCardValidator, extractionCardValidator);

/** The job a step started, from what it returned. */
async function jobOf(ctx: QueryCtx, step: Doc<"assistantSteps">) {
  const kind = STARTS[step.path];
  if (!kind || step.status !== "done") return null;
  const row = await ctx.db.query("assistantStepResults").withIndex("by_step", (q) => q.eq("stepId", step._id)).unique();
  try {
    const { jobId } = JSON.parse(row?.result ?? "null") as { jobId?: string };
    const id = jobId === undefined ? null : ctx.db.normalizeId(kind === "screening" ? "screeningJobs" : "extractionJobs", jobId);
    return id ? { kind, id } : null;
  } catch {
    return null;
  }
}

/** What a screening has come to, as its card and its readout say it. */
async function screeningFacts(ctx: QueryCtx, userId: Id<"users">, jobId: Id<"screeningJobs">): Promise<Infer<typeof screeningCardValidator> | null> {
  const job = await getScreeningJobAction.run(ctx, userId, { jobId });
  if (!job) return null;
  const done = job.outcomes.included + job.outcomes.unclear + job.outcomes.excluded + job.outcomes.failed;
  // Nothing of it read or being read while it runs: its papers wait for the person's others (#335).
  const queued = job.status === "processing" && !job.reading && done === 0 && job.running === 0;
  const ahead = queued ? await screeningAhead(ctx, userId, jobId) : null;
  return {
    kind: "screening",
    jobId,
    status: job.status,
    ...(job.label ? { label: job.label } : {}),
    total: job.totalPapers,
    ...job.outcomes,
    credits: job.credits.spent ?? 0,
    ...(job.spendCap === undefined ? {} : { cap: job.spendCap }),
    ...(job.capped ? { capped: true } : {}),
    ...(queued ? { waiting: ahead ?? { done: 0, total: 0 } } : {}),
    ...(job.failure ? { failure: job.failure } : {}),
  };
}

/** The person's screening that's being read while one of theirs waits, and how far it has got. */
async function screeningAhead(ctx: QueryCtx, userId: Id<"users">, waiting: Id<"screeningJobs">) {
  const running = await ctx.db.query("screeningJobs").withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "processing")).take(5);
  for (const other of running) {
    if (other._id === waiting) continue;
    const job = await getScreeningJobAction.run(ctx, userId, { jobId: other._id });
    if (!job?.running) continue;
    return { ...(job.label ? { label: job.label } : {}), done: job.outcomes.included + job.outcomes.unclear + job.outcomes.excluded + job.outcomes.failed, total: job.totalPapers };
  }
  return null;
}

/** What an extraction has come to, with its first papers' answers. */
async function extractionFacts(ctx: QueryCtx, userId: Id<"users">, jobId: Id<"extractionJobs">): Promise<Infer<typeof extractionCardValidator> | null> {
  const job = await ctx.db.get("extractionJobs", jobId);
  if (!job || job.userId !== userId) return null;
  const [counters, credits, questions, papers] = await Promise.all([
    readJobCounters(ctx, jobId),
    creditsAgg.sum(ctx, { namespace: jobId }),
    ctx.db.query("extractionQuestions").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(MAX_QUESTIONS_PER_JOB),
    ctx.db.query("extractionPapers").withIndex("by_job_processable", (q) => q.eq("jobId", jobId).eq("processable", true)).take(JOB_CARD_ROWS),
  ]);
  const asked = questions.sort((a, b) => a.order - b.order);
  const types = new Map(asked.map((question) => [question.key, question.type]));
  const rows = await Promise.all(
    papers.map(async (paper) => {
      const results = await ctx.db.query("extractionResults").withIndex("by_paper", (q) => q.eq("paperId", paper._id)).take(MAX_QUESTIONS_PER_JOB);
      const answers = Object.fromEntries(
        results
          .filter((result) => result.status === "completed")
          .map((result) => {
            const missing = result.answer === null || result.answer === "" || (Array.isArray(result.answer) && !result.answer.length);
            return [result.questionKey, { text: missing ? "" : formatAnswerForDisplay(result.answer, types.get(result.questionKey) as Parameters<typeof formatAnswerForDisplay>[1]), missing }];
          }),
      );
      return { id: paper._id, title: paper.title, answers, done: paper.status === "completed", titleOnly: !paper.abstract && !paper.storageId };
    }),
  );
  return {
    kind: "extraction",
    jobId,
    status: job.status ?? "pending",
    name: job.name,
    total: job.totalPapers ?? 0,
    // Papers, as the job's page counts them: its counts row has each answer too.
    done: counters.processed,
    failed: counters.failed,
    credits,
    ...(job.spendCap === undefined ? {} : { cap: job.spendCap }),
    ...(job.error?.message && job.status !== "completed" ? { stopped: job.error.message } : {}),
    questions: asked.map(({ key, question }) => ({ key, question })),
    rows,
  };
}

/** The live card of a job a step of this chat started, for anyone who can read the chat. Null for a step that started none. */
export const card = query({
  args: { threadId: v.id("assistantThreads"), stepId: v.id("assistantSteps") },
  returns: v.union(v.null(), v.object({ card: cardValidator, canCancel: v.boolean() })),
  handler: async (ctx, { threadId, stepId }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    await requireThread(ctx, userId, threadId);
    const step = await ctx.db.get("assistantSteps", stepId);
    if (!step || step.threadId !== threadId) return null;
    const job = await jobOf(ctx, step);
    if (!job) return null;
    // The job is its starter's: the chat shows it to everyone who reads the chat, and only they can cancel it.
    const card = job.kind === "screening" ? await screeningFacts(ctx, step.userId, job.id as Id<"screeningJobs">) : await extractionFacts(ctx, step.userId, job.id as Id<"extractionJobs">);
    return card ? { card, canCancel: step.userId === userId } : null;
  },
});

/** One ended job as the assistant is told it: what it found, what it cost, and where its page is. */
async function told(ctx: QueryCtx, end: Doc<"assistantJobEnds">) {
  const facts = end.kind === "screening" ? await screeningFacts(ctx, end.userId, end.jobId as Id<"screeningJobs">) : await extractionFacts(ctx, end.userId, end.jobId as Id<"extractionJobs">);
  if (!facts) return `<job_ended>${end.kind} ${end.jobId} ended (${end.status}); it can no longer be read.</job_ended>`;
  const spent = `credits: ${facts.credits}${facts.cap === undefined ? "" : ` of ${facts.cap} approved`}`;
  if (facts.kind === "screening") {
    return `<job_ended>screening ${facts.jobId}${facts.label ? ` (${facts.label})` : ""}; status: ${end.status}${facts.capped ? ", stopped at the credits approved" : ""}; page: /screening?job=${facts.jobId}; papers: ${facts.total}; included: ${facts.included}; unclear: ${facts.unclear}; excluded: ${facts.excluded}; failed: ${facts.failed}; ${spent}${facts.failure ? `; why it failed: ${facts.failure}` : ""}</job_ended>`;
  }
  return `<job_ended>extraction ${facts.jobId} (${facts.name}); status: ${end.status}; page: /extraction/${facts.jobId}; papers: ${facts.total}; answered: ${facts.done}; failed: ${facts.failed}; questions: ${facts.questions.map((question) => question.key + " " + question.question).join(" | ")}; ${spent}${facts.stopped ? `; why it stopped: ${facts.stopped}` : ""}</job_ended>`;
}

/**
 * Tells a chat the ends that wait for it, once it isn't writing a reply or waiting for an
 * answer: one message, the app's own, with the ends of one person's jobs, and a reply to it as
 * that person, with their access and their limits checked again. Each end is told once.
 */
export const deliver = internalMutation({
  args: { threadId: v.id("assistantThreads") },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const thread = await ctx.db.get("assistantThreads", threadId);
    // Busy: it's told when the chat stops being busy (./jobEnds.ts `tellIdleChat`).
    if (!thread || thread.asking || (await writing(ctx, thread.reply))) return null;
    const pending = await ctx.db.query("assistantJobEnds").withIndex("by_thread_and_pending", (q) => q.eq("threadId", threadId).eq("pending", true)).take(JOBS_TOLD_AT_ONCE);
    if (!pending.length) return null;
    const userId = pending[0].userId;
    const ends = pending.filter((end) => end.userId === userId);
    // Lost access to the chat, or the assistant, since: the end stays on its card, and nobody is answered for it.
    const allowed = await requireThread(ctx, userId, threadId, "write").then(() => requireFeature(ctx, FLAG, userId)).then(() => true, () => false);
    if (!allowed) {
      for (const end of ends) await ctx.db.patch("assistantJobEnds", end._id, { pending: undefined });
      // Anyone else's that waited are told next.
      await ctx.scheduler.runAfter(0, internal.assistant.jobs.deliver, { threadId });
      return null;
    }
    try {
      await admit(ctx, userId);
    } catch {
      // As many replies going for them as they may have: told once one of those ends.
      await ctx.scheduler.runAfter(BUSY_RETRY_MS, internal.assistant.jobs.deliver, { threadId });
      return null;
    }
    await settleAsked(ctx, threadId);
    await healCalls(ctx, thread.agentThreadId);
    const note = (await Promise.all(ends.map((end) => told(ctx, end)))).join("\n");
    const [message] = (await saveMessages(ctx, components.agent, { threadId: thread.agentThreadId, userId, agentName: JOB_ENDED, messages: [{ role: "user", content: note }] })).messages;
    for (const end of ends) await ctx.db.patch("assistantJobEnds", end._id, { pending: undefined, order: message.order });
    await startReply(ctx, thread, userId, { messageId: message._id, order: message.order });
    return null;
  },
});
