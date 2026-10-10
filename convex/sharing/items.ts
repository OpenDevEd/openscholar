/**
 * The items a guest can be given (#653), each found by its ID, and what keeps guest rows true
 * to their item: its name as it changes, and nothing left of one that's gone. A row names
 * its item by ID alone, so it needs nothing when the item moves to another workspace.
 * This module holds no Convex functions, so the triggers can load it.
 */
import type { Change } from "convex-helpers/server/triggers";
import { makeFunctionReference } from "convex/server";
import type { DataModel, Doc, Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import type { InWorkspace } from "../workspaces/actor";
import type { GuestRole, SharedKind } from "./validators";

type Read = Pick<QueryCtx, "db">;

/** An item as sharing sees it: where it is, what it's called, and how much it holds (a collection's papers). */
export type Shared = { kind: SharedKind; id: string; workspaceId: Id<"workspaces">; name: string; size: number };

/**
 * Each kind's table, what its row is called, how much it holds, the word for one in a sentence,
 * and the roles a guest of one can be given. A collection's guests view it: changing what's in
 * one from outside its workspace comes with the actions that let them.
 */
const KINDS = {
  collection: { table: "collections", name: (row: Doc<"collections">) => row.name, size: (row: Doc<"collections">) => row.itemCount, word: "collection", roles: ["viewer"] },
} as const satisfies { [K in SharedKind]: { table: TableNames; name: (row: never) => string; size: (row: never) => number; word: string; roles: readonly GuestRole[] } };

export const kindWord = (kind: SharedKind) => KINDS[kind].word;

/** Refuses a role a guest of this kind can't be given. */
export function requireRole(kind: SharedKind, role: GuestRole) {
  const roles: readonly GuestRole[] = KINDS[kind].roles;
  if (!roles.includes(role)) throw createError("VALIDATION_ERROR", `A ${KINDS[kind].word} is shared to ${roles.map((one) => (one === "viewer" ? "view" : "edit")).join(" or ")} only.`);
}

/** The longest name sharing keeps of an item, in its guests' rows, its email and its lists: a name is shown in a row, not whole. */
const NAME_MAX = 200;

/** The item of `kind` with this ID, or null when there's none. */
export async function findShared(ctx: Read, kind: SharedKind, id: string): Promise<Shared | null> {
  const { table, name, size } = KINDS[kind];
  const rowId = ctx.db.normalizeId(table, id);
  const row = rowId ? await ctx.db.get(table, rowId) : null;
  // Whole characters: an emoji cut in two is no character at all.
  return row ? { kind, id: row._id, workspaceId: row.workspaceId, name: [...name(row)].slice(0, NAME_MAX).join(""), size: size(row) } : null;
}

/** The item, for someone who acts in its workspace: only they share it, and anyone else learns nothing of it. */
export async function sharedIn(ctx: Read, { workspaceId }: InWorkspace, kind: SharedKind, id: string) {
  const shared = await findShared(ctx, kind, id);
  if (shared?.workspaceId !== workspaceId) throw createError("NOT_FOUND", "It isn't in this workspace.");
  return shared;
}

/** A person's place as a guest of an item, if they have one. */
export const grantOf = (ctx: Read, item: string, userId: Id<"users">) =>
  ctx.db.query("itemAccess").withIndex("by_item_and_user", (q) => q.eq("item", item).eq("userId", userId)).unique();

/**
 * Whether a workspace's items are still anyone's to open: its owner's account is active, or its
 * organization is and isn't being deleted. One that's gone keeps its rows until they're purged,
 * and its guests' places until `upkeep.close` has taken them, which is a moment after it goes.
 */
export async function open(ctx: Read, workspaceId: Id<"workspaces">) {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (!workspace) return false;
  if (workspace.kind === "personal") return (await ctx.db.get("users", workspace.userId))?.state === "active";
  const organization = await ctx.db.get("organizations", workspace.organizationId);
  return organization?.state === "active" && organization.deletingAt === undefined;
}

/**
 * A person's role as a guest of an item, while they act in their own workspace: what's shared
 * with someone is theirs to open there and nowhere else, so what they run on it spends their
 * own credits. Null when they aren't its guest, or its workspace is gone.
 */
export async function guestRole(ctx: Read, { userId, workspaceId }: InWorkspace, item: { _id: string; workspaceId: Id<"workspaces"> }): Promise<GuestRole | null> {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (workspace?.kind !== "personal" || workspace.userId !== userId) return null;
  const role = (await grantOf(ctx, item._id, userId))?.role;
  return role && (await open(ctx, item.workspaceId)) ? role : null;
}

/** The list that counts an item's guests: the people given it, and the invitations to it still waiting. */
export const itemGuestsOf = (item: string) => `itemGuests:${item}`;
/** The lists that count what's shared with a person: all of it, and each kind. */
export const sharedWithOf = (userId: Id<"users">, kind?: SharedKind) => `sharedWith:${userId}${kind ? `:${kind}` : ""}`;

/** Guest rows one step brings in step with their item, or deletes with it: each deletion also takes the row out of three counts. */
export const FOLLOW_STEP = 50;
const follow = makeFunctionReference<"mutation", { kind: SharedKind; item: string; cursor: string | null }, null>("sharing/upkeep:follow");

/** Whether anyone was given the item or invited to it. */
async function hasGuests(ctx: Read, item: string) {
  return Boolean(
    (await ctx.db.query("itemAccess").withIndex("by_item_and_user", (q) => q.eq("item", item)).first()) ??
      (await ctx.db.query("itemInvitations").withIndex("by_item_and_state", (q) => q.eq("item", item)).first()),
  );
}

/**
 * The trigger on a kind's table: when an item with guests is renamed or deleted, its guest
 * rows follow, a step at a time in transactions of their own.
 */
export const followShared =
  <K extends SharedKind>(kind: K) =>
  async (ctx: MutationCtx, change: Change<DataModel, (typeof KINDS)[K]["table"]>) => {
    if (change.operation === "insert") return;
    // The table is the kind's own, which the type of a table picked by a type parameter doesn't say.
    const name = KINDS[kind].name as (row: unknown) => string;
    if (change.operation === "update" && name(change.oldDoc) === name(change.newDoc)) return;
    if (await hasGuests(ctx, change.id)) await ctx.scheduler.runAfter(0, follow, { kind, item: change.id, cursor: null });
  };
