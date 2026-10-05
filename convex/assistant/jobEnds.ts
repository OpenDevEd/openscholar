/**
 * Tells a chat when a job one of its replies started has ended (#328). A job records the step
 * that started it (`chatStep`); the transaction that ends the job writes the end once, as a row
 * of its own, and the chat is told it once it isn't writing a reply or waiting for an answer
 * (./jobs.ts `deliver`), as a background task's end reaches a coding agent between its turns.
 * This module holds no Convex functions, so the triggers can load it.
 */
import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { ENDED } from "../billing/spend";

/** Whether a job's status is one it ends in (../billing/spend.ts): a job carried on since has another. */
export const hasEnded = (status: string | undefined) => ENDED.has(status ?? "");

/** The chat message that tells a chat its jobs ended: the app's own, which the chat shows as an event (./replies.ts). */
export const JOB_ENDED = "job-ended";

// Named by its path: the module that defines it is built with these triggers.
const deliver = makeFunctionReference<"mutation", { threadId: Id<"assistantThreads"> }>("assistant/jobs:deliver");

type Job = { _id: string; status?: string; chatStep?: Id<"assistantSteps"> };

/** A trigger that writes the end of a job a reply started, once, and wakes its chat. A job deleted before it ended isn't told. */
export const noteEndedJob =
  (kind: Doc<"assistantJobEnds">["kind"]) =>
  async (ctx: MutationCtx, { oldDoc, newDoc }: { oldDoc: Job | null; newDoc: Job | null }) => {
    if (!newDoc?.chatStep || !oldDoc || ENDED.has(oldDoc.status ?? "") || !ENDED.has(newDoc.status ?? "")) return;
    // One end of it still waits to be told: it's told as it ends now. One already told was that end; this is a new one.
    const waiting = (await ctx.db.query("assistantJobEnds").withIndex("by_job", (q) => q.eq("jobId", newDoc._id)).take(20)).find((end) => end.pending);
    if (waiting) {
      await ctx.db.patch("assistantJobEnds", waiting._id, { status: newDoc.status!, endedAt: Date.now() });
      return;
    }
    const step = await ctx.db.get("assistantSteps", newDoc.chatStep);
    if (!step) return;
    await ctx.db.insert("assistantJobEnds", { threadId: step.threadId, stepId: step._id, userId: step.userId, kind, jobId: newDoc._id, status: newDoc.status!, endedAt: Date.now(), pending: true });
    await ctx.scheduler.runAfter(0, deliver, { threadId: step.threadId });
  };

/** A trigger that tells a chat the ends that waited for it, when it stops writing a reply or waiting for an answer. */
export async function tellIdleChat(ctx: MutationCtx, { oldDoc, newDoc }: { oldDoc: Doc<"assistantThreads"> | null; newDoc: Doc<"assistantThreads"> | null }) {
  const busy = (thread: Doc<"assistantThreads"> | null) => Boolean(thread?.reply || thread?.asking);
  if (!newDoc || !busy(oldDoc) || busy(newDoc)) return;
  if (await ctx.db.query("assistantJobEnds").withIndex("by_thread_and_pending", (q) => q.eq("threadId", newDoc._id).eq("pending", true)).first()) {
    await ctx.scheduler.runAfter(0, deliver, { threadId: newDoc._id });
  }
}
