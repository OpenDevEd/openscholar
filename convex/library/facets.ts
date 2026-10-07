/**
 * What a library view sorts, filters and counts by (#633). Each membership of a collection
 * carries its paper's sort and filter fields, so a collection's view reads its own index
 * instead of the whole collection, and the `libraryFacetCounts` aggregate counts every
 * filter field under its library or collection, so a filtered count reads no papers.
 * Triggers keep both, whichever write changes a paper or a membership.
 *
 * This module holds no Convex functions, so the triggers can load it.
 */
import { DirectAggregate, type AggregateOperation } from "@convex-dev/aggregate";
import type { Change } from "convex-helpers/server/triggers";
import { makeFunctionReference } from "convex/server";
import { components } from "../_generated/api";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** The fields of a saved paper its memberships copy. */
export const facetsOf = (item: Doc<"libraryItems">) => ({
  savedAt: item.savedAt,
  rating: item.rating,
  publicationYear: item.publicationYear,
  citedByCount: item.citedByCount,
  title: item.title,
});
type Facets = ReturnType<typeof facetsOf>;
const sameFacets = (a: Facets, b: Facets) => (Object.keys(a) as (keyof Facets)[]).every((field) => a[field] === b[field]);

/** Memberships one transaction gives a paper's new fields; a paper in more collections gets the rest in the batches this schedules. */
export const FACET_COPY_BATCH = 500;
const copyFacets = makeFunctionReference<"mutation", { libraryItemId: Id<"libraryItems">; cursor: string | null }, null>("library/collections:copyFacets");

/** Gives a batch of a paper's memberships its fields, from `cursor`; schedules the next batch. */
export async function copyFacetBatch(ctx: MutationCtx, libraryItemId: Id<"libraryItems">, cursor: string | null) {
  const item = await ctx.db.get("libraryItems", libraryItemId);
  if (!item) return;
  const facets = facetsOf(item);
  const page = await ctx.db.query("libraryItemCollections").withIndex("by_item", (q) => q.eq("libraryItemId", libraryItemId)).paginate({ cursor, numItems: FACET_COPY_BATCH });
  for (const membership of page.page) await ctx.db.patch("libraryItemCollections", membership._id, facets);
  if (!page.isDone) await ctx.scheduler.runAfter(0, copyFacets, { libraryItemId, cursor: page.continueCursor });
}

/** A paper whose fields changed passes them to the memberships that copy them. */
export async function copyChangedFacets(ctx: MutationCtx, change: Change<DataModel, "libraryItems">) {
  if (change.operation !== "update" || sameFacets(facetsOf(change.oldDoc), facetsOf(change.newDoc))) return;
  await copyFacetBatch(ctx, change.id, null);
}

/** The filter fields counted, each under every library and collection. */
export const COUNTED_FIELDS = ["rating", "publicationYear", "savedAt"] as const;
export type CountedField = (typeof COUNTED_FIELDS)[number];

/** Counts each counted field of every paper under `${library or collection}:${field}`, keyed by its value; an unset one is null. */
export const facetCounts = new DirectAggregate<{ Namespace: string; Key: number | null; Id: string }>(components.libraryFacetCounts);
const namespaceOf = (scope: Id<"users"> | Id<"collections">, field: CountedField) => `${scope}:${field}`;

type Counted = { scope: Id<"users"> | Id<"collections">; savedAt?: number; rating?: number; publicationYear?: number };
const entries = (row: Counted, id: string) => COUNTED_FIELDS.map((field) => ({ namespace: namespaceOf(row.scope, field), key: row[field] ?? null, id }));

type FacetOperation = AggregateOperation<number | null, string, string>;
/** A mutation's count writes, gathered as its triggers run and queued once when it ends (convex/lib/functions.ts). */
export type FacetQueue = FacetOperation[];
type QueueingCtx = MutationCtx & { facetQueue?: FacetQueue };

/**
 * Queues a mutation's count writes in one call, applied in order by the aggregate's batch
 * worker a moment later. Written in place, a save of a few hundred papers passes the 4,096
 * index ranges one transaction may read; queued one by one, each reads the queue's newest
 * entry again, and a few hundred pass the 16 MiB.
 */
export async function flushFacetQueue(ctx: MutationCtx, queue: FacetQueue) {
  if (queue.length > 0) await facetCounts.enqueueBatch(ctx, queue.splice(0));
}

/** Keeps a row's counted fields counted. Inserting twice or deleting what isn't there does nothing, so a backfill just counts every row again. */
async function recount(ctx: QueueingCtx, id: string, before: Counted | null, after: Counted | null) {
  const was = before ? entries(before, id) : [];
  const now = after ? entries(after, id) : [];
  const same = (a: (typeof was)[number], b: (typeof was)[number] | undefined) => b?.namespace === a.namespace && b.key === a.key;
  const operations = [
    ...was.filter((entry, index) => !same(entry, now[index])).map((entry) => ({ type: "deleteIfExists" as const, ...entry })),
    ...now.filter((entry, index) => !same(entry, was[index])).map((entry) => ({ type: "insertIfDoesNotExist" as const, ...entry })),
  ];
  // A write outside the app's mutation builders, such as a test's uncapped seed, queues its own.
  if (ctx.facetQueue) ctx.facetQueue.push(...operations);
  else if (operations.length > 0) await facetCounts.enqueueBatch(ctx, operations);
}

export const countedItem = (item: Doc<"libraryItems">): Counted => ({ scope: item.userId, ...item });
export const countedMembership = (membership: Doc<"libraryItemCollections">): Counted => ({ scope: membership.collectionId, ...membership });

export const countItemChange = (ctx: MutationCtx, change: Change<DataModel, "libraryItems">) =>
  recount(ctx, change.id, change.oldDoc ? countedItem(change.oldDoc) : null, change.newDoc ? countedItem(change.newDoc) : null);
/**
 * A new membership gets its paper's fields, whichever write made it; the patch comes back
 * here as an update, which counts it. A membership without them was never counted, so its
 * fields are counted afresh; every other change is counted as it is.
 */
export async function fillAndCountMembership(ctx: MutationCtx, change: Change<DataModel, "libraryItemCollections">) {
  if (change.operation === "insert" && change.newDoc.savedAt === undefined) {
    const item = await ctx.db.get("libraryItems", change.newDoc.libraryItemId);
    if (item) await ctx.db.patch("libraryItemCollections", change.id, facetsOf(item));
    return;
  }
  const counted = (membership: Doc<"libraryItemCollections"> | null) => (membership && membership.savedAt !== undefined ? countedMembership(membership) : null);
  await recount(ctx, change.id, counted(change.oldDoc), counted(change.newDoc));
}

/** Counts every counted field of a row that may predate the counts: what the backfill does. */
export const countRow = (ctx: MutationCtx, id: string, row: Counted) => recount(ctx, id, null, row);

/** A range of a field's values, either end open. */
export type Range = { lower?: number; upper?: number };

/**
 * How many papers of a library or collection have `field` in `range`, or unset when `range`
 * is null. A range never holds an unset value: null sorts before every number.
 */
export function countInRange(ctx: QueryCtx, scope: Id<"users"> | Id<"collections">, field: CountedField, range: Range | null) {
  const namespace = namespaceOf(scope, field);
  if (range === null) return facetCounts.count(ctx, { namespace, bounds: { eq: null }, stale: true });
  const lower = range.lower === undefined ? { key: null, inclusive: false } : { key: range.lower, inclusive: true };
  return facetCounts.count(ctx, { namespace, bounds: { lower, ...(range.upper === undefined ? {} : { upper: { key: range.upper, inclusive: true } }) }, stale: true });
}

/** How many of these rows' counted fields the counts are missing: what the backfill's verify adds up. */
export async function uncountedFacets(ctx: QueryCtx, rows: { id: string; row: Counted }[]) {
  const queries = rows.flatMap(({ id, row }) =>
    entries(row, id).map(({ namespace, key }) => ({ namespace, bounds: { lower: { key, id, inclusive: true }, upper: { key, id, inclusive: true } } })),
  );
  return (await facetCounts.countBatch(ctx, queries, { stale: true })).filter((count) => count !== 1).length;
}

/** Whether a membership already carries its paper's fields. */
export const facetsMatch = (membership: Doc<"libraryItemCollections">, item: Doc<"libraryItems">) => sameFacets(facetsOf(item), { savedAt: membership.savedAt as number, rating: membership.rating, publicationYear: membership.publicationYear, citedByCount: membership.citedByCount, title: membership.title as string });
