/**
 * Files people attach to assistant chats (#647).
 *
 * An upload starts with `uploadUrl`, which counts it against the person's plan and makes
 * the file's row before anything is stored. `ready` then binds what they uploaded to that
 * row, which only takes a file stored after the row was made and kept by no other row: an
 * image's address carries its storage ID, so without that anyone who saw it could claim it
 * and delete it.
 *
 * A file is the person's until they send it, then their chat's, and goes with the chat or
 * their account. One no reply has sent to the model for 30 days loses its bytes and stays
 * as a name (`expire`), so its message says it expired and the model is told so.
 *
 *   uploadUrl     a file's row, and where to upload it
 *   ready         the upload, bound to its row once its bytes say it is an image
 *   remove        a file attached and not yet sent
 */
import { v } from "convex/values";
import type { FilePart, ModelMessage, TextPart } from "ai";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { planLimit } from "../billing/accounts";
import { requireFeature } from "../featureFlags/guard";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { action } from "../_generated/server";
import { internalMutation, internalQuery, mutation } from "../lib/functions";
import { detectEvidenceLibraryUploadContent } from "../../lib/evidence-libraries/configuration/uploads";
import { rateLimit } from "../lib/rateLimit";
import { FILE_IDLE_MS, MAX_FILE_NAME, MAX_FILES_PER_MESSAGE, MAX_IMAGE_BYTES, MAX_IMAGE_MB, MAX_PENDING_FILES, PENDING_FILE_MS } from "../../lib/assistant/files";

const FLAG = "assistant.enabled";
const HOUR = 60 * 60 * 1000;
/** Files one cleanup run deletes. */
const FORGET_FILES = 100;
/** How stale a file's last use is before a reply that sends it writes it down again. */
const TOUCH_AFTER_MS = 24 * 60 * 60 * 1000;

const pendingOf = (ctx: QueryCtx, userId: Id<"users">) =>
  ctx.db.query("assistantFiles").withIndex("by_user_and_state", (q) => q.eq("userId", userId).eq("state", "pending"));

export const uploadUrl = mutation({
  args: { name: v.string() },
  returns: v.object({ fileId: v.id("assistantFiles"), url: v.string() }),
  handler: async (ctx, { name }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    const clean = name.trim().slice(0, MAX_FILE_NAME);
    if (!clean) throw createError("VALIDATION_ERROR", "A file needs a name.");
    if ((await pendingOf(ctx, userId).take(MAX_PENDING_FILES)).length >= MAX_PENDING_FILES) {
      throw createError("VALIDATION_ERROR", `You can have up to ${MAX_PENDING_FILES} files waiting to be sent. Send or remove some first.`);
    }
    const perHour = await planLimit(ctx, userId, "uploads_per_hour");
    if (perHour !== undefined) {
      const { ok, retryAt } = await rateLimit(ctx, { name: "assistant-upload", key: userId, config: { kind: "token bucket", rate: perHour, period: HOUR, capacity: perHour } });
      if (!ok) {
        const minutes = Math.max(1, Math.ceil(((retryAt ?? Date.now()) - Date.now()) / 60_000));
        throw createError("VALIDATION_ERROR", `Your plan lets you attach ${perHour} files an hour. You can attach more in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`);
      }
    }
    const now = Date.now();
    const fileId = await ctx.db.insert("assistantFiles", { userId, name: clean, bytes: 0, mediaType: "", state: "pending", usedAt: now });
    return { fileId, url: await ctx.storage.generateUploadUrl() };
  },
});

/**
 * Binds what the person's browser uploaded to its row, once its bytes say it's an image: the
 * type the browser sent with it isn't trusted. Reading the bytes needs an action; the checks
 * and the write are `claim`'s, which runs before the bytes are read, so a file that isn't
 * the person's is never touched, and again with what they were.
 */
export const ready = action({
  args: { fileId: v.id("assistantFiles"), storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, { fileId, storageId }) => {
    await ctx.runMutation(internal.assistant.files.claim, { fileId, storageId });
    const blob = await ctx.storage.get(storageId);
    const kind = blob ? detectEvidenceLibraryUploadContent(new Uint8Array(await blob.slice(0, 16).arrayBuffer())) : null;
    const refused = await ctx.runMutation(internal.assistant.files.claim, { fileId, storageId, read: { mediaType: (kind && IMAGE_TYPES[kind]) ?? null, bytes: blob?.size ?? 0 } });
    if (refused) throw createError("VALIDATION_ERROR", refused);
    return null;
  },
});

/** The image types a file can be, by what its bytes start with. */
const IMAGE_TYPES: Partial<Record<string, string>> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

export const claim = internalMutation({
  args: { fileId: v.id("assistantFiles"), storageId: v.id("_storage"), read: v.optional(v.object({ mediaType: v.union(v.string(), v.null()), bytes: v.number() })) },
  // Why a file that was read is refused, once it and its row are deleted: throwing here would undo the deletes.
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { fileId, storageId, read }) => {
    const userId = (await requireAuth(ctx))._id;
    const file = await ctx.db.get("assistantFiles", fileId);
    if (!file || file.userId !== userId || file.state !== "pending" || file.storageId) throw createError("NOT_FOUND", "That upload isn't waiting for a file.");
    const stored = await ctx.db.system.get(storageId);
    // Stored after its row was made, and no one else's.
    const claimed = await ctx.db.query("assistantFiles").withIndex("by_storage", (q) => q.eq("storageId", storageId)).first();
    if (!stored || stored._creationTime < file._creationTime || claimed) throw createError("NOT_FOUND", "That upload isn't yours to attach.");
    if (!read) return null;
    const refuse = async (message: string) => {
      await ctx.storage.delete(storageId);
      await ctx.db.delete("assistantFiles", fileId);
      return message;
    };
    if (!read.mediaType) return await refuse("Only images can be attached for now.");
    if (read.bytes > MAX_IMAGE_BYTES) return await refuse(`An image can be up to ${MAX_IMAGE_MB} MB.`);
    await ctx.db.patch("assistantFiles", fileId, { storageId, bytes: read.bytes, mediaType: read.mediaType, usedAt: Date.now() });
    return null;
  },
});

export const remove = mutation({
  args: { fileId: v.id("assistantFiles") },
  returns: v.null(),
  handler: async (ctx, { fileId }) => {
    const userId = (await requireAuth(ctx))._id;
    const file = await ctx.db.get("assistantFiles", fileId);
    // Gone already, or sent: a sent file goes with its chat.
    if (!file || file.userId !== userId || file.state !== "pending") return null;
    await deleteFile(ctx, file);
    return null;
  },
});

async function deleteFile(ctx: MutationCtx, file: Doc<"assistantFiles">) {
  if (file.storageId) await ctx.storage.delete(file.storageId);
  await ctx.db.delete("assistantFiles", file._id);
}

/**
 * The person's files for the message they're sending, as the parts the model reads with
 * it: each an image they attached and haven't sent. Refuses the lot if any isn't. Call
 * `sent` with the message's ID once it's saved.
 */
export async function partsFor(ctx: MutationCtx, userId: Id<"users">, fileIds: Id<"assistantFiles">[]): Promise<FilePart[]> {
  const ids = [...new Set(fileIds)];
  if (ids.length > MAX_FILES_PER_MESSAGE) throw createError("VALIDATION_ERROR", `A message can carry up to ${MAX_FILES_PER_MESSAGE} files.`);
  const parts: FilePart[] = [];
  for (const id of ids) {
    const file = await ctx.db.get("assistantFiles", id);
    if (!file || file.userId !== userId || file.state !== "pending") throw createError("NOT_FOUND", "One of the files is no longer attached. Attach it again.");
    const url = file.storageId ? await ctx.storage.getUrl(file.storageId) : null;
    if (!url) throw createError("CONFLICT", `${file.name} is still uploading.`);
    // The model is sent the file itself, found by this ID (`withFiles`); the address is the chat's.
    parts.push({ type: "file", data: url, mediaType: file.mediaType, filename: file.name, providerOptions: { openscholar: { fileId: id } } });
  }
  return parts;
}

/** Binds the files a message carried to it and its chat. */
export async function sent(ctx: MutationCtx, fileIds: Id<"assistantFiles">[], to: { threadId: Id<"assistantThreads">; messageId: string }) {
  const now = Date.now();
  for (const id of new Set(fileIds)) await ctx.db.patch("assistantFiles", id, { ...to, state: "sent", usedAt: now });
}

/** A file as a message shows it: its name and size, and where its picture is unless it expired. */
export async function filesOf(ctx: QueryCtx, messageId: string) {
  const files = await ctx.db.query("assistantFiles").withIndex("by_message", (q) => q.eq("messageId", messageId)).take(MAX_FILES_PER_MESSAGE);
  return await Promise.all(
    files.map(async (file) => ({
      id: file._id,
      name: file.name,
      bytes: file.bytes,
      mediaType: file.mediaType,
      url: file.storageId ? await ctx.storage.getUrl(file.storageId) : null,
    })),
  );
}

/** The file of ours a part is, by the ID `partsFor` gave it. */
const fileIdOf = (part: FilePart) => (part.providerOptions?.openscholar as { fileId?: Id<"assistantFiles"> } | undefined)?.fileId;

/**
 * The messages a reply sends, with each file of ours read from storage and sent as it is,
 * so the provider never fetches our addresses. One that expired is replaced by a line
 * that says so. The files sent are noted as used, so they don't expire while a chat that
 * reads them is in use.
 */
export async function withFiles(ctx: Pick<ActionCtx, "storage" | "runQuery" | "runMutation">, messages: ModelMessage[]): Promise<ModelMessage[]> {
  const fileIds = messages.flatMap((message) => (message.role === "user" && typeof message.content !== "string" ? message.content.flatMap((part) => (part.type === "file" && fileIdOf(part) ? [fileIdOf(part)!] : [])) : []));
  if (!fileIds.length) return messages;
  const stored = new Map((await ctx.runQuery(internal.assistant.files.stored, { fileIds })).map((file) => [file.fileId, file.storageId]));
  const used: Id<"assistantFiles">[] = [];
  const out = await Promise.all(
    messages.map(async (message) => {
      if (message.role !== "user" || typeof message.content === "string") return message;
      const content = await Promise.all(
        message.content.map(async (part): Promise<(typeof message.content)[number]> => {
          const fileId = part.type === "file" ? fileIdOf(part) : undefined;
          if (part.type !== "file" || !fileId) return part;
          const storageId = stored.get(fileId);
          const blob = storageId ? await ctx.storage.get(storageId) : null;
          if (!blob) return { type: "text", text: "[An image the person attached here has expired. Ask them to attach it again if you need it.]" } satisfies TextPart;
          used.push(fileId);
          return { type: "file", data: new Uint8Array(await blob.arrayBuffer()), mediaType: part.mediaType, filename: part.filename };
        }),
      );
      return { ...message, content };
    }),
  );
  if (used.length) await ctx.runMutation(internal.assistant.files.touch, { fileIds: used });
  return out;
}

/** Where each of these files' bytes are, or null for one that expired or went. */
export const stored = internalQuery({
  args: { fileIds: v.array(v.id("assistantFiles")) },
  returns: v.array(v.object({ fileId: v.id("assistantFiles"), storageId: v.union(v.id("_storage"), v.null()) })),
  handler: async (ctx, { fileIds }) => {
    const ids = [...new Set(fileIds)];
    const files = await Promise.all(ids.map((id) => ctx.db.get("assistantFiles", id)));
    return ids.map((fileId, i) => ({ fileId, storageId: files[i]?.storageId ?? null }));
  },
});

export const touch = internalMutation({
  args: { fileIds: v.array(v.id("assistantFiles")) },
  returns: v.null(),
  handler: async (ctx, { fileIds }) => {
    const now = Date.now();
    for (const id of new Set(fileIds)) {
      const file = await ctx.db.get("assistantFiles", id);
      if (file && file.usedAt < now - TOUCH_AFTER_MS) await ctx.db.patch("assistantFiles", id, { usedAt: now });
    }
    return null;
  },
});

/** Deletes a deleted chat's files, a batch at a time. */
export const forget = internalMutation({
  args: { threadId: v.id("assistantThreads") },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const files = await ctx.db.query("assistantFiles").withIndex("by_thread", (q) => q.eq("threadId", threadId)).take(FORGET_FILES);
    for (const file of files) await deleteFile(ctx, file);
    if (files.length === FORGET_FILES) await ctx.scheduler.runAfter(0, internal.assistant.files.forget, { threadId });
    return null;
  },
});

/** Deletes a batch of a purged account's files, wherever they were sent. Returns whether all are gone. */
export async function purgeFiles(ctx: MutationCtx, userId: Id<"users">) {
  let left = FORGET_FILES;
  for (const state of ["pending", "sent", "expired"] as const) {
    const files = await ctx.db.query("assistantFiles").withIndex("by_user_and_state", (q) => q.eq("userId", userId).eq("state", state)).take(left);
    for (const file of files) await deleteFile(ctx, file);
    left -= files.length;
    if (left === 0) return false;
  }
  return true;
}

/**
 * Daily: a sent file no reply has used for 30 days loses its bytes, and a file attached and
 * never sent goes after a day. A batch at a time, each run carrying on until none are due.
 */
export const expire = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const idle = await ctx.db.query("assistantFiles").withIndex("by_state_and_usedAt", (q) => q.eq("state", "sent").lt("usedAt", now - FILE_IDLE_MS)).take(FORGET_FILES);
    for (const file of idle) {
      if (file.storageId) await ctx.storage.delete(file.storageId);
      await ctx.db.patch("assistantFiles", file._id, { state: "expired", storageId: undefined });
    }
    const unsent = await ctx.db.query("assistantFiles").withIndex("by_state_and_usedAt", (q) => q.eq("state", "pending").lt("usedAt", now - PENDING_FILE_MS)).take(FORGET_FILES);
    for (const file of unsent) await deleteFile(ctx, file);
    if (idle.length === FORGET_FILES || unsent.length === FORGET_FILES) await ctx.scheduler.runAfter(0, internal.assistant.files.expire, {});
    return null;
  },
});
