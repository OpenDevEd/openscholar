/**
 * How many rows a list holds, kept as its rows change, so a paged list totals its pages
 * without reading them (#424). `research/recordCounts.ts` counts a person's whole table;
 * this counts lists that are part of a table or belong to nobody, such as a person's active
 * wallet keys or the admins. Each list is one namespace of the `listCounts` aggregate, and a
 * row is in it by ID, so counting a row twice or removing one that was never counted does
 * nothing: a backfill only has to count every row once more (migrations/pagedAccountLists.ts).
 *
 * This module holds no Convex functions, so the triggers can load it.
 */
import { DirectAggregate } from "@convex-dev/aggregate";
import type { Change } from "convex-helpers/server/triggers";
import { components } from "../_generated/api";
import type { DataModel, Doc, Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isVersionOperation } from "../evidenceLibraries/operationKinds";

export const listCounts = new DirectAggregate<{ Namespace: string; Key: null; Id: string }>(components.listCounts);

/** What a wallet key's hash holds between the consent and the key's creation. */
export const PENDING_WALLET_KEY = "__pending__";
export const walletKeysOf = (userId: Id<"users">, active: boolean) => `walletKeys:${userId}:${active ? "active" : "revoked"}`;
/** The list a person's wallet key shows in; a key still being made is in neither. */
export const walletKeyList = (key: Pick<Doc<"walletKeys">, "userId" | "isActive" | "hashedKey">) =>
  key.hashedKey === PENDING_WALLET_KEY ? null : walletKeysOf(key.userId, key.isActive);
export const ADMIN_LIST = "admins";
/** The libraries an organization has, for the total of the library list. */
export const organizationLibrariesOf = (organizationId: Id<"organizations">) => `organizationLibraries:${organizationId}`;
export const libraryVersionsOf = (libraryId: Id<"evidenceLibraries">) => `libraryVersions:${libraryId}`;
/** The versions list an operation shows in, if it is one of a library's versions. */
export const libraryVersionList = (operation: Doc<"evidenceLibraryConfigOperations">) =>
  isVersionOperation(operation) ? libraryVersionsOf(operation.libraryId) : null;

/** The trigger that keeps a table's rows counted, each under the list `listOf` puts it in, if any. */
export const countList =
  <Table extends TableNames>(listOf: (row: Doc<Table>) => string | null) =>
  async (ctx: MutationCtx, change: Change<DataModel, Table>) => {
    const before = change.oldDoc ? listOf(change.oldDoc) : null;
    const after = change.newDoc ? listOf(change.newDoc) : null;
    if (before === after) return;
    if (before !== null) await listCounts.deleteIfExists(ctx, { namespace: before, key: null, id: change.id });
    if (after !== null) await listCounts.insertIfDoesNotExist(ctx, { namespace: after, key: null, id: change.id });
  };

/** How many rows `list` holds. */
export const countOf = (ctx: QueryCtx, list: string) => listCounts.count(ctx, { namespace: list });

/** How many of `rows` the list `listOf` puts each in doesn't count: what a backfill's verify adds up. */
export async function uncounted<Row extends { _id: string }>(ctx: QueryCtx, rows: Row[], listOf: (row: Row) => string | null) {
  const listed = rows.flatMap((row) => {
    const list = listOf(row);
    const only = { key: null, id: row._id, inclusive: true };
    return list === null ? [] : [{ namespace: list, bounds: { lower: only, upper: only } }];
  });
  return (await listCounts.countBatch(ctx, listed)).filter((count) => count !== 1).length;
}
