/**
 * Who can open an assistant chat (#324). Anyone who can act in its workspace can (#650): it's its
 * maker's and its admins' to rename, share and delete, and every member's to write in. So can
 * the people it's shared with, who are its guests as any shared item's are (#653,
 * ../sharing): one who views reads it, and one who edits writes in it too. A chat is shared
 * with people, never with a whole organization. Nothing here is a Convex function, so queries
 * and mutations can import it.
 */
import type { Infer } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { MAX_ASSISTANT_THREAD_GRANTS } from "../lib/queryBounds";
import { grantOf, open } from "../sharing/items";
import { actorIn, personalWorkspaceOf, type InWorkspace } from "../workspaces/actor";
import type { assistantRoleValidator } from "./validators";

export type AssistantRole = Infer<typeof assistantRoleValidator>;

const RANK: Record<AssistantRole, number> = { read: 1, write: 2, owner: 3 };

/** A chat's guests: the people it's shared with, up to MAX_ASSISTANT_THREAD_GRANTS, which its workspace's plan keeps them within. */
export function guestsOf(ctx: QueryCtx | MutationCtx, threadId: Id<"assistantThreads">) {
  return ctx.db.query("itemAccess").withIndex("by_item_and_grantedAt", (q) => q.eq("item", threadId)).take(MAX_ASSISTANT_THREAD_GRANTS);
}

/**
 * The most this person may do in the chat, or null when they can't open it: as someone who can
 * act in its workspace, where a chat is its maker's and its admins' to rename, share and delete,
 * and every member's to write in; or as its guest, who reads it, and writes in it when it was
 * shared with them to edit.
 */
export async function roleIn(ctx: QueryCtx | MutationCtx, user: Doc<"users">, thread: Doc<"assistantThreads">): Promise<AssistantRole | null> {
  const actor = await actorIn(ctx, user, thread.workspaceId);
  if (actor) return actor.role === "admin" || thread.createdBy === user._id ? "owner" : "write";
  const grant = await grantOf(ctx, thread._id, user._id);
  return grant && (await open(ctx, thread.workspaceId)) ? (grant.role === "editor" ? "write" : "read") : null;
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

/** Moves the chat to the top of every list it shows in: its own row and each guest's place take the new time. */
export async function touchThread(ctx: MutationCtx, threadId: Id<"assistantThreads">, at: number) {
  await ctx.db.patch("assistantThreads", threadId, { lastMessageAt: at, updatedAt: at });
  for (const guest of await guestsOf(ctx, threadId)) await ctx.db.patch("itemAccess", guest._id, { lastMessageAt: at });
}

/** Deletes the chat for everyone: its record, the room of people who had it open, and its messages, which the agent component deletes a page at a time. Its guests' places go with it (../sharing/items.ts `followShared`). */
export async function deleteThread(ctx: MutationCtx, thread: Doc<"assistantThreads">) {
  await ctx.db.delete("assistantThreads", thread._id);
  await ctx.scheduler.runAfter(0, internal.presence.forgetChatRoom, { threadId: thread._id });
  await ctx.scheduler.runAfter(0, internal.assistant.steps.forget, { threadId: thread._id });
  await ctx.scheduler.runAfter(0, internal.assistant.files.forget, { threadId: thread._id });
  await ctx.scheduler.runAfter(0, internal.lib.paperPdfs.forget, { scope: `chat:${thread._id}` });
  await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, { threadId: thread.agentThreadId });
}

/** Chats one cleanup run deletes for a purged account. */
const PURGE_BATCH = 20;

/**
 * Deletes the chats in a purged account's own workspace, a batch at a time. Chats it made in an
 * organization stay the organization's (#650), and its places as a guest of other people's go
 * with every other item's (../sharing/upkeep.ts). Returns whether everything is gone; the
 * cleanup runs again until it is.
 */
export async function purgeAccountChats(ctx: MutationCtx, userId: Id<"users">) {
  const workspace = await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", userId)).unique();
  return workspace ? await purgeWorkspaceChats(ctx, workspace._id) : true;
}

/** Deletes a batch of a workspace's chats, for everyone; whether none are left. */
export async function purgeWorkspaceChats(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const chats = await ctx.db.query("assistantThreads").withIndex("by_workspace_and_lastMessageAt", (q) => q.eq("workspaceId", workspaceId)).take(PURGE_BATCH);
  for (const thread of chats) await deleteThread(ctx, thread);
  return chats.length < PURGE_BATCH;
}
