/**
 * The assistant's chats (#324): making one, listing the ones a person can open, and its
 * owner renaming or deleting it. Messages and replies are in ./replies.ts.
 */
import { createThread } from "@convex-dev/agent";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { mergedStream, stream } from "convex-helpers/server/stream";
import { v } from "convex/values";
import { components } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { modelSummary, organizationPreset, presetPick, resolveTaskPick } from "../ai/serverModel";
import { DEFAULT_PRESET } from "../../lib/ai/tasks";
import { effortValidator, modelSummaryValidator } from "../aiModelConfig/validators";
import { requireFeature } from "../featureFlags/guard";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { workingIn } from "../workspaces/actor";
import { query } from "../lib/functions";
import { assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, userMutation, userQuery } from "../lib/userActions";
import { requireAvailableModel, requireEffort, requireTaskModel } from "../models/catalog";
import schema from "../schema";
import type { Effort } from "../../lib/ai/core/call-options";
import { NEW_CHAT_TITLE } from "../../lib/assistant/title";
import { deleteThread, guestsOf, requireThreadIn, type AssistantRole } from "./access";
import { open } from "../sharing/items";
import { personName } from "../lib/people";
import { chatViewers } from "../presence";
import { startWith } from "./spending";
import { ASSISTANT_MEMBERS_SHOWN, assistantMembersValidator, assistantRoleValidator, JOBS_DOCKED, JOBS_LISTED, listedJobsValidator } from "./validators";
import { progressOf } from "./jobs";

const FLAG = "assistant.enabled";
const TITLE_MAX = 120;
const LIST_PAGE_MAX = 50;
/**
 * Access rows one page of the list may read while it looks for chats the filter keeps. Each
 * costs one more read, of its chat's access rows, so this stays far inside the index ranges
 * a query may read.
 */
const LIST_FILTER_ROWS = 500;
const LIST_PAGE_BYTES = 2 * 1024 * 1024;
const PREVIEW_MAX = 120;

const EMPHASIS = /(\*\*|__|~~|\*)(?=\S)(.+?)(?<=\S)\1/g;
/** An underscore is a mark only at the edge of a word, so snake_case_name keeps its own. */
const UNDERSCORES = /(?<![\p{L}\p{N}_])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}_])/gu;
/** A link or image, its address allowed one pair of brackets inside, as Wikipedia's have. */
const LINK = /!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g;

/**
 * The start of a message, on one line and without its markdown marks, for the list of chats.
 * Cut between characters, never inside one.
 */
export function previewOf(text: string) {
  // ponytail: a few patterns for the marks a message opens with, not a markdown parser. Use one if a preview ever has to read a table or a code block.
  // Only the start is read, so a long reply costs no more than a short one. A cut through an emoji drops its first half too.
  const plain = text
    .slice(0, PREVIEW_MAX * 20)
    .replace(/[\uD800-\uDBFF]$/, "")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+])\s+/gm, "")
    // Code keeps what's inside it as written. The rest loses its links and marks, twice for marks inside marks.
    .split(/`([^`]+)`/)
    .map((part, index) => (index % 2 ? part : part.replace(LINK, "$1").replace(EMPHASIS, "$2").replace(EMPHASIS, "$2").replace(UNDERSCORES, "$1")))
    .join("");
  const characters = [...plain.trim().replace(/\s+/g, " ")];
  return characters.length > PREVIEW_MAX ? `${characters.slice(0, PREVIEW_MAX - 1).join("").trimEnd()}…` : characters.join("");
}

type Reply = NonNullable<Doc<"assistantThreads">["reply"]>;

/**
 * Whether a reply is still being written: its action is waiting to run or running. An
 * action that ended, or died, without releasing its lock no longer holds the chat.
 */
export async function writing(ctx: QueryCtx | MutationCtx, reply: Reply | undefined): Promise<boolean> {
  if (!reply) return false;
  const state = (await ctx.db.system.get(reply.scheduledId))?.state.kind;
  return state === "pending" || state === "inProgress";
}

const threadValidator = v.object({
  _id: v.id("assistantThreads"),
  title: v.string(),
  lastMessageAt: v.number(),
  createdAt: v.number(),
  /** The most the person may do in it, through any way it reaches them. */
  role: assistantRoleValidator,
});

/** A chat as the list shows it. */
const listedValidator = v.object({
  ...threadValidator.fields,
  /** The start of its newest message; empty before its first. */
  preview: v.string(),
  /** A reply is being written in it now. */
  writing: v.boolean(),
  /** The first of the jobs its replies started that are still running, newest first, with how far each has got; `moreJobs` counts the rest. */
  jobs: listedJobsValidator,
  moreJobs: v.number(),
  /** The first few people in it besides the reader, those who have it open now first, then whoever started it. */
  members: assistantMembersValidator,
});

/**
 * What a chat's replies run on for one person: the model picked for the chat, or, while it
 * has none, what their own AI settings run chat on: their preset's pick, or their own
 * under Custom (convex/ai/serverModel.ts). The model is null when nothing is set at all.
 */
export async function chatModel(ctx: QueryCtx | MutationCtx, thread: Doc<"assistantThreads">, userId: Id<"users">): Promise<{ modelId: Id<"models"> | null; effort?: Effort }> {
  // An organization's chats run on its current preset, whatever was picked for them (#651).
  if (thread.modelId && (await organizationPreset(ctx, thread.workspaceId)) === null) return { modelId: thread.modelId, effort: thread.effort };
  const pick = await assistantPick(ctx, { userId, workspaceId: thread.workspaceId });
  return { modelId: pick?.modelId ?? null, effort: pick?.effort };
}

/**
 * What the person's AI settings run chat on, for the assistant. Settings take any chat model, and one the assistant
 * can't run on (`requireAssistantModel`) gives way to the default preset's.
 */
export async function assistantPick(ctx: QueryCtx | MutationCtx, working: { userId: Id<"users">; workspaceId: Id<"workspaces"> }) {
  const pick = await resolveTaskPick(ctx, working, "chat");
  const model = pick ? await ctx.db.get("models", pick.modelId) : null;
  return model && runsAssistant(model) ? pick : presetPick(ctx, DEFAULT_PRESET, "chat");
}

function runsAssistant(model: Doc<"models">) {
  try {
    requireAssistantModel(model);
    return true;
  } catch {
    return false;
  }
}

/** The smallest window a model needs: the context budget and a reply fit in it (./context.ts). */
const MIN_CONTEXT_WINDOW = 64_000;

/** Refuses a model the assistant can't run on: one that doesn't call tools, or has no room for the conversation. */
export function requireAssistantModel(model: Doc<"models">) {
  requireTaskModel(model, "chat");
  if (!model.supportedParameters?.includes("tools")) throw createError("VALIDATION_ERROR", `${model.name} can't use the tools the assistant works with. Pick another model for this chat.`);
  if ((model.contextLength ?? 0) < MIN_CONTEXT_WINDOW) {
    throw createError("VALIDATION_ERROR", `${model.name} can't hold a long enough conversation for the assistant. Pick another model for this chat.`);
  }
}

/** A model a chat can run on, with an effort it takes. */
async function pickable(ctx: MutationCtx, modelId: Id<"models">, effort: Effort | undefined) {
  const model = await requireAvailableModel(ctx, modelId);
  requireEffort(model, effort);
  requireAssistantModel(model);
}

function titled(title: string | undefined) {
  const clean = title?.trim().replace(/\s+/g, " ") ?? "";
  if (clean.length > TITLE_MAX) throw createError("VALIDATION_ERROR", `A chat's title can be at most ${TITLE_MAX} characters.`);
  return clean;
}

export const createAction = defineUserMutation({
  path: "assistant/threads:create",
  description: "Starts a new assistant chat in the workspace, made by the person, on a model and reasoning effort if given; an organization's chats run on its AI preset, so it takes none there. Returns its ID.",
  args: { title: v.optional(v.string()), modelId: v.optional(v.id("models")), effort: v.optional(effortValidator) },
  returns: v.id("assistantThreads"),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, { userId, workspaceId }, args) => {
    await requireFeature(ctx, FLAG, userId);
    const title = titled(args.title) || NEW_CHAT_TITLE;
    // An organization's chats run on its preset (#651): a model picked for one isn't kept.
    const own = (await organizationPreset(ctx, workspaceId)) === null;
    if (own && args.modelId) await pickable(ctx, args.modelId, args.effort);
    else if (own && args.effort) throw createError("VALIDATION_ERROR", "Pick a model to set its reasoning effort.");
    const now = Date.now();
    const agentThreadId = await createThread(ctx, components.agent, { userId, title });
    const threadId = await ctx.db.insert("assistantThreads", {
      workspaceId,
      createdBy: userId,
      title,
      agentThreadId,
      lastMessageAt: now,
      ...(own && args.modelId ? { modelId: args.modelId, effort: args.effort } : {}),
      createdAt: now,
      updatedAt: now,
    });
    await startWith(ctx, threadId, userId, workspaceId);
    return threadId;
  },
});
export const create = userMutation(createAction);
export const createForAssistant = assistantMutation(createAction);

export const peopleAction = defineUserQuery({
  path: "assistant/threads:people",
  description:
    "Lists who is in an assistant chat and what each may do: whoever started it (`owner`), then the people it's shared with, to write in it (`write`) or to read it (`read`), in the order they were given it. " +
    "Its workspace's members aren't listed: they all have it. Emails are for whoever shares it. It is shared, and their roles changed, with sharing/guests:add, setRole and remove (`kind` \"chat\").",
  args: { threadId: v.id("assistantThreads") },
  returns: paginationResultValidator(v.object({ userId: v.id("users"), role: assistantRoleValidator, you: v.boolean(), name: v.string(), email: v.optional(v.string()), imageUrl: v.optional(v.string()) })),
  run: async (ctx, actor, { threadId }) => {
    await requireFeature(ctx, FLAG, actor.userId);
    const { thread, role } = await requireThreadIn(ctx, actor, threadId);
    // Its guests are at most MAX_ASSISTANT_THREAD_GRANTS, so with whoever started it they are one page.
    const people = [{ userId: thread.createdBy, role: "owner" as const }, ...(await guestsOf(ctx, threadId)).map((guest) => ({ userId: guest.userId, role: guest.role === "editor" ? ("write" as const) : ("read" as const) }))];
    const page = await Promise.all(people.map(async (one) => {
      const person = await ctx.db.get("users", one.userId);
      return person ? [{ ...one, you: one.userId === actor.userId, name: personName(person), ...(role === "owner" ? { email: person.email } : {}), ...(person.avatarUrl ? { imageUrl: person.avatarUrl } : {}) }] : [];
    }));
    return { page: page.flat(), isDone: true, continueCursor: "" };
  },
});
export const people = userQuery(peopleAction);
export const peopleForAssistant = assistantQuery(peopleAction);


export const listAction = defineUserQuery({
  path: "assistant/threads:list",
  description:
    "Lists the assistant chats the person can open in the workspace, newest first, a page at a time: all of them, only the ones they made, or only the ones shared with them from other workspaces, which are in their own. " +
    "Given `text`, only chats whose title, or the start of whose newest message, contains it. Each comes with the start of its newest message, whether a reply is being written in it, " +
    "the first few people in it and who of them has it open now. In an organization, `by` keeps only the chats that member started (their `userId` from workspaces/makers:counts).",
  args: { scope: v.union(v.literal("all"), v.literal("mine"), v.literal("shared")), text: v.optional(v.string()), by: v.optional(v.id("users")), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(listedValidator),
  run: async (ctx, { userId, workspaceId, role }, { scope, text, by, paginationOpts }) => {
    await requireFeature(ctx, FLAG, userId);
    const user = await ctx.db.get("users", userId);
    if (!user) return { page: [], isDone: true, continueCursor: "" };
    const needle = text?.trim().toLowerCase();
    const matches = (thread: Doc<"assistantThreads"> | null) => !!thread && (!needle || `${thread.title}\n${thread.preview ?? ""}`.toLowerCase().includes(needle));
    const opts = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, LIST_PAGE_MAX), maximumRowsRead: LIST_FILTER_ROWS, maximumBytesRead: LIST_PAGE_BYTES };
    // Each chat the filter keeps, with what the person may do in it, for the page built below.
    const kept = new Map<string, AssistantRole>();
    let read: { page: Id<"assistantThreads">[]; isDone: boolean; continueCursor: string };
    if ((await ctx.db.get("workspaces", workspaceId))?.kind === "organization") {
      // An organization's chats are all its members' (#650): none of them are shared with them, and each is its maker's and its admins' to manage.
      if (scope === "shared") return { page: [], isDone: true, continueCursor: "" };
      // One member's, given `by` or "mine", read along their own index range (#656).
      const maker = by ?? (scope === "mine" ? userId : undefined);
      const chats = await (maker
        ? stream(ctx.db, schema).query("assistantThreads").withIndex("by_workspace_and_createdBy_and_lastMessageAt", (q) => q.eq("workspaceId", workspaceId).eq("createdBy", maker))
        : stream(ctx.db, schema).query("assistantThreads").withIndex("by_workspace_and_lastMessageAt", (q) => q.eq("workspaceId", workspaceId)))
        .order("desc")
        .filterWith(async (thread) => {
          if (!matches(thread)) return false;
          kept.set(thread._id, role === "admin" || thread.createdBy === userId ? "owner" : "write");
          return true;
        })
        .paginate(opts);
      read = { ...chats, page: chats.page.map((thread) => thread._id) };
    } else {
      // A person's own workspace lists its chats, which are theirs, and the chats shared with them (#653): two lists read as one, newest message first.
      const own = stream(ctx.db, schema).query("assistantThreads").withIndex("by_workspace_and_lastMessageAt", (q) => q.eq("workspaceId", workspaceId)).order("desc");
      const shared = stream(ctx.db, schema).query("itemAccess").withIndex("by_user_and_kind_and_lastMessageAt", (q) => q.eq("userId", userId).eq("kind", "chat")).order("desc");
      type Row = Doc<"assistantThreads"> | Doc<"itemAccess">;
      // The merge reads each by its `lastMessageAt`, which both kinds of row keep; its types take one table.
      const rows = (scope === "mine" ? own : scope === "shared" ? shared : mergedStream([own, shared as unknown as typeof own], ["lastMessageAt"])) as unknown as typeof own;
      const threadOf = (row: Row) => ("item" in row ? ctx.db.normalizeId("assistantThreads", row.item) : row._id);
      const chats = await rows
        .filterWith(async (given) => {
          const row = given as Row;
          const threadId = threadOf(row);
          const thread = "item" in row ? (threadId ? await ctx.db.get("assistantThreads", threadId) : null) : row;
          if (!thread || !matches(thread)) return false;
          // One shared from a workspace that's gone waits to be taken off the list (../sharing/upkeep.ts).
          if ("item" in row && !(await open(ctx, thread.workspaceId))) return false;
          kept.set(thread._id, "item" in row ? (row.role === "editor" ? "write" : "read") : "owner");
          return true;
        })
        .paginate(opts);
      read = { ...chats, page: chats.page.flatMap((row) => threadOf(row as Row) ?? []) };
    }
    const page = await Promise.all(
      read.page.map(async (threadId) => {
        const thread = await ctx.db.get("assistantThreads", threadId);
        const found = kept.get(threadId);
        if (!thread || !found) return [];
        // One more than the row shows, since the reader may be among them. Anyone in the room
        // could open the chat when they joined it, as a member of its workspace or as its guest.
        const here = (await chatViewers(ctx, thread._id, ASSISTANT_MEMBERS_SHOWN + 1)).filter((viewer) => viewer !== userId);
        // The people there now, then whoever started it, then the people it's shared with, in the order they were given it.
        const granted = [thread.createdBy, ...(await guestsOf(ctx, thread._id)).map((guest) => guest.userId)].filter((person) => person !== userId);
        const people = [...new Set([...here, ...granted])].slice(0, ASSISTANT_MEMBERS_SHOWN);
        const members = await Promise.all(
          people.map(async (memberId) => {
            const person = await ctx.db.get("users", memberId);
            return person ? [{ userId: memberId, name: personName(person), here: here.includes(memberId), ...(person.avatarUrl ? { imageUrl: person.avatarUrl } : {}) }] : [];
          }),
        );
        return [
          {
            ...shown(thread, found),
            preview: thread.preview ?? "",
            writing: await writing(ctx, thread.reply),
            ...(await runningJobs(ctx, thread._id)),
            members: members.flat(),
          },
        ];
      }),
    );
    return { ...read, page: page.flat() };
  },
});
export const list = userQuery(listAction);
export const listForAssistant = assistantQuery(listAction);

/** A chat's running jobs as its row names them: the newest few with how far each has got, and how many more. */
async function runningJobs(ctx: QueryCtx, threadId: Id<"assistantThreads">) {
  const rows = await ctx.db.query("assistantJobs").withIndex("by_thread", (q) => q.eq("threadId", threadId)).order("desc").take(JOBS_DOCKED);
  const listed = await Promise.all(
    rows.slice(0, JOBS_LISTED).map(async (row) => {
      const progress = await progressOf(ctx, row);
      return progress ? [{ id: row.jobId, kind: row.kind, ...progress }] : [];
    }),
  );
  return { jobs: listed.flat(), moreJobs: Math.max(0, rows.length - JOBS_LISTED) };
}

const shown = (thread: Doc<"assistantThreads">, role: AssistantRole) => ({
  _id: thread._id,
  title: thread.title,
  lastMessageAt: thread.lastMessageAt,
  createdAt: thread.createdAt,
  role,
});

export const getAction = defineUserQuery({
  path: "assistant/threads:get",
  description: "Reads one assistant chat the person can open: its title, when it was last written in, the model and reasoning effort its replies run on, and what they may do in it.",
  args: { threadId: v.id("assistantThreads") },
  returns: v.object({ ...threadValidator.fields, model: v.union(modelSummaryValidator, v.null()), effort: v.optional(effortValidator) }),
  run: async (ctx, actor, { threadId }) => {
    const { userId } = actor;
    await requireFeature(ctx, FLAG, userId);
    const { thread, role } = await requireThreadIn(ctx, actor, threadId);
    const { modelId, effort } = await chatModel(ctx, thread, userId);
    return { ...shown(thread, role), model: await modelSummary(ctx, modelId), ...(effort ? { effort } : {}) };
  },
});
export const get = userQuery(getAction);

/** The model a new chat starts on, shown before it exists: the chat model of the person's AI settings, as a chat with none of its own runs on (`assistantPick`). */
export const newChatModel = query({
  // The workspace the chat would start in, whose preset an organization's chat runs on (#651); none, the person's own.
  args: { workspaceId: v.optional(v.id("workspaces")) },
  returns: v.object({ model: v.union(modelSummaryValidator, v.null()), effort: v.optional(effortValidator) }),
  handler: async (ctx, { workspaceId }) => {
    const user = await requireAuth(ctx);
    await requireFeature(ctx, FLAG, user._id);
    const working = await workingIn(ctx, user, workspaceId);
    if (!working) throw createError("NOT_FOUND", "Workspace not found");
    const pick = await assistantPick(ctx, working);
    return { model: await modelSummary(ctx, pick?.modelId ?? null), ...(pick?.effort ? { effort: pick.effort } : {}) };
  },
});
export const getForAssistant = assistantQuery(getAction);

export const renameAction = defineUserMutation({
  path: "assistant/threads:rename",
  description: "Renames an assistant chat. Only its owner can.",
  args: { threadId: v.id("assistantThreads"), title: v.string() },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, actor, { threadId, title }) => {
    await requireFeature(ctx, FLAG, actor.userId);
    await requireThreadIn(ctx, actor, threadId, "owner");
    const clean = titled(title);
    if (!clean) throw createError("VALIDATION_ERROR", "A chat needs a title.");
    await ctx.db.patch("assistantThreads", threadId, { title: clean, updatedAt: Date.now() });
    return null;
  },
});
export const rename = userMutation(renameAction);
export const renameForAssistant = assistantMutation(renameAction);

export const setModelAction = defineUserMutation({
  path: "assistant/threads:setModel",
  description:
    "Sets the model an assistant chat's replies run on, and their reasoning effort when the model takes one. It applies from the next message. " +
    "Anyone who can write in the chat can, in their own workspace: an organization's chats run on the AI preset its admins pick.",
  args: { threadId: v.id("assistantThreads"), modelId: v.id("models"), effort: v.optional(effortValidator) },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, actor, { threadId, modelId, effort }) => {
    await requireFeature(ctx, FLAG, actor.userId);
    await requireThreadIn(ctx, actor, threadId, "write");
    if ((await organizationPreset(ctx, actor.workspaceId)) !== null) throw createError("FORBIDDEN", "An organization's chats run on the AI preset its admins pick in its AI settings.");
    await pickable(ctx, modelId, effort);
    await ctx.db.patch("assistantThreads", threadId, { modelId, effort, updatedAt: Date.now() });
    return null;
  },
});
export const setModel = userMutation(setModelAction);
export const setModelForAssistant = assistantMutation(setModelAction);

export const removeAction = defineUserMutation({
  path: "assistant/threads:remove",
  description: "Deletes an assistant chat with its messages, for everyone it was shared with. Only its owner can, and it can't be undone.",
  args: { threadId: v.id("assistantThreads") },
  returns: v.null(),
  spendsCredits: false,
  // Everyone the chat was shared with loses it.
  outsideEffect: true,
  undoable: false,
  run: async (ctx, actor, { threadId }) => {
    await requireFeature(ctx, FLAG, actor.userId);
    const { thread } = await requireThreadIn(ctx, actor, threadId, "owner");
    await deleteThread(ctx, thread);
    return null;
  },
});
export const remove = userMutation(removeAction);
export const removeForAssistant = assistantMutation(removeAction);
