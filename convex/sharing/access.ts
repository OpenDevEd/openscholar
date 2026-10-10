/**
 * Who outside an item's workspace has it (#653): a guest is one row a person and item, and
 * an invitation to an address is one row until it's answered. Nothing here is a Convex
 * function, so queries and mutations can import it.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { noteActivity } from "../activity/notes";
import { planLimit } from "../billing/accounts";
import { createError } from "../lib/errors";
import { countOf } from "../lib/listCounts";
import { personName } from "../lib/people";
import type { Acting } from "../lib/userActions";
import { itemGuestsOf, kindWord, type Shared } from "./items";
import type { GuestRole } from "./validators";

type Read = Pick<QueryCtx, "db">;

/** A person's place as a guest of an item, if they have one. */
export const grantOf = (ctx: Read, item: string, userId: Id<"users">) =>
  ctx.db.query("itemAccess").withIndex("by_item_and_user", (q) => q.eq("item", item).eq("userId", userId)).unique();

/** The invitation to an item sent to an address, answered or not: an item keeps one an address. */
export const invitationTo = (ctx: Read, item: string, email: string) =>
  ctx.db.query("itemInvitations").withIndex("by_item_and_email", (q) => q.eq("item", item).eq("email", email)).unique();

/** Refuses another guest once the item has all its workspace's plan allows: the people given it, and the invitations to it still waiting. */
export async function requireRoom(ctx: QueryCtx, shared: Shared) {
  const most = await planLimit(ctx, shared.workspaceId, "guests");
  if (most === undefined || (await countOf(ctx, itemGuestsOf(shared.id))) < most) return;
  throw createError("VALIDATION_ERROR", `This workspace's plan allows ${most.toLocaleString("en")} ${most === 1 ? "guest" : "guests"} on each ${kindWord(shared.kind)}. Remove one, or change plan for more.`);
}

/** Writes to an item's Activity that `by` shared it with someone, named as given. */
export const noteShared = (ctx: Pick<MutationCtx, "db">, shared: Shared, by: Pick<Acting, "userId" | "author">, withWhom: string) =>
  noteActivity(ctx, { workspaceId: shared.workspaceId, by: by.userId, viaAssistant: by.author === "assistant" }, { kind: shared.kind, id: shared.id, happened: "shared", detail: withWhom });

/**
 * Gives a person the item, or changes what they may do with it. An invitation to their address
 * that still waits is answered by it, and its place becomes theirs.
 */
export async function give(ctx: MutationCtx, shared: Shared, person: Doc<"users">, role: GuestRole, by: Pick<Acting, "userId" | "author">) {
  const grant = await grantOf(ctx, shared.id, person._id);
  if (grant) {
    if (grant.role !== role) await ctx.db.patch("itemAccess", grant._id, { role });
    return;
  }
  const waiting = await invitationTo(ctx, shared.id, person.email.toLowerCase());
  if (waiting?.state === "pending") await ctx.db.patch("itemInvitations", waiting._id, { state: "accepted" });
  else await requireRoom(ctx, shared);
  await ctx.db.insert("itemAccess", { kind: shared.kind, item: shared.id, name: shared.name, userId: person._id, role, grantedBy: by.userId, grantedAt: Date.now() });
  await noteShared(ctx, shared, by, personName(person) || person.email);
}
