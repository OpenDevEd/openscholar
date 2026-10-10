/**
 * "Shared with me" (#653): the items a person is a guest of. They are theirs to open in
 * their own workspace only, so in an organization the list is empty.
 */
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import { v } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import { countOf } from "../lib/listCounts";
import { personName } from "../lib/people";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";
import schema from "../schema";
import type { InWorkspace } from "../workspaces/actor";
import { workspaceFrom } from "../workspaces/personal";
import { findShared, sharedWithOf } from "./items";
import { guestRoleValidator, sharedFromValidator, sharedKindValidator, sharedKinds, type SharedKind } from "./validators";

/** Most shared items one page holds. */
const SHARED_PAGE_MAX = 50;
/** Rows one page of a text search looks through for the ones whose name matches. */
const SHARED_FILTER_ROWS = 500;

/** Whether the person acts in their own workspace, where what's shared with them is. */
async function inOwn(ctx: Pick<QueryCtx, "db">, { userId, workspaceId }: InWorkspace) {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  return workspace?.kind === "personal" && workspace.userId === userId;
}

export const listAction = defineUserQuery({
  path: "sharing/shared:list",
  description:
    "Lists what's shared with the person from other workspaces, a page at a time, newest shared first or by name (`sort`): each item's kind, ID and name, what they may do with it (`viewer` or `editor`), who shared it, " +
    "the workspace it's in and how much it holds (a collection's papers). `kind` keeps one kind, and `text` the items whose name contains it. Empty in an organization: what's shared with someone is in their own workspace.",
  args: { kind: v.optional(sharedKindValidator), text: v.optional(v.string()), sort: v.union(v.literal("recent"), v.literal("name")), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({ kind: sharedKindValidator, id: v.string(), name: v.string(), role: guestRoleValidator, at: v.number(), by: v.object({ name: v.string(), imageUrl: v.optional(v.string()) }), from: sharedFromValidator, size: v.number() }),
  ),
  run: async (ctx, actor, { kind, text, sort, paginationOpts }) => {
    if (!(await inOwn(ctx, actor))) return { page: [], isDone: true, continueCursor: "" };
    const { userId } = actor;
    const needle = text?.trim().toLowerCase() ?? "";
    const rows = stream(ctx.db, schema).query("itemAccess");
    const ordered =
      sort === "name"
        ? (kind ? rows.withIndex("by_user_and_kind_and_name", (q) => q.eq("userId", userId).eq("kind", kind)) : rows.withIndex("by_user_and_name", (q) => q.eq("userId", userId))).order("asc")
        : (kind ? rows.withIndex("by_user_and_kind_and_grantedAt", (q) => q.eq("userId", userId).eq("kind", kind)) : rows.withIndex("by_user_and_grantedAt", (q) => q.eq("userId", userId))).order("desc");
    const read = await ordered
      .filterWith(async (row) => !needle || row.name.toLowerCase().includes(needle))
      .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, SHARED_PAGE_MAX), maximumRowsRead: SHARED_FILTER_ROWS });
    const page = await Promise.all(read.page.map(async (row) => {
      const [shared, sharer] = await Promise.all([findShared(ctx, row.kind, row.item), ctx.db.get("users", row.grantedBy)]);
      // One whose item was just deleted goes with it in a moment (./upkeep.ts).
      if (!shared) return [];
      return [{
        kind: row.kind, id: shared.id, name: shared.name, role: row.role, at: row.grantedAt,
        by: { name: sharer ? personName(sharer) || sharer.email : "", ...(sharer?.avatarUrl ? { imageUrl: sharer.avatarUrl } : {}) },
        from: await workspaceFrom(ctx, shared.workspaceId), size: shared.size,
      }];
    }));
    return { ...read, page: page.flat() };
  },
});
export const list = userQuery(listAction);
export const listForAssistant = assistantQuery(listAction);

export const countsAction = defineUserQuery({
  path: "sharing/shared:counts",
  description: "How many items are shared with the person from other workspaces: in all (`total`), and of each kind, under its name.",
  args: {},
  // A count for each of ./validators.ts `sharedKinds`.
  returns: v.object({ total: v.number(), collection: v.number() }),
  run: async (ctx, { userId }) => {
    const [total, ...each] = await Promise.all([countOf(ctx, sharedWithOf(userId)), ...sharedKinds.map((kind) => countOf(ctx, sharedWithOf(userId, kind)))]);
    return { total, ...(Object.fromEntries(sharedKinds.map((kind, at) => [kind, each[at]])) as Record<SharedKind, number>) };
  },
});
export const counts = userQuery(countsAction);
export const countsForAssistant = assistantQuery(countsAction);
