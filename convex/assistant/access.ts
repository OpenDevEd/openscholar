/**
 * Who can open an assistant chat (#324). Anyone who can act in its workspace can (#650),
 * and so can the principals its access rows name: the owner of a chat in their own
 * workspace, the people it is shared with, and the organizations whose every member it is
 * shared with. Nothing here is a Convex function, so queries and mutations can import it.
 */
import type { Infer } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { MAX_ASSISTANT_THREAD_GRANTS } from "../lib/queryBounds";
import { readMemberOrganizations } from "../organizationFeatures";
import { actorIn, personalWorkspaceOf, type InWorkspace } from "../workspaces/actor";
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
 * The most this person may do in the chat, or null when they can't open it: through its
 * access rows, and as someone who can act in its workspace, where a chat is its maker's
 * and its admins' to rename, share and delete, and every member's to write in.
 */
export async function roleIn(ctx: QueryCtx | MutationCtx, user: Doc<"users">, thread: Doc<"assistantThreads">): Promise<AssistantRole | null> {
  const granted = await roleAmong(ctx, thread._id, await principalsOf(ctx, user));
  if (granted === "owner") return granted;
  const actor = await actorIn(ctx, user, thread.workspaceId);
  const member: AssistantRole | null = !actor ? null : actor.role === "admin" || thread.createdBy === user._id ? "owner" : "write";
  return granted && member ? best([granted, member]) : (granted ?? member);
}

/**
 * The chat and what this person may do in it. A chat that doesn't exist and one that isn't
 * shared with them fail the same way, so its ID tells a stranger nothing.
 */
export async function requireThread(ctx: QueryCtx | MutationCtx, userId: Id<"users">, threadId: Id<"assistantThreads">, atLeast: AssistantRole = "read") {
  const [thread, user] = await Promise.all([ctx.db.get("assistantThreads", threadId), ctx.db.get("users", userId)]);
  const role = thread && user ? await roleIn(ctx, user, thread) : null;
  if (!thread || !role) throw createError("NOT_FOUND", "Chat not found");
  if (RANK[role] < RANK[atLeast]) {
    throw createError("FORBIDDEN", atLeast === "owner" ? "Only the chat's owner can do this." : "You can read this chat, but not write in it.");
  }
  return { thread, role };
}

/**
 * The workspace a person's replies in a chat act in, and spend in: the chat's, for anyone
 * who can act there, and otherwise their own, so what someone a chat is shared with runs
 * in it is theirs (#650).
 */
export async function replyWorkspace(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, thread: Doc<"assistantThreads">): Promise<Id<"workspaces">> {
  const user = await ctx.db.get("users", userId);
  return user && (await actorIn(ctx, user, thread.workspaceId)) ? thread.workspaceId : await personalWorkspaceOf(ctx, userId);
}

/**
 * `requireThread`, for a registered action run in a page's workspace or by a reply: the chat
 * must be one it acts on there (#650), which is the chat's own workspace for its members, and
 * the person's own for someone it's shared with. Any other fails as not found.
 */
export async function requireThreadIn(ctx: QueryCtx | MutationCtx, { userId, workspaceId }: InWorkspace, threadId: Id<"assistantThreads">, atLeast: AssistantRole = "read") {
  const found = await requireThread(ctx, userId, threadId, atLeast);
  if ((await replyWorkspace(ctx, userId, found.thread)) !== workspaceId) throw createError("NOT_FOUND", "Chat not found");
  return found;
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
  await ctx.scheduler.runAfter(0, internal.assistant.presence.forgetRoom, { threadId: thread._id });
  await ctx.scheduler.runAfter(0, internal.assistant.steps.forget, { threadId: thread._id });
  await ctx.scheduler.runAfter(0, internal.assistant.files.forget, { threadId: thread._id });
  await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, { threadId: thread.agentThreadId });
}

/** Chats one cleanup run deletes for a purged account; each takes its access rows with it. */
const PURGE_BATCH = 20;

/**
 * Deletes the chats in a purged account's own workspace, and its access to other people's, a
 * batch at a time. Chats it made in an organization stay the organization's (#650). Returns
 * whether everything is gone; the cleanup runs again until it is.
 */
export async function purgeAccountChats(ctx: MutationCtx, userId: Id<"users">) {
  const workspace = await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", userId)).unique();
  const ownGone = workspace ? await purgeWorkspaceChats(ctx, workspace._id) : true;
  const shared = await ctx.db
    .query("assistantThreadAccess")
    .withIndex("by_principal_and_lastMessageAt", (q) => q.eq("principal", userPrincipal(userId)))
    .take(PURGE_BATCH);
  for (const row of shared) await ctx.db.delete("assistantThreadAccess", row._id);
  return ownGone && shared.length < PURGE_BATCH;
}

/** Deletes a batch of a workspace's chats, for everyone; whether none are left. */
export async function purgeWorkspaceChats(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const chats = await ctx.db.query("assistantThreads").withIndex("by_workspace_and_lastMessageAt", (q) => q.eq("workspaceId", workspaceId)).take(PURGE_BATCH);
  for (const thread of chats) await deleteThread(ctx, thread);
  return chats.length < PURGE_BATCH;
}
