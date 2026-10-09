/**
 * Who else has an item open (#657): a room per item in its workspace, kept as a chat's is
 * (../assistant/presence.ts). The page sends a heartbeat while the item is open, and the item's
 * first row lists the others in its room. Only people who can open the item join or read it, and
 * a room names people only, never what they're looking at inside the item.
 */
import { Presence } from "@convex-dev/presence";
import { v } from "convex/values";
import { components } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { mutation } from "../lib/functions";
import { personName } from "../lib/people";
import { workspaceMutation, workspaceQuery } from "../lib/userActions";
import { itemIn } from "../activity/queries";
import { itemKey, itemKindValidator, type ItemKind } from "../activity/validators";
import { PRESENCE_HEARTBEAT_MS } from "../../lib/assistant/presence";

const presence = new Presence<string, Id<"users">>(components.presence);

/** An item's room: its workspace and its key, apart from chats' rooms, which are their IDs. */
const roomOf = (workspaceId: Id<"workspaces">, kind: ItemKind, id: string) => `${workspaceId}|${itemKey(kind, id)}`;

/** The others in a room one read names; the row shows a few and counts the rest. */
const HERE_READ = 8;

const itemArgs = { kind: itemKindValidator, id: v.string() };

/** Puts the person in the item's room, or keeps them there. Returns what `leave` takes. */
export const heartbeat = workspaceMutation({
  args: { ...itemArgs, sessionId: v.string() },
  returns: v.string(),
  handler: async (ctx, { userId, workspaceId }, { kind, id, sessionId }) => {
    if (!(await itemIn(ctx, workspaceId, kind, id))) throw createError("NOT_FOUND", "That item isn't in this workspace.");
    return (await presence.heartbeat(ctx, roomOf(workspaceId, kind, id), userId, sessionId, PRESENCE_HEARTBEAT_MS)).sessionToken;
  },
});

/** Leaves the room at once, when the item's page closes. The token only ever ends the session it was handed out for. */
export const leave = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => await presence.disconnect(ctx, sessionToken),
});

/** The others who have the item open now, first few first; none for an item outside the workspace. */
export const here = workspaceQuery({
  args: itemArgs,
  returns: v.array(v.object({ userId: v.id("users"), name: v.string(), imageUrl: v.optional(v.string()) })),
  handler: async (ctx, { userId, workspaceId }, { kind, id }) => {
    if (!(await itemIn(ctx, workspaceId, kind, id))) return [];
    const people = await presence.listRoom(ctx, roomOf(workspaceId, kind, id), true, HERE_READ + 1);
    const others = people.filter((person) => person.userId !== userId).slice(0, HERE_READ);
    const users = await Promise.all(others.map((person) => ctx.db.get("users", person.userId)));
    return users.flatMap((user) => (user ? [{ userId: user._id, name: personName(user) || user.email, ...(user.avatarUrl ? { imageUrl: user.avatarUrl } : {}) }] : []));
  },
});
