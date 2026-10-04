/**
 * The assistant's chats (#324). A chat belongs to one person, who can let other people
 * and organizations in. Its messages live in the agent component, under `agentThreadId`.
 */
import { v } from "convex/values";
import { effortValidator } from "../aiModelConfig/validators";
import { capped } from "../lib/listCaps";
import { MAX_ASSISTANT_THREAD_VIEWERS } from "../lib/queryBounds";

/** What someone may do in a chat: the owner also shares, renames and deletes it; `write` sends messages; `read` only reads. */
export const assistantRoleValidator = v.union(v.literal("owner"), v.literal("write"), v.literal("read"));
/** The roles an owner hands out. */
export const assistantGrantRoleValidator = v.union(v.literal("write"), v.literal("read"));

/** The reply a chat is writing. It writes one at a time, so this is also the chat's lock. */
export const assistantReplyValidator = v.object({
  /** Names this run of the reply, so a late write from an earlier run changes nothing. */
  attemptId: v.string(),
  /** Who sent the message it answers. It runs with their access, on their credits. */
  senderId: v.id("users"),
  /** The exchange it belongs to: the agent component's order of the message it answers. */
  order: v.number(),
  startedAt: v.number(),
  /** The scheduled action writing it. The reply is being written while that waits to run or runs. */
  scheduledId: v.id("_scheduled_functions"),
  /** Set when someone stops it. */
  stop: v.optional(v.boolean()),
});

export const assistantThreadFields = {
  ownerId: v.id("users"),
  title: v.string(),
  agentThreadId: v.string(),
  /** When its newest message was sent; a chat with none yet has when it was made. */
  lastMessageAt: v.number(),
  /** The start of its newest message, for the list of chats. */
  preview: v.optional(v.string()),
  /** The model its replies run on; a chat with none runs the server's default. */
  modelId: v.optional(v.id("models")),
  /** The reasoning effort its replies run at, when the model takes one. */
  effort: v.optional(effortValidator),
  reply: v.optional(assistantReplyValidator),
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

/** People a chat's row in the list of chats names. */
export const ASSISTANT_MEMBERS_SHOWN = 3;
/** The first few people in a chat besides the reader, with whether each has it open now. */
export const assistantMembersValidator = capped(v.array(v.object({ userId: v.id("users"), name: v.string(), here: v.boolean() })), ASSISTANT_MEMBERS_SHOWN);

/** The people in a chat's room (./presence.ts). */
export const assistantViewersValidator = capped(v.array(v.object({ userId: v.string(), online: v.boolean(), lastDisconnected: v.number() })), MAX_ASSISTANT_THREAD_VIEWERS);

/** People and organizations the share sheet suggests at once. */
export const ASSISTANT_CANDIDATES_SHOWN = 8;
/** Who a chat's owner could share it with: their organizations, then the people in them. */
export const assistantCandidatesValidator = capped(
  v.array(v.object({ principal: assistantPrincipalValidator, name: v.string(), email: v.optional(v.string()) })),
  ASSISTANT_CANDIDATES_SHOWN,
);
