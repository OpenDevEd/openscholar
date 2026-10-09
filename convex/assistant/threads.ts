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
import { modelSummary, presetPick, resolveTaskPick } from "../ai/serverModel";
import { DEFAULT_PRESET } from "../../lib/ai/tasks";
import { effortValidator, modelSummaryValidator } from "../aiModelConfig/validators";
import { requireFeature } from "../featureFlags/guard";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { query } from "../lib/functions";
import { assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, userMutation, userQuery } from "../lib/userActions";
import { requireAvailableModel, requireEffort, requireTaskModel } from "../models/catalog";
import schema from "../schema";
import type { Effort } from "../../lib/ai/core/call-options";
import { NEW_CHAT_TITLE } from "../../lib/assistant/title";
import { accessRows, best, deleteThread, personName, principalOf, principalsOf, requireThread, userPrincipal, type AssistantRole } from "./access";
import { viewers } from "./presence";
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
  /** The first few people in it besides the reader, those who have it open now first, then its owner. */
  members: assistantMembersValidator,
  /** The first organization it's shared with, by name. */
  organization: v.optional(v.string()),
});

/**
 * What a chat's replies run on for one person: the model picked for the chat, or, while it
 * has none, what their own AI settings run chat on: their preset's pick, or their own
 * under Custom (convex/ai/serverModel.ts). The model is null when nothing is set at all.
 */
export async function chatModel(ctx: QueryCtx | MutationCtx, thread: Doc<"assistantThreads">, userId: Id<"users">): Promise<{ modelId: Id<"models"> | null; effort?: Effort }> {
  if (thread.modelId) return { modelId: thread.modelId, effort: thread.effort };
  const pick = await assistantPick(ctx, userId);
  return { modelId: pick?.modelId ?? null, effort: pick?.effort };
}

/**
 * What the person's AI settings run chat on, for the assistant. Settings take any chat model, and one the assistant
 * can't run on (`requireAssistantModel`) gives way to the default preset's.
 */
export async function assistantPick(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  const pick = await resolveTaskPick(ctx, userId, "chat");
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
  description: "Starts a new assistant chat in the workspace, made by the person, on a model and reasoning effort if given. Returns its ID.",
  args: { title: v.optional(v.string()), modelId: v.optional(v.id("models")), effort: v.optional(effortValidator) },
  returns: v.id("assistantThreads"),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, { userId, workspaceId }, args) => {
    await requireFeature(ctx, FLAG, userId);
    const title = titled(args.title) || NEW_CHAT_TITLE;
    if (args.modelId) await pickable(ctx, args.modelId, args.effort);
    else if (args.effort) throw createError("VALIDATION_ERROR", "Pick a model to set its reasoning effort.");
    const now = Date.now();
    const agentThreadId = await createThread(ctx, components.agent, { userId, title });
    const threadId = await ctx.db.insert("assistantThreads", {
      ownerId: userId,
      workspaceId,
      createdBy: userId,
      title,
      agentThreadId,
      lastMessageAt: now,
      ...(args.modelId ? { modelId: args.modelId, effort: args.effort } : {}),
      createdAt: now,
      updatedAt: now,
    });
    // A chat in your own workspace lists through your own principal; one in an organization through the organization's workspace.
    if ((await ctx.db.get("workspaces", workspaceId))?.kind === "personal") {
      await ctx.db.insert("assistantThreadAccess", { threadId, principal: userPrincipal(userId), role: "owner", lastMessageAt: now, createdAt: now });
    }
    await startWith(ctx, threadId, userId, workspaceId);
    return threadId;
  },
});
export const create = userMutation(createAction);
export const createForAssistant = assistantMutation(createAction);

export const listAction = defineUserQuery({
  path: "assistant/threads:list",
  description:
    "Lists the assistant chats in the workspace the person can open, newest first, a page at a time: all of them, only the ones they made, or only the ones shared with them. " +
    "Given `text`, only chats whose title, or the start of whose newest message, contains it. Each comes with the start of its newest message, whether a reply is being written in it, " +
    "the first few people in it and who of them has it open now.",
  args: { scope: v.union(v.literal("all"), v.literal("mine"), v.literal("shared")), text: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(listedValidator),
  run: async (ctx, { userId, workspaceId, role }, { scope, text, paginationOpts }) => {
    await requireFeature(ctx, FLAG, userId);
    const user = await ctx.db.get("users", userId);
    if (!user) return { page: [], isDone: true, continueCursor: "" };
    const needle = text?.trim().toLowerCase();
    const matches = (thread: Doc<"assistantThreads"> | null) => !!thread && (!needle || `${thread.title}\n${thread.preview ?? ""}`.toLowerCase().includes(needle));
    const opts = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, LIST_PAGE_MAX), maximumRowsRead: LIST_FILTER_ROWS, maximumBytesRead: LIST_PAGE_BYTES };
    // Each chat the filter keeps: its access rows and what they let the person do, for the page built below.
    const kept = new Map<string, { role: AssistantRole; access: Doc<"assistantThreadAccess">[] }>();
    let read: { page: Id<"assistantThreads">[]; isDone: boolean; continueCursor: string };
    if ((await ctx.db.get("workspaces", workspaceId))?.kind === "organization") {
      // An organization's chats are all its members' (#650): none of them are shared with them, and each is its maker's and its admins' to manage.
      if (scope === "shared") return { page: [], isDone: true, continueCursor: "" };
      const chats = await stream(ctx.db, schema)
        .query("assistantThreads")
        .withIndex("by_workspace_and_lastMessageAt", (q) => q.eq("workspaceId", workspaceId))
        .order("desc")
        .filterWith(async (thread) => {
          if ((scope === "mine" && thread.createdBy !== userId) || !matches(thread)) return false;
          kept.set(thread._id, { role: role === "admin" || thread.createdBy === userId ? "owner" : "write", access: await accessRows(ctx, thread._id) });
          return true;
        })
        .paginate(opts);
      read = { ...chats, page: chats.page.map((thread) => thread._id) };
    } else {
      const principals = await principalsOf(ctx, user);
      const mine = new Set(principals);
      // Their own chats are all under their own principal.
      const through = scope === "mine" ? principals.slice(0, 1) : principals;
      const rows = mergedStream(
        through.map((principal) =>
          stream(ctx.db, schema).query("assistantThreadAccess").withIndex("by_principal_and_lastMessageAt", (q) => q.eq("principal", principal)).order("desc"),
        ),
        ["lastMessageAt"],
      );
      const access = await rows
        .filterWith(async (row) => {
          if (scope !== "all" && (row.role === "owner") !== (scope === "mine")) return false;
          // One read of the chat's access rows says both which of the person's principals reach
          // it and the most they may do. A chat that reaches them several ways lists once,
          // through the first of those principals.
          const rowsOf = await accessRows(ctx, row.threadId);
          const reaching = rowsOf.filter((other) => mine.has(other.principal));
          if (principals.find((principal) => reaching.some((other) => other.principal === principal)) !== row.principal) return false;
          if (needle && !matches(await ctx.db.get("assistantThreads", row.threadId))) return false;
          kept.set(row.threadId, { role: best(reaching.map((other) => other.role)), access: rowsOf });
          return true;
        })
        .paginate(opts);
      read = { ...access, page: access.page.map((row) => row.threadId) };
    }
    const page = await Promise.all(
      read.page.map(async (threadId) => {
        const thread = await ctx.db.get("assistantThreads", threadId);
        const found = kept.get(threadId);
        if (!thread || !found) return [];
        // One more than the row shows, since the reader may be among them. Anyone in the room
        // could open the chat when they joined it, through a grant of their own or an organization's.
        const here = (await viewers(ctx, thread._id, ASSISTANT_MEMBERS_SHOWN + 1)).filter((viewer) => viewer !== userId);
        const others = found.access.flatMap((other) => {
          const principal = principalOf(ctx, other.principal);
          return principal && !(principal.kind === "user" && principal.userId === userId) ? [{ principal, owner: other.role === "owner" }] : [];
        });
        // The people there now, then the chat's owner, then the people it's shared with by name.
        const granted = others
          .flatMap(({ principal, owner }) => (principal.kind === "user" ? [{ userId: principal.userId, owner }] : []))
          .sort((a, b) => Number(b.owner) - Number(a.owner))
          .map((person) => person.userId);
        const people = [...new Set([...here, ...granted])].slice(0, ASSISTANT_MEMBERS_SHOWN);
        const members = await Promise.all(
          people.map(async (memberId) => {
            const person = await ctx.db.get("users", memberId);
            return person ? [{ userId: memberId, name: personName(person), here: here.includes(memberId), ...(person.avatarUrl ? { imageUrl: person.avatarUrl } : {}) }] : [];
          }),
        );
        const sharedWith = others.flatMap(({ principal }) => (principal.kind === "organization" ? [principal.organizationId] : []))[0];
        const organization = sharedWith ? await ctx.db.get("organizations", sharedWith) : null;
        return [
          {
            ...shown(thread, found.role),
            preview: thread.preview ?? "",
            writing: await writing(ctx, thread.reply),
            ...(await runningJobs(ctx, thread._id)),
            members: members.flat(),
            ...(organization ? { organization: organization.name } : {}),
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
  run: async (ctx, { userId }, { threadId }) => {
    await requireFeature(ctx, FLAG, userId);
    const { thread, role } = await requireThread(ctx, userId, threadId);
    const { modelId, effort } = await chatModel(ctx, thread, userId);
    return { ...shown(thread, role), model: await modelSummary(ctx, modelId), ...(effort ? { effort } : {}) };
  },
});
export const get = userQuery(getAction);

/** The model a new chat starts on, shown before it exists: the chat model of the person's AI settings, as a chat with none of its own runs on (`assistantPick`). */
export const newChatModel = query({
  args: {},
  returns: v.object({ model: v.union(modelSummaryValidator, v.null()), effort: v.optional(effortValidator) }),
  handler: async (ctx) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    const pick = await assistantPick(ctx, userId);
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
  run: async (ctx, { userId }, { threadId, title }) => {
    await requireFeature(ctx, FLAG, userId);
    await requireThread(ctx, userId, threadId, "owner");
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
    "Anyone who can write in the chat can.",
  args: { threadId: v.id("assistantThreads"), modelId: v.id("models"), effort: v.optional(effortValidator) },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, { userId }, { threadId, modelId, effort }) => {
    await requireFeature(ctx, FLAG, userId);
    await requireThread(ctx, userId, threadId, "write");
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
  run: async (ctx, { userId }, { threadId }) => {
    await requireFeature(ctx, FLAG, userId);
    const { thread } = await requireThread(ctx, userId, threadId, "owner");
    await deleteThread(ctx, thread);
    return null;
  },
});
export const remove = userMutation(removeAction);
export const removeForAssistant = assistantMutation(removeAction);
