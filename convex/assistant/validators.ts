/**
 * The assistant's chats (#324). A chat belongs to one person, who can let other people
 * and organizations in. Its messages live in the agent component, under `agentThreadId`.
 */
import { v } from "convex/values";
import { effortValidator } from "../aiModelConfig/validators";
import { capped } from "../lib/listCaps";
import { MAX_QUESTIONS_PER_JOB } from "../extraction/validators";
import { MAX_FILES_PER_MESSAGE, MAX_PDF_CHUNKS } from "../../lib/assistant/files";
import { MENTION_KINDS } from "../../lib/assistant/mentions";

/** What someone may do in a chat: the owner also shares, renames and deletes it; `write` sends messages; `read` only reads. */
export const assistantRoleValidator = v.union(v.literal("owner"), v.literal("write"), v.literal("read"));
/** The reply a chat is writing. It writes one at a time, so this is also the chat's lock. */
export const assistantReplyValidator = v.object({
  /** Names this run of the reply, so a late write from an earlier run changes nothing. */
  attemptId: v.string(),
  /** Who sent the message it answers. It runs with their access, on their credits. */
  senderId: v.id("users"),
  /** The workspace it acts in (./access.ts `replyWorkspace`), whose replies at once it counts against. */
  workspaceId: v.id("workspaces"),
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
  /** The workspace the reply acts in, which it carries on in (#650). */
  workspaceId: v.id("workspaces"),
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
  /** Its papers' PDFs are downloaded to be sent, since a request sending one by its address failed (./run.ts). */
  download: v.optional(v.literal(true)),
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
  /** Set while the assistant searches the web, or reads attached files, in this chat without asking (#648). */
  web: v.optional(v.literal(true)),
  files: v.optional(v.literal(true)),
};

/** A person's own record with the assistant in a workspace: what the chats they start there take, and what their last replies there cost. */
export const assistantSpenderFields = {
  userId: v.id("users"),
  /** The workspace it's their record in (#650). */
  workspaceId: v.id("workspaces"),
  /** Set while "Use these for my new chats" is on: the limits a chat they start begins with. */
  newChats: v.optional(v.object({ replyLimit: v.optional(v.number()), jobs: v.optional(assistantAllowanceValidator) })),
  /**
   * What their last replies cost in credits, oldest first. Each is under its reply's name, so a
   * charge settled after the reply ended (convex/billing/openRouter.ts) is added to the right one.
   */
  recent: capped(v.array(v.object({ reply: v.string(), credits: v.number() })), RECENT_REPLIES),
};
/** What a person's last replies cost, oldest first, as the Spending sheet reads them. */
export const recentCostsValidator = capped(v.array(v.number()), RECENT_REPLIES);

/** Undone changes a chat keeps to tell the model of: the latest. A bulk change is one of them, however many it made. */
export const UNDONE_TOLD = 20;
export const assistantThreadFields = {
  /** The workspace it's in, and who made it (#650). */
  workspaceId: v.id("workspaces"),
  createdBy: v.id("users"),
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
  /** When someone last pressed Stop here: the jobs that ended before it are told with no readout (#328, ./jobs.ts). */
  stoppedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

/** One action the assistant ran in a reply (./steps.ts). */
/** The most web sources one search keeps for its citations. */
export const WEB_SOURCES_KEPT = 10;
/** A web page a search found: its title, address and a few lines of what it says. */
export const webSourceValidator = v.object({ title: v.string(), url: v.string(), excerpt: v.string() });
export const webSourcesValidator = capped(v.optional(v.array(webSourceValidator)), WEB_SOURCES_KEPT);

export const assistantStepFields = {
  threadId: v.id("assistantThreads"),
  /** The exchange it belongs to: the agent component's order of the message being answered. */
  order: v.number(),
  /** Who it ran as: the person whose message was being answered. Only they can undo it. */
  userId: v.id("users"),
  /** The workspace it ran in, which its undo acts in (#650). */
  workspaceId: v.id("workspaces"),
  /** On a web search (#648): what it found, for the reply's citations and its list of sources. */
  sources: webSourcesValidator,
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
  /** On a call that asks first: other people see what it does (sharing a chat, deleting one, a change to a collection a library follows). */
  outside: v.optional(v.literal(true)),
  /** On one of those whose change can be undone: it asks only because others see it. Without it, the call can't be undone. */
  undoable: v.optional(v.literal(true)),
  /** Which of its several jobs its action does (lib/assistant/actions.ts), where its arguments don't say it one by one: a bulk change. */
  variant: v.optional(v.string()),
  /** Its action only reads (./tools.ts `onlyReads`): one that failed and was run again with success is hidden from the chat (lib/assistant/step-cards.ts). */
  reads: v.optional(v.literal(true)),
  /** On a step that only reads: the reply's request it was called in, by how many calls the reply made before that request. */
  request: v.optional(v.number()),
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

/**
 * A job a reply started that has ended (#328, ./jobs.ts): written once, by the transaction
 * that ends the job, and told to its chat once, as the person who started it, when the chat
 * isn't writing a reply or waiting for an answer.
 */
export const assistantJobEndFields = {
  threadId: v.id("assistantThreads"),
  /** The step that started it, and the person whose reply that was. */
  stepId: v.id("assistantSteps"),
  userId: v.id("users"),
  kind: v.union(v.literal("screening"), v.literal("extraction")),
  jobId: v.string(),
  /** How it ended: the job's status then. */
  status: v.string(),
  endedAt: v.number(),
  /** Set until it's told to the chat. */
  pending: v.optional(v.literal(true)),
  /** The chat message it was told in, by its order. */
  order: v.optional(v.number()),
};

/** A job a chat's reply started that hasn't ended: the chat docks its live card while it runs (./jobEnds.ts keeps these). */
export const assistantJobFields = {
  threadId: v.id("assistantThreads"),
  /** The step that started it, and the person whose reply that was. */
  stepId: v.id("assistantSteps"),
  userId: v.id("users"),
  kind: v.union(v.literal("screening"), v.literal("extraction")),
  jobId: v.string(),
};

/** People a chat's row in the list of chats names. */
export const ASSISTANT_MEMBERS_SHOWN = 3;
/** The first few people in a chat besides the reader, those who have it open now first. */
/** People in a chat, each with their photo when they have one. */
export const assistantMembersValidator = capped(v.array(v.object({ userId: v.id("users"), name: v.string(), here: v.boolean(), imageUrl: v.optional(v.string()) })), ASSISTANT_MEMBERS_SHOWN);

/** Records of each kind @ finds at once (./mentions.ts); the picker shows six. */
export const MENTIONS_EACH = 4;
/** What @ in the composer can point at: the ID its own tools take, and a search's results or a collection's papers. */
export const mentionablesValidator = capped(
  v.array(v.object({ kind: v.union(...MENTION_KINDS.map((kind) => v.literal(kind))), id: v.string(), label: v.string(), count: v.optional(v.number()) })),
  MENTIONS_EACH * MENTION_KINDS.length,
);

/**
 * Running jobs a chat may have at once (./jobEnds.ts refuses one more), which its dock shows
 * newest first; its opened list scrolls through them.
 */
export const JOBS_DOCKED = 50;
/** Running jobs a chat's row in the list names, one line each; it counts the rest. */
export const JOBS_LISTED = 2;
const jobKindValidator = v.union(v.literal("screening"), v.literal("extraction"));
/** A chat's running jobs, newest first, by the step that started each (./jobs.ts `running`). */
export const runningJobsValidator = capped(v.array(v.object({ stepId: v.id("assistantSteps"), kind: jobKindValidator })), JOBS_DOCKED);
/** The running jobs a chat's row names, with how far each has got in papers (./threads.ts `list`). */
export const listedJobsValidator = capped(v.array(v.object({ id: v.string(), kind: jobKindValidator, done: v.number(), total: v.number() })), JOBS_LISTED);
/** Job ends one chat is told in one message. */
export const JOBS_TOLD_AT_ONCE = 10;

/** A screening's live card in the chat that started it (./jobs.ts). */
export const screeningCardValidator = v.object({
  kind: v.literal("screening"),
  jobId: v.id("screeningJobs"),
  status: v.string(),
  label: v.optional(v.string()),
  total: v.number(),
  included: v.number(),
  excluded: v.number(),
  unclear: v.number(),
  failed: v.number(),
  /** Credits its counted papers cost, and the most it may. */
  credits: v.number(),
  cap: v.optional(v.number()),
  capped: v.optional(v.boolean()),
  /** Its papers wait for the person's other papers to finish: how far the screening ahead of it has got. */
  waiting: v.optional(v.object({ label: v.optional(v.string()), done: v.number(), total: v.number() })),
  failure: v.optional(v.string()),
});
/** An extraction's live card: how far it has got. Its answers are on its page. */
export const extractionCardValidator = v.object({
  kind: v.literal("extraction"),
  jobId: v.id("extractionJobs"),
  status: v.string(),
  name: v.string(),
  total: v.number(),
  done: v.number(),
  failed: v.number(),
  credits: v.number(),
  cap: v.optional(v.number()),
  /** Why it stopped, when it did. */
  stopped: v.optional(v.string()),
  questions: capped(v.array(v.object({ key: v.string(), question: v.string() })), MAX_QUESTIONS_PER_JOB),
});

/** The jobs one of the app's job-ended messages told the chat of (./replies.ts). */
export const jobsEndedValidator = capped(
  v.array(v.object({ kind: v.union(v.literal("screening"), v.literal("extraction")), jobId: v.string(), status: v.string(), stepId: v.id("assistantSteps") })),
  JOBS_TOLD_AT_ONCE,
);

/**
 * A file a person attached to an assistant chat (#647, ./files.ts). It belongs to them until
 * it's sent, then to the chat and the message it went with, and goes when the chat does.
 * One no reply has read for a while loses its bytes and stays as a name, so its message can
 * say it expired.
 */
export const assistantFileFields = {
  userId: v.id("users"),
  /** Set once it's sent. */
  threadId: v.optional(v.id("assistantThreads")),
  /** The agent's ID for the message it went with. */
  messageId: v.optional(v.string()),
  /** Absent once it has expired. */
  storageId: v.optional(v.id("_storage")),
  name: v.string(),
  bytes: v.number(),
  mediaType: v.string(),
  state: v.union(v.literal("pending"), v.literal("sent"), v.literal("expired")),
  /** When it was attached, or last went to the model. */
  usedAt: v.number(),
  /** The digest of the token its bytes are uploaded with, until they are. */
  uploadDigest: v.optional(v.string()),
  /** A PDF's parts as they arrive (./files.ts `upload`), until they're joined into one file. */
  chunks: capped(v.optional(v.array(v.id("_storage"))), MAX_PDF_CHUNKS),
  /** A PDF's (#648): how many pages it has. */
  pages: v.optional(v.number()),
  /** A text file's: how many lines it has. */
  lines: v.optional(v.number()),
  /** Pages a read cut from a PDF (`readPdf`): the PDF, and which pages, such as "3-7". */
  parentId: v.optional(v.id("assistantFiles")),
  range: v.optional(v.string()),
};

/** A file a person's message carried, as the chat shows it: no address once it expired (./files.ts). */
export const attachedFileValidator = v.object({ id: v.string(), name: v.string(), bytes: v.number(), mediaType: v.string(), url: v.union(v.string(), v.null()), pages: v.optional(v.number()), lines: v.optional(v.number()) });
export const attachedFilesValidator = capped(v.optional(v.array(attachedFileValidator)), MAX_FILES_PER_MESSAGE);
/** The PDFs a reply cites that the panel can't place (./files.ts `cited`), by ID or name: asked for, and found, a message's worth at a time. */
export const citedFileIdsValidator = capped(v.array(v.string()), MAX_FILES_PER_MESSAGE);
export const citedFilesValidator = capped(v.array(v.object({ id: v.string(), name: v.string(), url: v.union(v.string(), v.null()) })), MAX_FILES_PER_MESSAGE);
/** The files a message is sent with. */
export const sentFileIdsValidator = capped(v.optional(v.array(v.id("assistantFiles"))), MAX_FILES_PER_MESSAGE);
