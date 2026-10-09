/**
 * What a library view sorts, filters and counts by (#633). Each membership of a collection
 * carries its paper's sort and filter fields, so a collection's view reads its own index
 * instead of the whole collection, and the `libraryFacetCounts` aggregate counts every
 * filter field under its library or collection, so a filtered count reads no papers. Its
 * writes are queued once per mutation (../lib/countQueue.ts).
 * Triggers keep both, whichever write changes a paper or a membership.
 *
 * This module holds no Convex functions, so the triggers can load it.
 */
import { DirectAggregate } from "@convex-dev/aggregate";
import { queueCounts, type QueueingCtx } from "../lib/countQueue";
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
/** Whether a membership already carries its paper's fields. */
export const facetsMatch = (membership: Doc<"libraryItemCollections">, item: Doc<"libraryItems">) => sameFacets(facetsOf(item), { savedAt: membership.savedAt as number, rating: membership.rating, publicationYear: membership.publicationYear, citedByCount: membership.citedByCount, title: membership.title as string });

/** Memberships one scheduled mutation gives a paper's new fields; a paper in more collections gets the rest in the batches it schedules. */
export const FACET_COPY_BATCH = 500;
/**
 * Memberships a change to a paper updates in its own mutation: a paper in a few collections
 * shows its change there at once. One mutation may change many papers, so the rest go to a
 * mutation of their own.
 */
const FACET_COPY_INLINE = 20;
const copyFacets = makeFunctionReference<"mutation", { libraryItemId: Id<"libraryItems">; cursor: string | null }, null>("library/collections:copyFacets");

/** Gives a batch of a paper's memberships its fields, from `cursor`, skipping those that have them; schedules the next batch. */
export async function copyFacetBatch(ctx: MutationCtx, libraryItemId: Id<"libraryItems">, cursor: string | null) {
  const item = await ctx.db.get("libraryItems", libraryItemId);
  if (!item) return;
  const page = await ctx.db.query("libraryItemCollections").withIndex("by_item", (q) => q.eq("libraryItemId", libraryItemId)).paginate({ cursor, numItems: FACET_COPY_BATCH });
  for (const membership of page.page) if (!facetsMatch(membership, item)) await ctx.db.patch("libraryItemCollections", membership._id, facetsOf(item));
  if (!page.isDone) await ctx.scheduler.runAfter(0, copyFacets, { libraryItemId, cursor: page.continueCursor });
}

/** A paper whose fields changed passes them to the memberships that copy them. */
export async function copyChangedFacets(ctx: MutationCtx, change: Change<DataModel, "libraryItems">) {
  if (change.operation !== "update" || sameFacets(facetsOf(change.oldDoc), facetsOf(change.newDoc))) return;
  // `take`, not `paginate`: a mutation may paginate once, and it may change many papers.
  const memberships = await ctx.db.query("libraryItemCollections").withIndex("by_item", (q) => q.eq("libraryItemId", change.id)).take(FACET_COPY_INLINE + 1);
  for (const membership of memberships.slice(0, FACET_COPY_INLINE)) await ctx.db.patch("libraryItemCollections", membership._id, facetsOf(change.newDoc));
  if (memberships.length > FACET_COPY_INLINE) await ctx.scheduler.runAfter(0, copyFacets, { libraryItemId: change.id, cursor: null });
}

/** The filter fields counted, each under every library and collection. */
export const COUNTED_FIELDS = ["rating", "publicationYear", "savedAt"] as const;
export type CountedField = (typeof COUNTED_FIELDS)[number];

/**
 * Counts each counted field of every paper under `${library or collection}:${field}`, keyed by its value; an unset one is null.
 * A library is counted under its person and, once its papers have one, its workspace, until its reads go by workspace (#650).
 */
export const facetCounts = new DirectAggregate<{ Namespace: string; Key: number | null; Id: string }>(components.libraryFacetCounts);
type Scope = Id<"users"> | Id<"workspaces"> | Id<"collections">;
const namespaceOf = (scope: Scope, field: CountedField) => `${scope}:${field}`;

type Counted = { scopes: Scope[]; savedAt?: number; rating?: number; publicationYear?: number };
const entries = (row: Counted, id: string) => row.scopes.flatMap((scope) => COUNTED_FIELDS.map((field) => ({ namespace: namespaceOf(scope, field), key: row[field] ?? null, id })));

/** Keeps a row's counted fields counted. Inserting twice or deleting what isn't there does nothing, so a backfill just counts every row again. */
async function recount(ctx: QueueingCtx, id: string, before: Counted | null, after: Counted | null) {
  const was = before ? entries(before, id) : [];
  const now = after ? entries(after, id) : [];
  const among = (list: typeof was, entry: (typeof was)[number]) => list.some((other) => other.namespace === entry.namespace && other.key === entry.key);
  const operations = [
    ...was.filter((entry) => !among(now, entry)).map((entry) => ({ type: "deleteIfExists" as const, ...entry })),
    ...now.filter((entry) => !among(was, entry)).map((entry) => ({ type: "insertIfDoesNotExist" as const, ...entry })),
  ];
  await queueCounts(ctx, facetCounts, operations);
}

export const countedItem = (item: Doc<"libraryItems">): Counted => ({ ...item, scopes: [item.workspaceId] });
export const countedMembership = (membership: Doc<"libraryItemCollections">): Counted => ({ ...membership, scopes: [membership.collectionId] });

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
export function countInRange(ctx: QueryCtx, scope: Scope, field: CountedField, range: Range | null) {
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
