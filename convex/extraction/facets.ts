/**
 * An extraction job's papers counted by what its results page filters and its summary
 * groups (#634), so a filtered view, its count and a summary read the papers they show,
 * not the whole job. Each job's counts are namespaces of the `extractionFacetCounts`
 * aggregate, and the aggregate doubles as an index: the papers under a key are read from it
 * in order (`papersUnder`).
 *
 * - `${jobId}:confidence`: each processable paper by its average confidence.
 * - `${jobId}:tag`: each processable paper under each status tag it has.
 * - `${jobId}:answer:${questionKey}`: each paper by its answer's token to that question.
 * - `${jobId}:item:${questionKey}`: each paper under each item of its list answer.
 *
 * Triggers on extractionPapers and extractionAnswerRows keep them, queued once per mutation
 * (../lib/countQueue.ts). This module holds no Convex functions, so the triggers can load it.
 */
import { DirectAggregate } from "@convex-dev/aggregate";
import type { Change } from "convex-helpers/server/triggers";
import { components } from "../_generated/api";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { queueCounts, type QueueingCtx } from "../lib/countQueue";

type Key = number | string | null;
export const extractionCounts = new DirectAggregate<{ Namespace: string; Key: Key; Id: string }>(components.extractionFacetCounts);

/** The status tags the results page filters by that a paper has or hasn't; confidence tags are ranges of confidence. */
export const PAPER_TAGS = ["has-pdf", "abstract-only", "open-access", "has-errors"] as const;
export type PaperTag = (typeof PAPER_TAGS)[number];
export const tagsOf = (paper: Pick<Doc<"extractionPapers">, "hasPdfSource" | "pdfContentUsed" | "isOpenAccess" | "hasErrors">): PaperTag[] => [
  ...(paper.hasPdfSource ? ["has-pdf" as const] : []),
  ...(!paper.pdfContentUsed ? ["abstract-only" as const] : []),
  ...(paper.isOpenAccess ? ["open-access" as const] : []),
  ...(paper.hasErrors ? ["has-errors" as const] : []),
];

export const confidenceOf = (jobId: Id<"extractionJobs">) => `${jobId}:confidence`;
export const tagOf = (jobId: Id<"extractionJobs">) => `${jobId}:tag`;
export const answerOf = (jobId: Id<"extractionJobs">, questionKey: string) => `${jobId}:answer:${questionKey}`;
export const itemOf = (jobId: Id<"extractionJobs">, questionKey: string) => `${jobId}:item:${questionKey}`;

type Entry = { namespace: string; key: Key; id: string };
const same = (a: Entry, b: Entry) => a.namespace === b.namespace && a.key === b.key && a.id === b.id;

/** Queues what moved between two sets of entries. Inserting twice or deleting what isn't there does nothing, so a backfill just counts every row again. */
async function move(ctx: QueueingCtx, was: Entry[], now: Entry[]) {
  await queueCounts(ctx, extractionCounts, [
    ...was.filter((entry) => !now.some((other) => same(entry, other))).map((entry) => ({ type: "deleteIfExists" as const, ...entry })),
    ...now.filter((entry) => !was.some((other) => same(entry, other))).map((entry) => ({ type: "insertIfDoesNotExist" as const, ...entry })),
  ]);
}

/** A processable paper's entries: its confidence and its tags. The results page shows only processable papers. */
export function paperEntries(paper: Doc<"extractionPapers"> | null): Entry[] {
  if (!paper || paper.processable !== true || paper.avgConfidence === undefined) return [];
  return [
    { namespace: confidenceOf(paper.jobId), key: paper.avgConfidence, id: paper._id },
    ...tagsOf(paper).map((tag) => ({ namespace: tagOf(paper.jobId), key: tag, id: `${paper._id}:${tag}` })),
  ];
}

/** An answer row's entries: its answer's token, and each item of a list answer. */
export function answerEntries(row: Doc<"extractionAnswerRows"> | null): Entry[] {
  if (!row) return [];
  return [
    { namespace: answerOf(row.jobId, row.questionKey), key: row.token, id: row.paperId },
    ...row.items.map((item) => ({ namespace: itemOf(row.jobId, row.questionKey), key: item.key, id: `${row.paperId}:${item.key}` })),
  ];
}

export const countPaperChange = (ctx: QueueingCtx, change: Change<DataModel, "extractionPapers">) => move(ctx, paperEntries(change.oldDoc), paperEntries(change.newDoc));
export const countAnswerChange = (ctx: QueueingCtx, change: Change<DataModel, "extractionAnswerRows">) => move(ctx, answerEntries(change.oldDoc), answerEntries(change.newDoc));

/** Counts every entry of a row that may predate the counts: what the backfill does. */
export const countEntries = (ctx: QueueingCtx, entries: Entry[]) => move(ctx, [], entries);

/** One key, or a range of numbers: `lower` and `upper` inclusive, `below` exclusive, any end open. */
export type Range = { eq: Key } | { lower?: number; upper?: number; below?: number };
const boundsOf = (range: Range) => {
  if ("eq" in range) return { eq: range.eq };
  // An open lower end still leaves out null, which sorts before every number.
  const lower = range.lower === undefined ? { key: null, inclusive: false } : { key: range.lower, inclusive: true };
  const upper = range.below !== undefined ? { key: range.below, inclusive: false } : range.upper !== undefined ? { key: range.upper, inclusive: true } : undefined;
  return { lower, ...(upper ? { upper } : {}) };
};

/** How many entries of a namespace have a key in `range`. A moment behind the writes. */
export const countIn = (ctx: QueryCtx, namespace: string, range: Range) => extractionCounts.count(ctx, { namespace, bounds: boundsOf(range) as never, stale: true });

/** The ids under keys in `range`, in key order, a page at a time. */
export async function idsIn(ctx: QueryCtx, namespace: string, range: Range, cursor: string | undefined, pageSize: number) {
  const page = await extractionCounts.paginate(ctx, { namespace, bounds: boundsOf(range) as never, cursor, pageSize, stale: true });
  return { ids: page.page.map((item) => item.id), cursor: page.cursor, isDone: page.isDone };
}

/** The first key after `after` in a namespace (from its first without one), and how many entries it has: one group of a summary. */
export async function nextGroup(ctx: QueryCtx, namespace: string, after: { key: Key } | undefined) {
  // An exclusive lower bound with no id starts past every entry under that key.
  const page = await extractionCounts.paginate(ctx, { namespace, bounds: (after ? { lower: { key: after.key, inclusive: false } } : undefined) as never, pageSize: 1, stale: true });
  const first = page.page[0];
  if (!first) return null;
  return { key: first.key, papers: await countIn(ctx, namespace, { eq: first.key }) };
}
