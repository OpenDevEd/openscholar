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
import type { Acting } from "../lib/userActions";
import { personalWorkspaceOf } from "../workspaces/actor";
import { readJobCounters } from "../extraction/jobCounters";
import { readScreeningProgressCounts } from "../screening/progress";
import { requireThread } from "./access";
import { extractionCardValidator, JOBS_DOCKED, JOBS_TOLD_AT_ONCE, runningJobsValidator, screeningCardValidator } from "./validators";
import { hasEnded, JOB_ENDED, STARTS } from "./jobEnds";
import { admit, startReply } from "./replies";
import { healCalls, settleAsked } from "./steps";
import { writing } from "./threads";

const FLAG = "assistant.enabled";
/** The actions that start a job, and the kind each starts. */
/** How long a chat whose person has as many replies going as they may waits before it's told again. */
const BUSY_RETRY_MS = 60_000;

const cardValidator = v.union(screeningCardValidator, extractionCardValidator);

/**
 * The job a step started: from what it returned, or, while the step is still finishing, from
 * the running job's row, which the job's own insert writes (./jobEnds.ts).
 */
async function jobOf(ctx: QueryCtx, step: Doc<"assistantSteps">) {
  const kind = STARTS[step.path];
  if (!kind) return null;
  const running = await ctx.db.query("assistantJobs").withIndex("by_step", (q) => q.eq("stepId", step._id)).first();
  if (running) {
    const id = ctx.db.normalizeId(kind === "screening" ? "screeningJobs" : "extractionJobs", running.jobId);
    return id ? { kind, id } : null;
  }
  if (step.status !== "done") return null;
  const row = await ctx.db.query("assistantStepResults").withIndex("by_step", (q) => q.eq("stepId", step._id)).unique();
  try {
    const { jobId } = JSON.parse(row?.result ?? "null") as { jobId?: string };
    const id = jobId === undefined ? null : ctx.db.normalizeId(kind === "screening" ? "screeningJobs" : "extractionJobs", jobId);
    return id ? { kind, id } : null;
  } catch {
    return null;
  }
}

/**
 * The person who started a job, reading it in their own workspace (#650; the job's own once jobs
 * belong to one). The card has already checked who may see it: the starter's account needn't
 * still be active for the others in a shared chat to see their job.
 */
async function starter(ctx: QueryCtx, userId: Id<"users">): Promise<Acting> {
  return { userId, workspaceId: await personalWorkspaceOf(ctx, userId), role: "admin", author: "user" };
}

/** What a screening has come to, as its card and its readout say it. */
async function screeningFacts(ctx: QueryCtx, userId: Id<"users">, jobId: Id<"screeningJobs">): Promise<Infer<typeof screeningCardValidator> | null> {
  const job = await getScreeningJobAction.run(ctx, await starter(ctx, userId), { jobId });
  if (!job) return null;
  const jobs = [job];
  const sum = (of: (one: NonNullable<typeof job>) => number) => of(job);
  const done = job.outcomes.included + job.outcomes.unclear + job.outcomes.excluded + job.outcomes.failed;
  // Its papers wait in the person's queue (#335) while their others hold the slots: the queue says so, and the screening
  // ahead of it, when one is being read, names what it waits for. Nothing read and nothing queued is a job starting.
  const queued =
    job.status === "processing" && done === 0 && job.running === 0
      ? (await ctx.db.query("screeningResults").withIndex("by_job_and_status_and_waitingUser", (q) => q.eq("jobId", job._id).eq("status", "processing").eq("waitingUser", userId)).first()) !== null
      : false;
  const ahead = queued ? ((await screeningAhead(ctx, userId, job._id)) ?? { done: 0, total: 0 }) : null;
  return {
    kind: "screening",
    jobId: job._id,
    status: job.status,
    ...(job.label ? { label: job.label } : {}),
    total: sum((one) => one.totalPapers),
    included: sum((one) => one.outcomes.included),
    unclear: sum((one) => one.outcomes.unclear),
    excluded: sum((one) => one.outcomes.excluded),
    failed: sum((one) => one.outcomes.failed),
    credits: sum((one) => one.credits.spent ?? 0),
    // What the person approved is the first job's cap: each job after holds what was left of it.
    ...(jobs[0].spendCap === undefined ? {} : { cap: jobs[0].spendCap }),
    ...(jobs.some((one) => one.capped) ? { capped: true } : {}),
    ...(ahead ? { waiting: ahead } : {}),
    ...(job.failure ? { failure: job.failure } : {}),
  };
}

/** The person's screening that's being read while one of theirs waits, and how far it has got. */
async function screeningAhead(ctx: QueryCtx, userId: Id<"users">, waiting: Id<"screeningJobs">) {
  const running = await ctx.db.query("screeningJobs").withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "processing")).take(5);
  for (const other of running) {
    if (other._id === waiting) continue;
    const job = await getScreeningJobAction.run(ctx, await starter(ctx, userId), { jobId: other._id });
    if (!job?.running) continue;
    return { ...(job.label ? { label: job.label } : {}), done: job.outcomes.included + job.outcomes.unclear + job.outcomes.excluded + job.outcomes.failed, total: job.totalPapers };
  }
  return null;
}

/** What an extraction has come to: how many papers it has read, and the questions it asks. */
async function extractionFacts(ctx: QueryCtx, userId: Id<"users">, jobId: Id<"extractionJobs">): Promise<Infer<typeof extractionCardValidator> | null> {
  const job = await ctx.db.get("extractionJobs", jobId);
  if (!job || job.userId !== userId) return null;
  const [counters, credits, questions] = await Promise.all([
    readJobCounters(ctx, jobId),
    creditsAgg.sum(ctx, { namespace: jobId }),
    ctx.db.query("extractionQuestions").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(MAX_QUESTIONS_PER_JOB),
  ]);
  return {
    kind: "extraction",
    jobId,
    status: job.status ?? "pending",
    name: job.name,
    total: job.totalPapers ?? 0,
    // Papers, as the job's page counts them.
    done: counters.processed,
    failed: counters.failed,
    credits,
    ...(job.spendCap === undefined ? {} : { cap: job.spendCap }),
    ...(job.error?.message && job.status !== "completed" ? { stopped: job.error.message } : {}),
    questions: questions.sort((a, b) => a.order - b.order).map(({ key, question }) => ({ key, question })),
  };
}

/** The live card of a job a step of this chat started, for anyone who can read the chat. Null for a step that started none. */
export const card = query({
  args: { threadId: v.id("assistantThreads"), stepId: v.id("assistantSteps") },
  returns: v.union(v.null(), v.object({ card: cardValidator, mine: v.boolean() })),
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
    return card ? { card, mine: step.userId === userId } : null;
  },
});

/** The jobs this chat's replies started that are still running, newest first: the chat docks their live cards. */
export const running = query({
  args: { threadId: v.id("assistantThreads") },
  returns: runningJobsValidator,
  handler: async (ctx, { threadId }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    await requireThread(ctx, userId, threadId);
    const rows = await ctx.db.query("assistantJobs").withIndex("by_thread", (q) => q.eq("threadId", threadId)).order("desc").take(JOBS_DOCKED);
    return rows.map(({ stepId, kind }) => ({ stepId, kind }));
  },
});

/** How far a running job has got, in papers, for a chat's row in the list. Null for a job that's gone. */
export async function progressOf(ctx: QueryCtx, row: Doc<"assistantJobs">): Promise<{ done: number; total: number } | null> {
  if (row.kind === "screening") {
    const id = ctx.db.normalizeId("screeningJobs", row.jobId);
    const job = id ? await ctx.db.get("screeningJobs", id) : null;
    if (!job) return null;
    const counts = await readScreeningProgressCounts(ctx, job);
    return { done: counts.completedCount + counts.failedCount, total: job.totalPapers };
  }
  const id = ctx.db.normalizeId("extractionJobs", row.jobId);
  const job = id ? await ctx.db.get("extractionJobs", id) : null;
  if (!job) return null;
  // Papers it answered and papers that failed are both finished.
  const counters = await readJobCounters(ctx, job._id);
  return { done: counters.processed + counters.failed, total: job.totalPapers ?? 0 };
}

/** One ended job as the assistant is told it: what it found, what it cost, and where its page is. */
async function told(ctx: QueryCtx, end: Doc<"assistantJobEnds">, quiet: boolean) {
  // Stopped for: whatever is left of the job, nothing is owed for it.
  if (quiet) return `<job_ended quiet>${end.kind} ${end.jobId} ended (${end.status}) before someone pressed Stop: no readout is owed for it unless the person asks.</job_ended>`;
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
    // A job carried on since it ended takes its end back: it's written again when it ends again.
    const live = [];
    for (const end of pending) {
      const job = await ctx.db.get(end.kind === "screening" ? "screeningJobs" : "extractionJobs", end.jobId as Id<"screeningJobs"> & Id<"extractionJobs">);
      if (job && !hasEnded(job.status)) await ctx.db.delete("assistantJobEnds", end._id);
      else live.push(end);
    }
    if (!live.length) return null;
    // Ends of jobs that ended before someone last pressed Stop are told first, together, with no readout.
    const quiet = live.filter((end) => thread.stoppedAt !== undefined && end.endedAt <= thread.stoppedAt);
    if (quiet.length) {
      // As before any message: a reply stopped as it called actions can leave calls without their results.
      await settleAsked(ctx, threadId);
      await healCalls(ctx, thread.agentThreadId);
      const note = (await Promise.all(quiet.map((end) => told(ctx, end, true)))).join("\n");
      const [message] = (await saveMessages(ctx, components.agent, { threadId: thread.agentThreadId, userId: quiet[0].userId, agentName: JOB_ENDED, messages: [{ role: "user", content: note }] })).messages;
      for (const end of quiet) await ctx.db.patch("assistantJobEnds", end._id, { pending: undefined, order: message.order });
      // Whatever else waits, quiet or not, is told next, a batch at a time.
      await ctx.scheduler.runAfter(0, internal.assistant.jobs.deliver, { threadId });
      return null;
    }
    const userId = live[0].userId;
    const ends = live.filter((end) => end.userId === userId);
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
    const note = (await Promise.all(ends.map((end) => told(ctx, end, false)))).join("\n");
    const [message] = (await saveMessages(ctx, components.agent, { threadId: thread.agentThreadId, userId, agentName: JOB_ENDED, messages: [{ role: "user", content: note }] })).messages;
    for (const end of ends) await ctx.db.patch("assistantJobEnds", end._id, { pending: undefined, order: message.order });
    try {
      await startReply(ctx, thread, userId, { messageId: message._id, order: message.order });
    } catch (error) {
      // Their chat model was retired, say: the chat shows the end, and the next reply reads its note.
      console.error(`[assistant] the readout of ${ends.map((end) => end.jobId).join(", ")} in ${threadId} couldn't start`, error);
      return null;
    }
    // Anyone else's that waited are told after this reply.
    return null;
  },
});
