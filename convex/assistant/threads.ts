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
import { modelSummary, presetPick } from "../ai/serverModel";
import { effortValidator, modelSummaryValidator } from "../aiModelConfig/validators";
import { requireFeature } from "../featureFlags/guard";
import { createError } from "../lib/errors";
import { assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, userMutation, userQuery } from "../lib/userActions";
import { requireAvailableModel, requireEffort, requireTaskModel } from "../models/catalog";
import schema from "../schema";
import type { Effort } from "../../lib/ai/core/call-options";
import { accessRows, best, deleteThread, personName, principalOf, principalsOf, requireThread, userPrincipal, type AssistantRole } from "./access";
import { viewers } from "./presence";
import { ASSISTANT_MEMBERS_SHOWN, assistantMembersValidator, assistantRoleValidator } from "./validators";

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

/** The start of a message, on one line, for the list of chats. Cut between characters, never inside one. */
export function previewOf(text: string) {
  const characters = [...text.trim().replace(/\s+/g, " ")];
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
  /** The first few people in it besides the reader, those who have it open now first, then its owner. */
  members: assistantMembersValidator,
  /** The first organization it's shared with, by name. */
  organization: v.optional(v.string()),
});

/**
 * What a chat's replies run on: the model picked for it, or the Balanced preset's chat
 * model while it has none. The model is null when neither is set.
 */
export async function chatModel(ctx: QueryCtx | MutationCtx, thread: Doc<"assistantThreads">): Promise<{ modelId: Id<"models"> | null; effort?: Effort }> {
  if (thread.modelId) return { modelId: thread.modelId, effort: thread.effort };
  const pick = await presetPick(ctx, "balanced", "chat");
  return { modelId: pick?.modelId ?? null, effort: pick?.effort };
}

/** The smallest window a model needs: the context budget and a reply fit in it (./context.ts). */
const MIN_CONTEXT_WINDOW = 64_000;

/** A model a chat can run on, with an effort it takes: one that calls tools and has room for the conversation. */
async function pickable(ctx: MutationCtx, modelId: Id<"models">, effort: Effort | undefined) {
  const model = await requireAvailableModel(ctx, modelId);
  requireEffort(model, effort);
  requireTaskModel(model, "chat");
  if (!model.supportedParameters?.includes("tools")) throw createError("VALIDATION_ERROR", `${model.name} can't use the tools the assistant works with.`);
  if ((model.contextLength ?? 0) < MIN_CONTEXT_WINDOW) {
    throw createError("VALIDATION_ERROR", `${model.name} can't hold a long enough conversation for the assistant.`);
  }
}

function titled(title: string | undefined) {
  const clean = title?.trim().replace(/\s+/g, " ") ?? "";
  if (clean.length > TITLE_MAX) throw createError("VALIDATION_ERROR", `A chat's title can be at most ${TITLE_MAX} characters.`);
  return clean;
}

export const createAction = defineUserMutation({
  path: "assistant/threads:create",
  description: "Starts a new assistant chat that belongs to the person, on a model and reasoning effort if given. Returns its ID.",
  args: { title: v.optional(v.string()), modelId: v.optional(v.id("models")), effort: v.optional(effortValidator) },
  returns: v.id("assistantThreads"),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, userId, args) => {
    await requireFeature(ctx, FLAG, userId);
    const title = titled(args.title) || "New chat";
    if (args.modelId) await pickable(ctx, args.modelId, args.effort);
    else if (args.effort) throw createError("VALIDATION_ERROR", "Pick a model to set its reasoning effort.");
    const now = Date.now();
    const agentThreadId = await createThread(ctx, components.agent, { userId, title });
    const threadId = await ctx.db.insert("assistantThreads", {
      ownerId: userId,
      title,
      agentThreadId,
      lastMessageAt: now,
      ...(args.modelId ? { modelId: args.modelId, effort: args.effort } : {}),
      createdAt: now,
      updatedAt: now,
    });
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
    "Given `text`, only chats whose title, or the start of whose newest message, contains it. Each comes with the start of its newest message, whether a reply is being written in it, " +
    "the first few people in it and who of them has it open now.",
  args: { scope: v.union(v.literal("all"), v.literal("mine"), v.literal("shared")), text: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(listedValidator),
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
    // Each chat the filter keeps: its access rows and what they let the person do, for the page built below.
    const kept = new Map<string, { role: AssistantRole; access: Doc<"assistantThreadAccess">[] }>();
    const read = await rows
      .filterWith(async (row) => {
        if (scope !== "all" && (row.role === "owner") !== (scope === "mine")) return false;
        // One read of the chat's access rows says both which of the person's principals reach
        // it and the most they may do. A chat that reaches them several ways lists once,
        // through the first of those principals.
        const access = await accessRows(ctx, row.threadId);
        const reaching = access.filter((other) => mine.has(other.principal));
        if (principals.find((principal) => reaching.some((other) => other.principal === principal)) !== row.principal) return false;
        if (needle) {
          const thread = await ctx.db.get("assistantThreads", row.threadId);
          if (!thread || !`${thread.title}\n${thread.preview ?? ""}`.toLowerCase().includes(needle)) return false;
        }
        kept.set(row.threadId, { role: best(reaching.map((other) => other.role)), access });
        return true;
      })
      .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, LIST_PAGE_MAX), maximumRowsRead: LIST_FILTER_ROWS, maximumBytesRead: LIST_PAGE_BYTES });
    const page = await Promise.all(
      read.page.map(async (row) => {
        const thread = await ctx.db.get("assistantThreads", row.threadId);
        const found = kept.get(row.threadId);
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
            return person ? [{ userId: memberId, name: personName(person), here: here.includes(memberId) }] : [];
          }),
        );
        const sharedWith = others.flatMap(({ principal }) => (principal.kind === "organization" ? [principal.organizationId] : []))[0];
        const organization = sharedWith ? await ctx.db.get("organizations", sharedWith) : null;
        return [
          {
            ...shown(thread, found.role),
            preview: thread.preview ?? "",
            writing: await writing(ctx, thread.reply),
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
  run: async (ctx, userId, { threadId }) => {
    await requireFeature(ctx, FLAG, userId);
    const { thread, role } = await requireThread(ctx, userId, threadId);
    const { modelId, effort } = await chatModel(ctx, thread);
    return { ...shown(thread, role), model: await modelSummary(ctx, modelId), ...(effort ? { effort } : {}) };
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
  run: async (ctx, userId, { threadId, modelId, effort }) => {
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
  run: async (ctx, userId, { threadId }) => {
    await requireFeature(ctx, FLAG, userId);
    const { thread } = await requireThread(ctx, userId, threadId, "owner");
    await deleteThread(ctx, thread);
    return null;
  },
});
export const remove = userMutation(removeAction);
export const removeForAssistant = assistantMutation(removeAction);
