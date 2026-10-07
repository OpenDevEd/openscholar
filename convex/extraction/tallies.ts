/**
 * How many papers gave each answer to a question, and named each item of a list answer
 * (#634): what a summary of a question shows, read largest first however many papers the
 * job has. Kept as Firecrawl keeps its ledger, like the job's counts (./counts.ts): the
 * trigger on extractionAnswerRows appends each change, and one worker folds them into the
 * tally rows, so papers finishing at once never write the same row.
 *
 * This module holds no Convex functions, so the triggers can load it; the worker is
 * ./talliesWorker.ts.
 */
import { ping } from "@convex-dev/batch-worker";
import type { Change } from "convex-helpers/server/triggers";
import { components, internal } from "../_generated/api";
import type { DataModel, Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

type Group = { kind: "answer" | "item"; key: string; shown: string };

/** The groups an answer row counts in: its answer, when it has one, and each item of a list answer. A row not tallied yet counts in none. */
const groupsOf = (row: Doc<"extractionAnswerRows"> | null): Group[] =>
  !row?.tallied ? [] : [...(row.token === null ? [] : [{ kind: "answer" as const, key: row.token, shown: row.shown }]), ...row.items.map((item) => ({ kind: "item" as const, ...item }))];
const sameGroup = (a: Group, b: Group) => a.kind === b.kind && a.key === b.key;

/** Appends what an answer row's change moved between groups, and wakes the worker. */
export async function tallyAnswerChange(ctx: MutationCtx, change: Change<DataModel, "extractionAnswerRows">) {
  const row = change.newDoc ?? change.oldDoc!;
  // A deleted job's rows go with its tallies, which its deletion drains.
  if (!change.newDoc && !(await ctx.db.get("extractionJobs", row.jobId))) return;
  const was = groupsOf(change.oldDoc);
  const now = groupsOf(change.newDoc);
  const moves = [
    ...was.filter((group) => !now.some((other) => sameGroup(group, other))).map((group) => ({ ...group, delta: -1 })),
    ...now.filter((group) => !was.some((other) => sameGroup(group, other))).map((group) => ({ ...group, delta: 1 })),
  ];
  if (!moves.length) return;
  for (const move of moves) await ctx.db.insert("extractionTallyChanges", { jobId: row.jobId, questionKey: row.questionKey, ...move, queuedAt: ctx.db.vars.commitTs });
  await ping(ctx, components.batchWorker, {
    name: "extractionTallies",
    workQuery: internal.extraction.talliesWorker.nextChanges,
    workerMutation: internal.extraction.talliesWorker.fold,
    config: { debounceMs: 100 },
  });
}

/** A question's largest groups of one kind, and how many groups it has in all. */
export async function largestGroups(ctx: QueryCtx, jobId: Id<"extractionJobs">, questionKey: string, kind: "answer" | "item", count: number) {
  const top = await ctx.db
    .query("extractionAnswerTallies")
    .withIndex("by_size", (q) => q.eq("jobId", jobId).eq("questionKey", questionKey).eq("kind", kind))
    .order("desc")
    .take(count);
  const totals = await ctx.db.query("extractionAnswerTotals").withIndex("by_job_question", (q) => q.eq("jobId", jobId).eq("questionKey", questionKey)).unique();
  return { top, groups: (kind === "answer" ? totals?.answers : totals?.items) ?? 0 };
}
