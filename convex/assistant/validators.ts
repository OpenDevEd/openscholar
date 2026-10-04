/**
 * The assistant's chats (#324). A chat belongs to one person, who can let other people
 * and organizations in. Its messages live in the agent component, under `agentThreadId`.
 */
import { v } from "convex/values";

/** What someone may do in a chat: the owner also shares, renames and deletes it; `write` sends messages; `read` only reads. */
export const assistantRoleValidator = v.union(v.literal("owner"), v.literal("write"), v.literal("read"));
/** The roles an owner hands out. */
export const assistantGrantRoleValidator = v.union(v.literal("write"), v.literal("read"));

export const assistantThreadFields = {
  ownerId: v.id("users"),
  title: v.string(),
  agentThreadId: v.string(),
  /** When its newest message was sent; a chat with none yet has when it was made. */
  lastMessageAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const assistantThreadAccessFields = {
  threadId: v.id("assistantThreads"),
  /**
   * Who this row lets in: `user:<id>` or `organization:<id>` (./access.ts). A chat has one
   * row per principal, its owner's included, so each person's chats list through one index.
   */
  principal: v.string(),
  role: assistantRoleValidator,
  /** The chat's `lastMessageAt`, copied on every message, which is what the lists order by. */
  lastMessageAt: v.number(),
  createdAt: v.number(),
};

/** Who a chat is shared with, as its owner names them. */
export const assistantPrincipalValidator = v.union(
  v.object({ kind: v.literal("user"), userId: v.id("users") }),
  v.object({ kind: v.literal("organization"), organizationId: v.id("organizations") }),
);
