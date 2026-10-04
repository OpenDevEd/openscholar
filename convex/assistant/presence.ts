/**
 * Who has an assistant chat open (#324). The panel sends a heartbeat while a chat is open
 * in it, and the chat's room holds the people there. A room names people only, never the
 * page they're on.
 */
import { Presence } from "@convex-dev/presence";
import { v } from "convex/values";
import { components } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { requireFeature } from "../featureFlags/guard";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { mutation, query } from "../lib/functions";
import { MAX_ASSISTANT_THREAD_VIEWERS } from "../lib/queryBounds";
import { requireThread } from "./access";
import { assistantViewersValidator } from "./validators";

const presence = new Presence<Id<"assistantThreads">, Id<"users">>(components.presence);

/** How often a browser may say it's still there. The room drops someone 2.5 intervals after their last heartbeat. */
const [INTERVAL_MIN_MS, INTERVAL_MAX_MS] = [5_000, 60_000];

export const heartbeat = mutation({
  // The shape `usePresence` sends. The user ID it carries is ignored: the session's own is the one that counts.
  args: { roomId: v.string(), userId: v.string(), sessionId: v.string(), interval: v.number() },
  returns: v.object({ roomToken: v.string(), sessionToken: v.string() }),
  handler: async (ctx, { roomId, sessionId, interval }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, "assistant.enabled", userId);
    const threadId = ctx.db.normalizeId("assistantThreads", roomId);
    if (!threadId) throw createError("NOT_FOUND", "Chat not found");
    await requireThread(ctx, userId, threadId);
    return await presence.heartbeat(ctx, threadId, userId, sessionId, Math.min(Math.max(interval, INTERVAL_MIN_MS), INTERVAL_MAX_MS));
  },
});

/** The people in a room, for the browser that holds its token: `heartbeat` hands that out to people who can open the chat. */
export const list = query({
  args: { roomToken: v.string() },
  returns: assistantViewersValidator,
  handler: async (ctx, { roomToken }) =>
    (await presence.list(ctx, roomToken, MAX_ASSISTANT_THREAD_VIEWERS)).map(({ userId, online, lastDisconnected }) => ({ userId, online, lastDisconnected })),
});

/** A closing tab leaves its room. It arrives over plain HTTP, without a session, so the session token is its proof. */
export const disconnect = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => await presence.disconnect(ctx, sessionToken),
});

/** The people who have the chat open now. */
export async function viewers(ctx: QueryCtx, threadId: Id<"assistantThreads">): Promise<Set<Id<"users">>> {
  return new Set((await presence.listRoom(ctx, threadId, true, MAX_ASSISTANT_THREAD_VIEWERS)).map((viewer) => viewer.userId));
}
