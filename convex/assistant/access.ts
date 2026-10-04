/**
 * Who can open an assistant chat (#324). A chat's access rows name its principals: its
 * owner, the people it is shared with, and the organizations whose every member it is
 * shared with. Nothing here is a Convex function, so queries, mutations and triggers can
 * all import it.
 */
import type { Infer } from "convex/values";
import { components } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { MAX_ASSISTANT_THREAD_GRANTS } from "../lib/queryBounds";
import { readMemberOrganizations } from "../organizationFeatures";
import type { assistantPrincipalValidator, assistantRoleValidator } from "./validators";

export type AssistantRole = Infer<typeof assistantRoleValidator>;
export type AssistantPrincipal = Infer<typeof assistantPrincipalValidator>;

const RANK: Record<AssistantRole, number> = { read: 1, write: 2, owner: 3 };

export const userPrincipal = (userId: Id<"users">) => `user:${userId}`;
export const organizationPrincipal = (organizationId: Id<"organizations">) => `organization:${organizationId}`;
export const principalKey = (principal: AssistantPrincipal) =>
  principal.kind === "user" ? userPrincipal(principal.userId) : organizationPrincipal(principal.organizationId);

/** The principal a key names; an ID that is no longer one of ours gives null. */
export function principalOf(ctx: QueryCtx | MutationCtx, key: string): AssistantPrincipal | null {
  const [kind, id] = key.split(":");
  if (kind === "user") {
    const userId = ctx.db.normalizeId("users", id);
    return userId ? { kind, userId } : null;
  }
  const organizationId = ctx.db.normalizeId("organizations", id);
  return organizationId ? { kind: "organization", organizationId } : null;
}

/**
 * Every principal a chat can reach this person through: themselves first, then their
 * active organizations in a fixed order, so a chat that reaches them several ways always
 * lists through the same one.
 */
export async function principalsOf(ctx: QueryCtx | MutationCtx, user: Doc<"users">): Promise<string[]> {
  const organizations = await readMemberOrganizations(ctx, user);
  return [userPrincipal(user._id), ...organizations.map(({ organization }) => organizationPrincipal(organization._id)).sort()];
}

export function accessRow(ctx: QueryCtx | MutationCtx, threadId: Id<"assistantThreads">, principal: string) {
  return ctx.db
    .query("assistantThreadAccess")
    .withIndex("by_thread_and_principal", (q) => q.eq("threadId", threadId).eq("principal", principal))
    .unique();
}

/** A chat's access rows: its owner's and up to MAX_ASSISTANT_THREAD_GRANTS more, which `grant` enforces. */
export function accessRows(ctx: QueryCtx | MutationCtx, threadId: Id<"assistantThreads">) {
  return ctx.db
    .query("assistantThreadAccess")
    .withIndex("by_thread_and_principal", (q) => q.eq("threadId", threadId))
    .take(MAX_ASSISTANT_THREAD_GRANTS + 1);
}

/** A person's name as they gave it, or empty when they gave none. */
export const personName = (person: Doc<"users">) => [person.firstName, person.lastName].filter(Boolean).join(" ");

/** The highest of some roles; at least one is given. */
export const best = (roles: readonly AssistantRole[]) => roles.reduce((most, role) => (RANK[role] > RANK[most] ? role : most));

/** The most this person may do in the chat through any of `principals`, or null when it isn't shared with them. */
export async function roleAmong(ctx: QueryCtx | MutationCtx, threadId: Id<"assistantThreads">, principals: readonly string[]): Promise<AssistantRole | null> {
  const mine = new Set(principals);
  const roles = (await accessRows(ctx, threadId)).filter((row) => mine.has(row.principal)).map((row) => row.role);
  return roles.length ? best(roles) : null;
}

/**
 * The chat and what this person may do in it. A chat that doesn't exist and one that isn't
 * shared with them fail the same way, so its ID tells a stranger nothing.
 */
export async function requireThread(ctx: QueryCtx | MutationCtx, userId: Id<"users">, threadId: Id<"assistantThreads">, atLeast: AssistantRole = "read") {
  const [thread, user] = await Promise.all([ctx.db.get("assistantThreads", threadId), ctx.db.get("users", userId)]);
  const role = thread && user ? await roleAmong(ctx, threadId, await principalsOf(ctx, user)) : null;
  if (!thread || !role) throw createError("NOT_FOUND", "Chat not found");
  if (RANK[role] < RANK[atLeast]) {
    throw createError("FORBIDDEN", atLeast === "owner" ? "Only the chat's owner can do this." : "You can read this chat, but not write in it.");
  }
  return { thread, role };
}

/** Moves the chat to the top of every list it shows in: its own row and each access row take the new time. */
export async function touchThread(ctx: MutationCtx, threadId: Id<"assistantThreads">, at: number) {
  await ctx.db.patch("assistantThreads", threadId, { lastMessageAt: at, updatedAt: at });
  for (const row of await accessRows(ctx, threadId)) await ctx.db.patch("assistantThreadAccess", row._id, { lastMessageAt: at });
}

/** Deletes the chat for everyone: its access rows, its record, the room of people who had it open, and its messages, which the agent component deletes a page at a time. */
export async function deleteThread(ctx: MutationCtx, thread: Doc<"assistantThreads">) {
  for (const row of await accessRows(ctx, thread._id)) await ctx.db.delete("assistantThreadAccess", row._id);
  await ctx.db.delete("assistantThreads", thread._id);
  await ctx.runMutation(components.presence.public.removeRoom, { roomId: thread._id });
  await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, { threadId: thread.agentThreadId });
}

/** Chats one cleanup run deletes for a purged account; each takes its access rows with it. */
const PURGE_BATCH = 20;

/**
 * Deletes a purged account's chats, and its access to other people's, a batch at a time.
 * Returns whether everything is gone; the cleanup runs again until it is.
 */
export async function purgeAccountChats(ctx: MutationCtx, userId: Id<"users">) {
  const owned = await ctx.db.query("assistantThreads").withIndex("by_owner", (q) => q.eq("ownerId", userId)).take(PURGE_BATCH);
  for (const thread of owned) await deleteThread(ctx, thread);
  const shared = await ctx.db
    .query("assistantThreadAccess")
    .withIndex("by_principal_and_lastMessageAt", (q) => q.eq("principal", userPrincipal(userId)))
    .take(PURGE_BATCH);
  for (const row of shared) await ctx.db.delete("assistantThreadAccess", row._id);
  return owned.length < PURGE_BATCH && shared.length < PURGE_BATCH;
}
