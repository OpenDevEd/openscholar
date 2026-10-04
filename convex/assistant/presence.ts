/**
 * Who has an assistant chat open (#324). The panel sends a heartbeat while a chat is open
 * in it, and the chat's room holds the people there. A room names people only, never the
 * page they're on. Who is in a room is read through the list of chats (./threads.ts),
 * which checks the reader can open the chat each time it runs.
 */
import { Presence } from "@convex-dev/presence";
import { v } from "convex/values";
import { components } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { requireFeature } from "../featureFlags/guard";
import { requireAuth } from "../lib/auth";
import { mutation } from "../lib/functions";
import { PRESENCE_HEARTBEAT_MS } from "../../lib/assistant/presence";
import { requireThread } from "./access";

const presence = new Presence<Id<"assistantThreads">, Id<"users">>(components.presence);

/** Puts the session's own user in the chat's room, or keeps them there. Returns what `leave` takes. */
export const heartbeat = mutation({
  args: { threadId: v.id("assistantThreads"), sessionId: v.string() },
  returns: v.string(),
  handler: async (ctx, { threadId, sessionId }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, "assistant.enabled", userId);
    await requireThread(ctx, userId, threadId);
    return (await presence.heartbeat(ctx, threadId, userId, sessionId, PRESENCE_HEARTBEAT_MS)).sessionToken;
  },
});

/** Leaves the room at once, when the panel closes the chat. The token only ever ends the session it was handed out for. */
export const leave = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => await presence.disconnect(ctx, sessionToken),
});

/** The first `limit` people who have the chat open now. */
export async function viewers(ctx: QueryCtx, threadId: Id<"assistantThreads">, limit: number): Promise<Id<"users">[]> {
  return (await presence.listRoom(ctx, threadId, true, limit)).map((viewer) => viewer.userId);
}
