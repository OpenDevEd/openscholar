/** The worker that folds answer tally changes into each question's tally rows (./tallies.ts). */
import { defineBatchWorkerValidators } from "@convex-dev/batch-worker";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../lib/functions";

/** Changes per batch. */
const BATCH = 500;

const { vQueryArgs, vQueryReturns, vMutationArgs, vMutationReturns } = defineBatchWorkerValidators({
  batch: { changes: v.array(v.id("extractionTallyChanges")) },
});

/** The next changes, in commit order. The worker deletes the changes it folds, so the index holds only waiting ones. */
export const nextChanges = internalQuery({
  args: vQueryArgs,
  returns: vQueryReturns,
  handler: async (ctx, { cursor }) => {
    const rows = await ctx.db
      .query("extractionTallyChanges")
      .withIndex("by_queuedAt", (q) => q.gte("queuedAt", cursor ?? 0n))
      .take(BATCH);
    if (!rows.length) return { kind: "idle" as const };
    return { kind: "work" as const, batch: { changes: rows.map((row) => row._id) }, cursor: rows.at(-1)!.queuedAt as bigint };
  },
});

/** Folds a batch of changes into their groups' tally rows, and each question's count of groups. */
export const fold = internalMutation({
  args: vMutationArgs,
  returns: vMutationReturns,
  handler: async (ctx, { changes: ids }) => {
    const changes = (await Promise.all(ids.map((id) => ctx.db.get(id)))).filter((change): change is Doc<"extractionTallyChanges"> => change !== null);
    // Each group's change, and each question's change in groups.
    const groups = new Map<string, { change: Doc<"extractionTallyChanges">; delta: number }>();
    for (const change of changes) {
      const id = JSON.stringify([change.jobId, change.questionKey, change.kind, change.key]);
      const group = groups.get(id) ?? { change, delta: 0 };
      group.delta += change.delta;
      // The latest wording names the group.
      group.change = change;
      groups.set(id, group);
    }
    const questions = new Map<string, { change: Doc<"extractionTallyChanges">; answers: number; items: number }>();
    // A job deleted since its changes were queued gets no tallies back.
    const jobs = [...new Set(changes.map((change) => change.jobId))];
    const live = new Set((await Promise.all(jobs.map((jobId) => ctx.db.get("extractionJobs", jobId)))).filter((job) => job !== null).map((job) => job._id));
    for (const { change, delta } of groups.values()) {
      if (delta === 0 || !live.has(change.jobId)) continue;
      const { jobId, questionKey, kind, key, shown } = change;
      const row = await ctx.db.query("extractionAnswerTallies").withIndex("by_group", (q) => q.eq("jobId", jobId).eq("questionKey", questionKey).eq("kind", kind).eq("key", key)).unique();
      const papers = (row?.papers ?? 0) + delta;
      const opened = !row && papers > 0;
      const closed = row !== null && papers <= 0;
      if (closed) await ctx.db.delete(row._id);
      else if (row) await ctx.db.patch(row._id, { papers, shown });
      else if (opened) await ctx.db.insert("extractionAnswerTallies", { jobId, questionKey, kind, key, shown, papers });
      if (!opened && !closed) continue;
      const qid = JSON.stringify([jobId, questionKey]);
      const question = questions.get(qid) ?? { change, answers: 0, items: 0 };
      question[kind === "answer" ? "answers" : "items"] += opened ? 1 : -1;
      questions.set(qid, question);
    }
    for (const { change, answers, items } of questions.values()) {
      const row = await ctx.db.query("extractionAnswerTotals").withIndex("by_job_question", (q) => q.eq("jobId", change.jobId).eq("questionKey", change.questionKey)).unique();
      if (row) await ctx.db.patch(row._id, { answers: Math.max(0, row.answers + answers), items: Math.max(0, row.items + items) });
      else await ctx.db.insert("extractionAnswerTotals", { jobId: change.jobId, questionKey: change.questionKey, answers: Math.max(0, answers), items: Math.max(0, items) });
    }
    for (const change of changes) await ctx.db.delete(change._id);
    return null;
  },
});
