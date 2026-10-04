/**
 * The assistant's chats (#324): making one, listing the ones a person can open, and its
 * owner renaming or deleting it. Messages and replies are in ./replies.ts.
 */
import { createThread } from "@convex-dev/agent";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { mergedStream, stream } from "convex-helpers/server/stream";
import { v } from "convex/values";
import { components } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { requireFeature } from "../featureFlags/guard";
import { createError } from "../lib/errors";
import { assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, userMutation, userQuery } from "../lib/userActions";
import schema from "../schema";
import { accessRows, best, deleteThread, principalsOf, requireThread, userPrincipal, type AssistantRole } from "./access";
import { assistantRoleValidator } from "./validators";

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

const threadValidator = v.object({
  _id: v.id("assistantThreads"),
  title: v.string(),
  lastMessageAt: v.number(),
  createdAt: v.number(),
  /** The most the person may do in it, through any way it reaches them. */
  role: assistantRoleValidator,
});

function titled(title: string | undefined) {
  const clean = title?.trim().replace(/\s+/g, " ") ?? "";
  if (clean.length > TITLE_MAX) throw createError("VALIDATION_ERROR", `A chat's title can be at most ${TITLE_MAX} characters.`);
  return clean;
}

export const createAction = defineUserMutation({
  path: "assistant/threads:create",
  description: "Starts a new assistant chat that belongs to the person. Returns its ID.",
  args: { title: v.optional(v.string()) },
  returns: v.id("assistantThreads"),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, userId, args) => {
    await requireFeature(ctx, FLAG, userId);
    const title = titled(args.title) || "New chat";
    const now = Date.now();
    const agentThreadId = await createThread(ctx, components.agent, { userId, title });
    const threadId = await ctx.db.insert("assistantThreads", { ownerId: userId, title, agentThreadId, lastMessageAt: now, createdAt: now, updatedAt: now });
    await ctx.db.insert("assistantThreadAccess", { threadId, principal: userPrincipal(userId), role: "owner", lastMessageAt: now, createdAt: now });
    return threadId;
  },
});
export const create = userMutation(createAction);
export const createForAssistant = assistantMutation(createAction);

export const listAction = defineUserQuery({
  path: "assistant/threads:list",
  description:
    "Lists the assistant chats the person can open, newest first, a page at a time: all of them, only their own, or only the ones shared with them. " +
    "Given `text`, only chats whose title contains it.",
  args: { scope: v.union(v.literal("all"), v.literal("mine"), v.literal("shared")), text: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(threadValidator),
  run: async (ctx, userId, { scope, text, paginationOpts }) => {
    await requireFeature(ctx, FLAG, userId);
    const user = await ctx.db.get("users", userId);
    if (!user) return { page: [], isDone: true, continueCursor: "" };
    const principals = await principalsOf(ctx, user);
    const mine = new Set(principals);
    const needle = text?.trim().toLowerCase();
    // Their own chats are all under their own principal.
    const through = scope === "mine" ? principals.slice(0, 1) : principals;
    const rows = mergedStream(
      through.map((principal) =>
        stream(ctx.db, schema).query("assistantThreadAccess").withIndex("by_principal_and_lastMessageAt", (q) => q.eq("principal", principal)).order("desc"),
      ),
      ["lastMessageAt"],
    );
    // What each chat the filter keeps lets the person do, for the page built below.
    const roles = new Map<string, AssistantRole>();
    const read = await rows
      .filterWith(async (row) => {
        if (scope !== "all" && (row.role === "owner") !== (scope === "mine")) return false;
        // One read of the chat's access rows says both which of the person's principals reach
        // it and the most they may do. A chat that reaches them several ways lists once,
        // through the first of those principals.
        const reaching = (await accessRows(ctx, row.threadId)).filter((other) => mine.has(other.principal));
        if (principals.find((principal) => reaching.some((other) => other.principal === principal)) !== row.principal) return false;
        if (needle) {
          const thread = await ctx.db.get("assistantThreads", row.threadId);
          if (!thread?.title.toLowerCase().includes(needle)) return false;
        }
        roles.set(row.threadId, best(reaching.map((other) => other.role)));
        return true;
      })
      .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, LIST_PAGE_MAX), maximumRowsRead: LIST_FILTER_ROWS, maximumBytesRead: LIST_PAGE_BYTES });
    const page = await Promise.all(
      read.page.map(async (row) => {
        const thread = await ctx.db.get("assistantThreads", row.threadId);
        const role = roles.get(row.threadId);
        return thread && role ? [shown(thread, role)] : [];
      }),
    );
    return { ...read, page: page.flat() };
  },
});
export const list = userQuery(listAction);
export const listForAssistant = assistantQuery(listAction);

const shown = (thread: Doc<"assistantThreads">, role: AssistantRole) => ({
  _id: thread._id,
  title: thread.title,
  lastMessageAt: thread.lastMessageAt,
  createdAt: thread.createdAt,
  role,
});

export const getAction = defineUserQuery({
  path: "assistant/threads:get",
  description: "Reads one assistant chat the person can open: its title, when it was last written in, and what they may do in it.",
  args: { threadId: v.id("assistantThreads") },
  returns: threadValidator,
  run: async (ctx, userId, { threadId }) => {
    await requireFeature(ctx, FLAG, userId);
    const { thread, role } = await requireThread(ctx, userId, threadId);
    return shown(thread, role);
  },
});
export const get = userQuery(getAction);
export const getForAssistant = assistantQuery(getAction);

export const renameAction = defineUserMutation({
  path: "assistant/threads:rename",
  description: "Renames an assistant chat. Only its owner can.",
  args: { threadId: v.id("assistantThreads"), title: v.string() },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, userId, { threadId, title }) => {
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

export const removeAction = defineUserMutation({
  path: "assistant/threads:remove",
  description: "Deletes an assistant chat with its messages, for everyone it was shared with. Only its owner can, and it can't be undone.",
  args: { threadId: v.id("assistantThreads") },
  returns: v.null(),
  spendsCredits: false,
  // Everyone the chat was shared with loses it.
  outsideEffect: true,
  undoable: false,
  run: async (ctx, userId, { threadId }) => {
    await requireFeature(ctx, FLAG, userId);
    const { thread } = await requireThread(ctx, userId, threadId, "owner");
    await deleteThread(ctx, thread);
    return null;
  },
});
export const remove = userMutation(removeAction);
export const removeForAssistant = assistantMutation(removeAction);
