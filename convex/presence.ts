/**
 * Who has an item open (#324, #657): a room per item, which the page or panel with it open keeps
 * the person in with a heartbeat. A chat's room is its ID; any other item's is its workspace and
 * its Activity key. Only people who can open an item join its room or read who's in it, and a room
 * names people only, never what they're looking at inside the item. Who is in a chat's room is read
 * through the list of chats (./assistant/threads.ts), which checks the reader can open the chat.
 */
import { Presence } from "@convex-dev/presence";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { requireFeature } from "./featureFlags/guard";
import { requireAuth } from "./lib/auth";
import { createError } from "./lib/errors";
import { internalMutation, mutation } from "./lib/functions";
import { personName } from "./lib/people";
import { workspaceMutation, workspaceQuery } from "./lib/userActions";
import { itemIn } from "./activity/queries";
import { itemKey, itemKindValidator, type ItemKind } from "./activity/validators";
import { requireThread } from "./assistant/access";
import { PRESENCE_HEARTBEAT_MS } from "../lib/assistant/presence";

const presence = new Presence<string, Id<"users">>(components.presence);

/** An item's room: its workspace and its key, apart from chats' rooms, which are their IDs. */
const roomOf = (workspaceId: Id<"workspaces">, kind: ItemKind, id: string) => `${workspaceId}|${itemKey(kind, id)}`;

/** The others in an item's room one read names; its row shows a few and the tooltip the rest. */
const HERE_READ = 8;

const itemArgs = { kind: itemKindValidator, id: v.string() };

/** Whether the person can open an item of this kind at all: extractions sit behind their feature, as their pages do. */
async function opens(ctx: QueryCtx, userId: Id<"users">, kind: ItemKind) {
  if (kind !== "extraction") return true;
  try {
    await requireFeature(ctx, "extraction.enabled", userId);
    return true;
  } catch {
    return false;
  }
}

/** Puts the person in an item's room, or keeps them there. Returns what `leave` takes. */
export const heartbeat = workspaceMutation({
  args: { ...itemArgs, sessionId: v.string() },
  returns: v.string(),
  handler: async (ctx, { userId, workspaceId }, { kind, id, sessionId }) => {
    if (!(await opens(ctx, userId, kind)) || !(await itemIn(ctx, workspaceId, kind, id))) throw createError("NOT_FOUND", "That item isn't in this workspace.");
    return (await presence.heartbeat(ctx, roomOf(workspaceId, kind, id), userId, sessionId, PRESENCE_HEARTBEAT_MS)).sessionToken;
  },
});

/** Puts the session's own user in a chat's room, or keeps them there. Returns what `leave` takes. */
export const chatHeartbeat = mutation({
  args: { threadId: v.id("assistantThreads"), sessionId: v.string() },
  returns: v.string(),
  handler: async (ctx, { threadId, sessionId }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, "assistant.enabled", userId);
    await requireThread(ctx, userId, threadId);
    return (await presence.heartbeat(ctx, threadId, userId, sessionId, PRESENCE_HEARTBEAT_MS)).sessionToken;
  },
});

/** Leaves a room at once, when the page or panel closes the item. The token only ever ends the session it was handed out for. */
export const leave = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => await presence.disconnect(ctx, sessionToken),
});

/** The others who have an item open now, first few first; none for an item the person can't open. */
export const here = workspaceQuery({
  args: itemArgs,
  returns: v.array(v.object({ userId: v.id("users"), name: v.string(), imageUrl: v.optional(v.string()) })),
  handler: async (ctx, { userId, workspaceId }, { kind, id }) => {
    if (!(await opens(ctx, userId, kind)) || !(await itemIn(ctx, workspaceId, kind, id))) return [];
    const people = await presence.listRoom(ctx, roomOf(workspaceId, kind, id), true, HERE_READ + 1);
    const others = people.filter((person) => person.userId !== userId).slice(0, HERE_READ);
    const users = await Promise.all(others.map((person) => ctx.db.get("users", person.userId)));
    return users.flatMap((user) => (user ? [{ userId: user._id, name: personName(user) || user.email, ...(user.avatarUrl ? { imageUrl: user.avatarUrl } : {}) }] : []));
  },
});

/** People one run of `forgetChatRoom` takes out of a deleted chat's room. */
const FORGET_BATCH = 50;

/**
 * Empties a deleted chat's room, a batch of people at a time, then drops the room. It runs on its
 * own, after the chat is gone, so a crowded room can't hold the deletion back.
 */
export const forgetChatRoom = internalMutation({
  args: { threadId: v.id("assistantThreads") },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const people = await presence.listRoom(ctx, threadId, false, FORGET_BATCH);
    for (const person of people) await presence.removeRoomUser(ctx, threadId, person.userId);
    if (people.length === FORGET_BATCH) await ctx.scheduler.runAfter(0, internal.presence.forgetChatRoom, { threadId });
    else await presence.removeRoom(ctx, threadId);
    return null;
  },
});

/** The first `limit` people who have a chat open now. */
export async function chatViewers(ctx: QueryCtx, threadId: Id<"assistantThreads">, limit: number): Promise<Id<"users">[]> {
  return (await presence.listRoom(ctx, threadId, true, limit)).map((viewer) => viewer.userId);
}
