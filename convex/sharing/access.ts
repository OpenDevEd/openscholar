/**
 * Who outside an item's workspace has it (#653): a guest is one row a person and item, and
 * an invitation to an address is one row until it's answered. Nothing here is a Convex
 * function, so queries and mutations can import it.
 */
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { noteActivity } from "../activity/notes";
import { planLimit } from "../billing/accounts";
import { createError } from "../lib/errors";
import { countOf } from "../lib/listCounts";
import { addressesOf, personName } from "../lib/people";
import type { Acting } from "../lib/userActions";
import { actorIn } from "../workspaces/actor";
import { grantOf, guestCap, itemGuestsOf, kindWord, ownersHold, type Shared } from "./items";
import type { GuestRole } from "./validators";

type Read = Pick<QueryCtx, "db">;

/** The invitation to an item sent to an address, answered or not: an item keeps one an address. */
export const invitationTo = (ctx: Read, item: string, email: string) =>
  ctx.db.query("itemInvitations").withIndex("by_item_and_email", (q) => q.eq("item", item).eq("email", email)).unique();

/** The invitation to an item still waiting for a person, at any address of theirs. */
export async function waitingFor(ctx: Read, item: string, person: Pick<Doc<"users">, "email" | "verifiedEmails">) {
  for (const email of addressesOf(person)) {
    const invitation = await invitationTo(ctx, item, email);
    if (invitation?.state === "pending") return invitation;
  }
  return null;
}

/** The most guests the item has: what its workspace's plan allows, or its kind's own most where that's fewer; undefined for no limit. */
export async function roomFor(ctx: QueryCtx, shared: Shared) {
  const [plan, kind] = [await planLimit(ctx, shared.workspaceId, "guests"), guestCap(shared.kind)];
  return plan === undefined ? kind : kind === undefined ? plan : Math.min(plan, kind);
}

/** Refuses another guest once the item has all it may: what its workspace's plan allows, or its kind's own most where that's fewer. The people given it count, and the invitations to it still waiting. */
export async function requireRoom(ctx: QueryCtx, shared: Shared) {
  const plan = await planLimit(ctx, shared.workspaceId, "guests");
  const most = await roomFor(ctx, shared);
  if (most === undefined || (await countOf(ctx, itemGuestsOf(shared.id))) < most) return;
  const guests = `${most.toLocaleString("en")} ${most === 1 ? "guest" : "guests"}`;
  throw createError("VALIDATION_ERROR", most === plan ? `This workspace's plan allows ${guests} on each ${kindWord(shared.kind)}. Remove one.` : `One ${kindWord(shared.kind)} has up to ${guests}. Remove one to add another.`);
}

/** Whether a person has the item already, with no guest's place: they act in its workspace, and for a kind only its owners hold, an author profile, they own or run it (#1093). */
export async function holds(ctx: Read, shared: Shared, person: Doc<"users">) {
  const actor = await actorIn(ctx, person, shared.workspaceId);
  return actor !== null && (!ownersHold(shared.kind) || actor.role === "admin");
}

/** What a guest's place keeps of the item for a list that orders by it: a chat's newest message time. */
export const listedBy = (shared: Shared) => (shared.lastMessageAt === undefined ? {} : { lastMessageAt: shared.lastMessageAt });

/** Writes to an item's Activity that `by` shared it with someone, named as given. */
export const noteShared = async (ctx: Pick<MutationCtx, "db">, shared: Shared, by: Pick<Acting, "userId" | "author">, withWhom: string) => {
  // A chat keeps no activity.
  if (shared.kind === "chat") return;
  await noteActivity(ctx, { workspaceId: shared.workspaceId, by: by.userId, viaAssistant: by.author === "assistant" }, { kind: shared.kind, id: shared.pageId ?? shared.id, happened: "shared", detail: withWhom });
};

/** Writes to an item's Activity that `by` took it back from someone, or took back the invitation to them, named as given. */
export const noteUnshared = async (ctx: Pick<MutationCtx, "db">, shared: Shared, by: Pick<Acting, "userId" | "author">, fromWhom: string) => {
  if (shared.kind === "chat") return;
  await noteActivity(ctx, { workspaceId: shared.workspaceId, by: by.userId, viaAssistant: by.author === "assistant" }, { kind: shared.kind, id: shared.pageId ?? shared.id, happened: "unshared", detail: fromWhom });
};

/**
 * Gives a person the item, or changes what they may do with it. An invitation to their address
 * that still waits is answered by it, and its place becomes theirs.
 */
export async function give(ctx: MutationCtx, shared: Shared, person: Doc<"users">, role: GuestRole, by: Pick<Acting, "userId" | "author">) {
  const grant = await grantOf(ctx, shared.id, person._id);
  if (grant) {
    // Whoever changed it is who gave it, as an email about it says.
    if (grant.role !== role) await ctx.db.patch("itemAccess", grant._id, { role, grantedBy: by.userId });
    return;
  }
  const waiting = await waitingFor(ctx, shared.id, person);
  if (waiting) await ctx.db.patch("itemInvitations", waiting._id, { state: "accepted" });
  else await requireRoom(ctx, shared);
  await ctx.db.insert("itemAccess", { kind: shared.kind, item: shared.id, name: shared.name, userId: person._id, role, grantedBy: by.userId, grantedAt: Date.now(), ...listedBy(shared) });
  await noteShared(ctx, shared, by, personName(person) || person.email);
}
