/**
 * The assistant's chats (#324). A chat belongs to one person, who can let other people
 * and organizations in. Its messages live in the agent component, under `agentThreadId`.
 */
import { v } from "convex/values";
import { effortValidator } from "../aiModelConfig/validators";
import { capped } from "../lib/listCaps";
import { MENTION_KINDS } from "../../lib/assistant/mentions";

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
  /** The reply is written, and the conversation so far is being summarized before the chat takes its next message (./context.ts). */
  compacting: v.optional(v.boolean()),
  /** What its requests so far have cost, and the credits it pauses at when its sender set a limit (./spending.ts). */
  spent: v.optional(v.number()),
  cap: v.optional(v.number()),
});

/** Why a reply paused: it reached the credits its sender lets a reply spend, or the requests a reply makes before it asks. */
export const assistantPausedValidator = v.union(v.literal("credits"), v.literal("requests"));

/** A reply's changes so far, by what they change: one entry for each kind of record the panel has a tile for (lib/assistant/actions.ts `Kind`), which are seven. */
export const assistantChangesValidator = capped(v.optional(v.record(v.string(), v.number())), 20);
/** Requests whose digests a reply carries along, to tell when it is going round in circles (./tools.ts). */
export const RECENT_REQUESTS = 6;

/**
 * A reply that asked the person before running an action, and waits for their answer
 * (./steps.ts), or one that paused at a limit and waits to be carried on (./spending.ts).
 * Nothing runs meanwhile, so no reply holds the chat; the chat takes no message until the
 * reply is answered, carried on or stopped. What the reply needs to carry on is kept here:
 * who it runs for, the message it answers, its model, and what it has used of one reply's
 * credits, rounds and calls, which carrying on doesn't start over.
 */
export const assistantAskingValidator = v.object({
  senderId: v.id("users"),
  order: v.number(),
  promptMessageId: v.string(),
  modelId: v.union(v.id("models"), v.null()),
  effort: v.optional(effortValidator),
  spent: v.number(),
  rounds: v.number(),
  made: v.number(),
  /** How many of its requests in a row, up to the one that asked, had every action fail, and the digests of what its last few did (./tools.ts). */
  failed: v.optional(v.number()),
  recent: capped(v.optional(v.array(v.string())), RECENT_REQUESTS),
  /** How many changes it has called for unasked, by what they change, for telling a bulk change (./tools.ts `kindOf`). */
  changes: assistantChangesValidator,
  /** The credits it pauses at, when its sender set a limit, and the requests it pauses at. */
  cap: v.optional(v.number()),
  lap: v.optional(v.number()),
  /** Set on a reply that paused at one of them. It asked about no action: carrying it on is the answer. */
  paused: v.optional(assistantPausedValidator),
  askedAt: v.number(),
});

/** What a person lets jobs that spend credits hold without asking. */
export const assistantAllowanceValidator = v.object({ cap: v.optional(v.number()) });

/** Replies whose cost a person's record keeps, for the Spending sheet's chart. */
export const RECENT_REPLIES = 12;

/** What a person lets the assistant spend in one chat (#346). People in a shared chat each set their own, and spend their own credits. */
export const assistantLimitFields = {
  threadId: v.id("assistantThreads"),
  userId: v.id("users"),
  /** Credits a reply may spend before it pauses and asks. With none, a reply has no limit. */
  replyLimit: v.optional(v.number()),
  /** Set while jobs that spend credits run in this chat without asking (#328): the most one may hold, or any amount with no `cap`. */
  jobs: v.optional(assistantAllowanceValidator),
};

/** A person's own record with the assistant: what the chats they start take, and what their last replies cost. */
export const assistantSpenderFields = {
  userId: v.id("users"),
  /** Set while "Use these for my new chats" is on: the limits a chat they start begins with. */
  newChats: v.optional(v.object({ replyLimit: v.optional(v.number()), jobs: v.optional(assistantAllowanceValidator) })),
  /**
   * What their last replies cost in credits, oldest first. Each is under its reply's name, so a
   * charge settled after the reply ended (convex/chat/billing.ts) is added to the right one.
   */
  recent: capped(v.array(v.object({ reply: v.string(), credits: v.number() })), RECENT_REPLIES),
};
/** What a person's last replies cost, oldest first, as the Spending sheet reads them. */
export const recentCostsValidator = capped(v.array(v.number()), RECENT_REPLIES);

/** Undone changes a chat keeps to tell the model of: the latest. A bulk change is one of them, however many it made. */
export const UNDONE_TOLD = 20;
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
  asking: v.optional(assistantAskingValidator),
  /** What the model reads in place of the messages through `compactedThrough` (./context.ts). The chat itself keeps them all. */
  summary: v.optional(v.string()),
  /** The last exchange the summary covers, by the agent component's order. */
  compactedThrough: v.optional(v.number()),
  /** A compaction was due and didn't finish, so the next reply writes the summary before it answers. */
  compactionOwed: v.optional(v.boolean()),
  /**
   * The page the newest message that named one was sent from (lib/assistant/view.ts), who
   * sent it, and which exchange it was. The same person's next message from the same page
   * doesn't say it again while the model still reads that one.
   */
  view: v.optional(v.object({ address: v.optional(v.string()), day: v.optional(v.string()), userId: v.id("users"), order: v.number() })),
  /**
   * Changes of the assistant's that people took back with Undo and the model hasn't been told
   * of: whose it was, and which step. A person's next message tells the model of theirs (the
   * changes were to their own records): it only knows what its own calls came to, and made an
   * undone change again when it found it gone. `undoneMore` counts those that no longer fit,
   * for each person whose they were.
   */
  undone: capped(v.optional(v.array(v.object({ userId: v.id("users"), stepId: v.id("assistantSteps") }))), UNDONE_TOLD),
  undoneMore: capped(v.optional(v.array(v.object({ userId: v.id("users"), count: v.number() }))), UNDONE_TOLD),
  createdAt: v.number(),
  updatedAt: v.number(),
};

/** One action the assistant ran in a reply (./steps.ts). */
export const assistantStepFields = {
  threadId: v.id("assistantThreads"),
  /** The exchange it belongs to: the agent component's order of the message being answered. */
  order: v.number(),
  /** Who it ran as: the person whose message was being answered. Only they can undo it. */
  userId: v.id("users"),
  /** The model's ID for the call. Models reuse these, so nothing is looked up by it. */
  toolCallId: v.string(),
  /**
   * On a step that asked first: the tool the model called, and the message its reply
   * answers. Its outcome is written to the model as that call's result, whoever ends it.
   */
  tool: v.optional(v.string()),
  prompt: v.optional(v.string()),
  /** The action it ran, by its path in the registry. */
  path: v.string(),
  /** The action's arguments, as JSON. */
  input: v.string(),
  /** What it was about, for its card: a title, a name or a query from its arguments. */
  subject: v.optional(v.string()),
  /** How many things its result lists, when it lists any. */
  count: v.optional(v.number()),
  /** On a call that spends credits: the most it holds (#328), which the person is shown when they're asked. */
  credits: v.optional(v.number()),
  /** On a step that asked first, for an action that says what to show of its arguments: that, as JSON, which the person is asked about in their place. */
  shown: v.optional(v.string()),
  /**
   * On a bulk change (./bulk.ts): how many changes it is. One step for all of them, however
   * many: `count` is how many were made, and what reverses each is kept beside the step
   * (`assistantStepUndos`). `input` is what the tool was given, for the reply to run it from
   * once the person allows it.
   */
  batch: v.optional(v.number()),
  /** Which of its several jobs its action does (lib/assistant/actions.ts), where its arguments don't say it one by one: a bulk change. */
  variant: v.optional(v.string()),
  /** Set while a bulk change's undo is putting its changes back (./bulk.ts): what would undo it is the reversal's to read until it's done. */
  reverting: v.optional(v.boolean()),
  /**
   * `asking`: the person is asked before it runs. `allowed`: they said yes, and the reply
   * runs it as it carries on. `declined`: they said no, or stopped the reply.
   */
  status: v.union(v.literal("running"), v.literal("done"), v.literal("failed"), v.literal("asking"), v.literal("allowed"), v.literal("declined")),
  /** Why it failed, as the model was told. */
  error: v.optional(v.string()),
  /** What reverses it: the action to run, and its arguments as JSON. */
  undo: v.optional(v.object({ path: v.string(), args: v.string() })),
  /** Set once its undo has run. */
  undone: v.optional(v.boolean()),
  startedAt: v.number(),
  endedAt: v.optional(v.number()),
};
/** Arguments of a call the assistant asks about that the person asked is shown (./details.ts). */
export const ASKED_DETAILS_MAX = 12;
export const askedDetailsValidator = capped(v.optional(v.array(v.object({ name: v.string(), value: v.string() }))), ASKED_DETAILS_MAX);
/** Of the changes a bulk change makes, how many the person asked is shown, and how much of each (./details.ts). */
export const ASKED_EACH_MAX = 5;
export const ASKED_EACH_DETAILS_MAX = 3;
export const askedEachValidator = capped(v.optional(v.array(capped(v.array(v.object({ name: v.string(), value: v.string() })), ASKED_EACH_DETAILS_MAX))), ASKED_EACH_MAX);
/** What reverses one change of a bulk change: the action to run, and its arguments as JSON. A row each, so undoing a thousand reads a few at a time. A change with no undo has a row with no action. */
export const assistantStepUndoFields = { threadId: v.id("assistantThreads"), stepId: v.id("assistantSteps"), path: v.string(), args: v.string() };
/** What a step's action returned, as JSON: kept apart from the step, so listing steps reads none of it. */
export const assistantStepResultFields = { threadId: v.id("assistantThreads"), stepId: v.id("assistantSteps"), result: v.string() };

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
/** The first few people in a chat besides the reader, those who have it open now first. */
export const assistantMembersValidator = capped(v.array(v.object({ userId: v.id("users"), name: v.string(), here: v.boolean() })), ASSISTANT_MEMBERS_SHOWN);

/** Someone a chat's owner could share it with: one of their organizations, or a person in one. */
export const assistantCandidateValidator = v.object({ principal: assistantPrincipalValidator, name: v.string(), email: v.optional(v.string()) });

/** Records of each kind @ finds at once (./mentions.ts); the picker shows six. */
export const MENTIONS_EACH = 4;
/** What @ in the composer can point at: the ID its own tools take, and a search's results or a collection's papers. */
export const mentionablesValidator = capped(
  v.array(v.object({ kind: v.union(...MENTION_KINDS.map((kind) => v.literal(kind))), id: v.string(), label: v.string(), count: v.optional(v.number()) })),
  MENTIONS_EACH * MENTION_KINDS.length,
);
