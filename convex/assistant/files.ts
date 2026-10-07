/**
 * Files people attach to assistant chats (#647).
 *
 * An upload starts with `startUpload`, which counts it against the person's plan and makes
 * the file's row, keyed by the digest of a one-time token only their browser holds. The
 * browser then posts the bytes to `upload` with the token, and the server stores them itself
 * once they read as an image or text. A PDF, larger than one request takes, comes in parts on
 * the same token, each stored and kept on the row as it arrives, then joined (./pdf.ts). So
 * every file of ours is one the server stored for that row:
 * an image's address shows its storage ID to anyone in the chat, and storage another part of
 * the app keeps (an author's photo, say) is never taken for an upload and deleted with it.
 *
 * A file is the person's until they send it, then their chat's, and goes with the chat or
 * their account. One no reply has sent to the model for 30 days loses its bytes and stays
 * as a name (`expire`), so its message says it expired and the model is told so.
 *
 *   startUpload   a file's row, for the token whose digest it's given
 *   upload        (HTTP) the bytes, stored once they read as an image or text; a PDF's, a part at a time
 *   remove        a file attached and not yet sent
 */
import { v, type Infer } from "convex/values";
import type { FilePart, ModelMessage, TextPart } from "ai";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { planLimit } from "../billing/accounts";
import { requireFeature } from "../featureFlags/guard";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { httpAction } from "../_generated/server";
import { internalMutation, internalQuery, mutation, query } from "../lib/functions";
import { SERVER_MODEL_SLUG } from "../ai/config";
import { detectEvidenceLibraryUploadContent } from "../../lib/evidence-libraries/configuration/uploads";
import { rateLimit } from "../lib/rateLimit";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { FILE_IDLE_MS, MAX_FILE_NAME, MAX_FILES_PER_MESSAGE, MAX_IMAGE_BYTES, MAX_IMAGE_MB, MAX_PDF_BYTES, MAX_PDF_CHUNKS, MAX_PDF_MB, MAX_PENDING_FILES, PDF_CHUNK_BYTES, PDF_CUTS_PER_HOUR, MAX_TEXT_BYTES, MAX_TEXT_MB, PDF_PAGE_TOKENS, PDF_PAGES_PER_READ, PENDING_FILE_MS, TEXT_CHARS_PER_READ, TEXT_LINES_PER_READ, isPdf, isText, linesIn, pagesIn, readsImages, readsPdfs } from "../../lib/assistant/files";
import { convertUsdToCredits } from "../../lib/pricing";
import { pricingOf } from "../ai/serverModel";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { requireThread } from "./access";
import { MODEL_READS } from "./steps";
import { citedFileIdsValidator, citedFilesValidator } from "./validators";
import { chatModel } from "./threads";

const FLAG = "assistant.enabled";
const HOUR = 60 * 60 * 1000;
/** Files one cleanup run deletes. */
const FORGET_FILES = 100;
/** How stale a file's last use is before a reply that sends it writes it down again. */
const TOUCH_AFTER_MS = 24 * 60 * 60 * 1000;
/** How long a file attached and not sent counts as a draft still open somewhere, before a new upload may take its place. */
const ABANDONED_MS = 60 * 60 * 1000;
/** How long an upload's token can be used: a PDF's, for all its parts, longer. */
const UPLOAD_TOKEN_MS = 15 * 60 * 1000;
const PDF_UPLOAD_MS = 60 * 60 * 1000;

const pendingOf = (ctx: QueryCtx, userId: Id<"users">) =>
  ctx.db.query("assistantFiles").withIndex("by_user_and_state", (q) => q.eq("userId", userId).eq("state", "pending"));

export const startUpload = mutation({
  // `digest`: the SHA-256 of the token the browser posts the file's bytes with (convex/lib/opaqueTokenDigest.ts).
  // A PDF (#648): `pdfBytes`, its size; it comes in parts (lib/assistant/files.ts `PDF_CHUNK_BYTES`).
  // A text file (plain text, Markdown, CSV): `text`, its type, which the upload route holds it to.
  args: { name: v.string(), digest: v.string(), pdfBytes: v.optional(v.number()), text: v.optional(v.union(v.literal("text/plain"), v.literal("text/markdown"), v.literal("text/csv"))) },
  returns: v.object({ fileId: v.id("assistantFiles") }),
  handler: async (ctx, { name, digest, pdfBytes, text }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireFeature(ctx, FLAG, userId);
    if (!/^[0-9a-f]{64}$/.test(digest)) throw createError("VALIDATION_ERROR", "An upload needs a SHA-256 digest.");
    if (pdfBytes !== undefined && pdfBytes > MAX_PDF_BYTES) throw createError("VALIDATION_ERROR", `A PDF can be up to ${MAX_PDF_MB} MB.`);
    const clean = name.trim().slice(0, MAX_FILE_NAME);
    if (!clean) throw createError("VALIDATION_ERROR", "A file needs a name.");
    // At the limit, the oldest file left unsent for an hour makes room: a draft lost to a reload or a closed tab holds its place until then.
    const pending = await pendingOf(ctx, userId).take(MAX_PENDING_FILES);
    if (pending.length >= MAX_PENDING_FILES) {
      const oldest = pending.reduce((a, b) => (a._creationTime <= b._creationTime ? a : b));
      if (oldest._creationTime > Date.now() - ABANDONED_MS) throw createError("VALIDATION_ERROR", `You can have up to ${MAX_PENDING_FILES} files waiting to be sent. Send or remove some first.`);
      await deleteFile(ctx, oldest);
    }
    const perHour = await planLimit(ctx, userId, "uploads_per_hour");
    if (perHour !== undefined) {
      const { ok, retryAt } = await rateLimit(ctx, { name: "assistant-upload", key: userId, config: { kind: "token bucket", rate: perHour, period: HOUR, capacity: perHour } });
      if (!ok) {
        const minutes = Math.max(1, Math.ceil(((retryAt ?? Date.now()) - Date.now()) / 60_000));
        throw createError("VALIDATION_ERROR", `Your plan lets you attach ${perHour} files an hour. You can attach more in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`);
      }
    }
    const mediaType = pdfBytes !== undefined ? "application/pdf" : (text ?? "");
    return { fileId: await ctx.db.insert("assistantFiles", { userId, name: clean, bytes: 0, mediaType, state: "pending", usedAt: Date.now(), uploadDigest: digest }) };
  },
});

/** A PDF's parts, in order, for ./pdf.ts to join. */
export const chunksOf = internalQuery({
  args: { fileId: v.id("assistantFiles") },
  returns: v.array(v.id("_storage")),
  handler: async (ctx, { fileId }) => (await ctx.db.get("assistantFiles", fileId))?.chunks ?? [],
});

/**
 * Binds a PDF its parts were joined into, with how many pages it has, and deletes the parts.
 * A file removed meanwhile takes the joined PDF with it. Returns rather than throws, so a
 * delete here is never undone.
 */
export const joinChunks = internalMutation({
  args: { fileId: v.id("assistantFiles"), storageId: v.id("_storage"), pages: v.number(), bytes: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { fileId, storageId, pages, bytes }) => {
    const file = await ctx.db.get("assistantFiles", fileId);
    if (!file || file.state !== "pending" || file.storageId) {
      await ctx.storage.delete(storageId);
      return false;
    }
    for (const chunk of file.chunks ?? []) await ctx.storage.delete(chunk);
    await ctx.db.patch("assistantFiles", fileId, { storageId, pages, bytes, chunks: undefined, usedAt: Date.now() });
    return true;
  },
});

/** The image types a file can be, by what its bytes start with. */
const IMAGE_TYPES: Partial<Record<string, string>> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

/** The upload is any page's: what lets it in is the token, never a cookie. */
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export const uploadOptions = httpAction(async () => new Response(null, { status: 204, headers: CORS }));

/**
 * Takes a file's bytes for the token its row was made for, once: they're stored by the
 * server, so the file is one only that row holds. Bytes that don't read as an image or text,
 * or are too large, are refused, and the row goes with them. A PDF's come a part at a time
 * (`part`, from 0, and `last`), each kept on the row as it arrives; the last joins them.
 */
export const upload = httpAction(async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const token = params.get("token");
  const part = Number(params.get("part") ?? Number.NaN);
  const last = params.get("last") === "1";
  const redeemed = token ? await ctx.runMutation(internal.assistant.files.redeem, { digest: await digestOpaqueToken(token), ...(Number.isInteger(part) ? { part } : {}), last }) : null;
  if (!redeemed) return reply(410, { error: "This upload has expired. Attach the file again." });
  const { fileId, text, pdf } = redeemed;
  if (pdf) return await uploadPart(ctx, request, { fileId, part, last, stored: pdf.stored });
  const most = text ? MAX_TEXT_BYTES : MAX_IMAGE_BYTES;
  const declared = Number(request.headers.get("content-length") ?? 0);
  const bytes = declared > most ? null : new Uint8Array(await request.arrayBuffer());
  // A text file has to read as UTF-8, and an image as one of the types its first bytes name.
  const lines = text && bytes ? linesOf(bytes) : undefined;
  const mediaType = !bytes ? undefined : text ? (lines === null ? undefined : text) : IMAGE_TYPES[detectEvidenceLibraryUploadContent(bytes.subarray(0, 16)) ?? ""];
  const refused = !bytes || bytes.byteLength > most ? (text ? `A text file can be up to ${MAX_TEXT_MB} MB.` : `An image can be up to ${MAX_IMAGE_MB} MB.`) : !mediaType ? (text ? "This file isn't plain text." : "Only images, PDFs and text files can be attached.") : null;
  if (refused) {
    await ctx.runMutation(internal.assistant.files.drop, { fileId });
    return reply(400, { error: refused });
  }
  const storageId = await ctx.storage.store(new Blob([bytes!], { type: mediaType }));
  // Bytes no row holds would never be deleted, so a bind that fails takes them with it.
  const kept = await ctx.runMutation(internal.assistant.files.bind, { fileId, storageId, bytes: bytes!.byteLength, mediaType: mediaType!, ...(lines ? { lines } : {}) }).catch(async (error: unknown) => {
    await ctx.storage.delete(storageId);
    throw error;
  });
  return kept ? reply(200, { fileId, ...(lines ? { lines } : {}) }) : reply(410, { error: "This file was removed." });
});

/** How many lines UTF-8 text has, or null when the bytes aren't UTF-8 text. */
function linesOf(bytes: Uint8Array) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\u0000")) return null;
    return text.length ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
  } catch {
    return null;
  }
}

/** One part of a PDF: stored and kept on its row, and with the last, the parts joined into the PDF. */
async function uploadPart(ctx: ActionCtx, request: Request, { fileId, part, last, stored }: { fileId: Id<"assistantFiles">; part: number; last: boolean; stored: number }) {
  const room = Math.min(PDF_CHUNK_BYTES, MAX_PDF_BYTES - stored);
  const declared = Number(request.headers.get("content-length") ?? 0);
  const bytes = declared > room ? null : new Uint8Array(await request.arrayBuffer());
  if (!bytes || bytes.byteLength > room) {
    await ctx.runMutation(internal.assistant.files.drop, { fileId });
    return reply(400, { error: `A PDF can be up to ${MAX_PDF_MB} MB.` });
  }
  const storageId = await ctx.storage.store(new Blob([bytes], { type: "application/pdf" }));
  const kept = await ctx.runMutation(internal.assistant.files.addChunk, { fileId, storageId, part, bytes: bytes.byteLength }).catch(async (error: unknown) => {
    await ctx.storage.delete(storageId);
    throw error;
  });
  if (!kept) return reply(410, { error: "This file was removed." });
  if (!last) return reply(200, { fileId });
  const joined = await ctx.runAction(internal.assistant.pdf.join, { fileId });
  return "pages" in joined ? reply(200, { fileId, pages: joined.pages }) : reply(400, { error: joined.error });
}

/** Keeps a PDF's part on its row, after the ones before it. One for a row that's gone, or out of turn, is deleted. */
export const addChunk = internalMutation({
  args: { fileId: v.id("assistantFiles"), storageId: v.id("_storage"), part: v.number(), bytes: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { fileId, storageId, part, bytes }) => {
    const file = await ctx.db.get("assistantFiles", fileId);
    const chunks = file?.chunks ?? [];
    if (!file || file.state !== "pending" || file.storageId || chunks.length !== part || chunks.length >= MAX_PDF_CHUNKS) {
      await ctx.storage.delete(storageId);
      return false;
    }
    await ctx.db.patch("assistantFiles", fileId, { chunks: [...chunks, storageId], bytes: file.bytes + bytes });
    return true;
  },
});

/** The pending file a token was made for, once: the token can't be used again. A PDF's is used for each of its parts in turn, and spent with the last. */
export const redeem = internalMutation({
  args: { digest: v.string(), part: v.optional(v.number()), last: v.optional(v.boolean()) },
  returns: v.union(v.object({ fileId: v.id("assistantFiles"), text: v.optional(v.string()), pdf: v.optional(v.object({ stored: v.number() })) }), v.null()),
  handler: async (ctx, { digest, part, last }) => {
    const file = await ctx.db.query("assistantFiles").withIndex("by_uploadDigest", (q) => q.eq("uploadDigest", digest)).unique();
    const pdf = file ? isPdf(file.mediaType) : false;
    if (!file || file.state !== "pending" || file.storageId || file._creationTime < Date.now() - (pdf ? PDF_UPLOAD_MS : UPLOAD_TOKEN_MS)) return null;
    if (pdf && part !== (file.chunks?.length ?? 0)) return null;
    if (!pdf || last) await ctx.db.patch("assistantFiles", file._id, { uploadDigest: undefined });
    return { fileId: file._id, ...(isText(file.mediaType) ? { text: file.mediaType } : {}), ...(pdf ? { pdf: { stored: file.bytes } } : {}) };
  },
});

/** Binds the bytes the server stored to their file. A file removed while its bytes were on the way takes them with it. */
export const bind = internalMutation({
  args: { fileId: v.id("assistantFiles"), storageId: v.id("_storage"), bytes: v.number(), mediaType: v.string(), lines: v.optional(v.number()) },
  returns: v.boolean(),
  handler: async (ctx, { fileId, storageId, bytes, mediaType, lines }) => {
    const file = await ctx.db.get("assistantFiles", fileId);
    if (!file || file.state !== "pending" || file.storageId) {
      await ctx.storage.delete(storageId);
      return false;
    }
    await ctx.db.patch("assistantFiles", fileId, { storageId, bytes, mediaType, ...(lines === undefined ? {} : { lines }), usedAt: Date.now() });
    return true;
  },
});

export const drop = internalMutation({
  args: { fileId: v.id("assistantFiles") },
  returns: v.null(),
  handler: async (ctx, { fileId }) => {
    const file = await ctx.db.get("assistantFiles", fileId);
    if (file) await deleteFile(ctx, file);
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
  for (const chunk of file.chunks ?? []) await ctx.storage.delete(chunk);
  await ctx.db.delete("assistantFiles", file._id);
}

/**
 * The person's files for the message they're sending, as the parts the model reads with
 * it: each an image they attached and haven't sent. Refuses the lot if any isn't. Call
 * `sent` with the message's ID once it's saved.
 */
export async function partsFor(ctx: MutationCtx, userId: Id<"users">, fileIds: Id<"assistantFiles">[]) {
  const ids = [...new Set(fileIds)];
  if (ids.length > MAX_FILES_PER_MESSAGE) throw createError("VALIDATION_ERROR", `A message can carry up to ${MAX_FILES_PER_MESSAGE} files.`);
  const parts: Array<FilePart | TextPart> = [];
  let images = false;
  let pdfs = false;
  for (const id of ids) {
    const file = await ctx.db.get("assistantFiles", id);
    if (!file || file.userId !== userId || file.state !== "pending") throw createError("NOT_FOUND", "One of the files is no longer attached. Attach it again.");
    const url = file.storageId ? await ctx.storage.getUrl(file.storageId) : null;
    if (!url) throw createError("CONFLICT", `${file.name} is still uploading.`);
    if (isPdf(file.mediaType)) {
      // A PDF isn't sent whole with every request: the model reads the pages it needs, when the person allows it (`read`).
      pdfs = true;
      parts.push({ type: "text", text: `[The person attached a PDF, "${file.name}", ${file.pages ?? "?"} pages, file ID ${id}. Read its pages with assistant_files_read.]` });
      continue;
    }
    if (isText(file.mediaType)) {
      // Nor is a text file: a CSV can be much longer than a chat.
      parts.push({ type: "text", text: `[The person attached a ${file.mediaType === "text/csv" ? "CSV" : file.mediaType === "text/markdown" ? "Markdown" : "text"} file, "${file.name}", ${file.lines ?? "?"} lines, file ID ${id}. Read its lines with assistant_files_read.]` });
      continue;
    }
    images = true;
    // The model is sent the file itself, found by this ID (`withFiles`); the address is the chat's.
    parts.push({ type: "file", data: url, mediaType: file.mediaType, filename: file.name, providerOptions: { openscholar: { fileId: id } } });
  }
  return { parts, images, pdfs };
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
      ...(file.pages === undefined ? {} : { pages: file.pages }),
      ...(file.lines === undefined ? {} : { lines: file.lines }),
    })),
  );
}

/**
 * PDFs of this chat its replies cite, by the IDs their citations name, when the messages that
 * carried them aren't loaded in the panel: their names, and where they are unless they expired.
 * IDs that aren't one of the chat's PDFs are left out.
 */
export const cited = query({
  args: { threadId: v.id("assistantThreads"), fileIds: citedFileIdsValidator },
  returns: citedFilesValidator,
  handler: async (ctx, { threadId, fileIds }) => {
    const userId = (await requireAuth(ctx))._id;
    await requireThread(ctx, userId, threadId);
    const files = await Promise.all(
      fileIds.slice(0, MAX_FILES_PER_MESSAGE).map((id) => {
        const fileId = ctx.db.normalizeId("assistantFiles", id);
        return fileId ? ctx.db.get("assistantFiles", fileId) : null;
      }),
    );
    const pdfs = files.filter((file): file is Doc<"assistantFiles"> => file?.threadId === threadId && !file.parentId && isPdf(file.mediaType));
    return await Promise.all(pdfs.map(async (file) => ({ id: file._id, name: file.name, url: file.storageId ? await ctx.storage.getUrl(file.storageId) : null })));
  },
});

/** The file of ours a part is, by the ID `partsFor` gave it. */
const fileIdOf = (part: FilePart) => (part.providerOptions?.openscholar as { fileId?: Id<"assistantFiles"> } | undefined)?.fileId;

/**
 * The messages a reply sends, with each file of ours read from storage and sent as it is,
 * so the provider never fetches our addresses. One that expired is replaced by a line
 * that says so. The files sent are noted as used, so they don't expire while a chat that
 * reads them is in use.
 */
export async function withFiles(ctx: Pick<ActionCtx, "storage" | "runQuery" | "runMutation">, messages: ModelMessage[], modelId: Id<"models"> | null): Promise<ModelMessage[]> {
  const fileIds = messages.flatMap((message) => {
    if (message.role === "user" && typeof message.content !== "string") return message.content.flatMap((part) => (part.type === "file" && fileIdOf(part) ? [fileIdOf(part)!] : []));
    if (message.role === "tool") return message.content.flatMap((part) => (part.type === "tool-result" && pagesOf(part.output) ? [pagesOf(part.output)!] : []));
    return [];
  });
  if (!fileIds.length) return messages;
  const read = await ctx.runQuery(internal.assistant.files.stored, { fileIds, modelId });
  const stored = new Map(read.files.map((file) => [file.fileId, file.storageId]));
  const bytesOf = async (fileId: Id<"assistantFiles">) => {
    const storageId = stored.get(fileId);
    const blob = storageId ? await ctx.storage.get(storageId) : null;
    if (blob) used.push(fileId);
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  };
  const used: Id<"assistantFiles">[] = [];
  const out = await Promise.all(
    messages.map(async (message): Promise<ModelMessage> => {
      if (message.role === "tool") {
        const content = await Promise.all(
          message.content.map(async (part): Promise<(typeof message.content)[number]> => {
            const fileId = part.type === "tool-result" ? pagesOf(part.output) : null;
            if (part.type !== "tool-result" || !fileId) return part;
            const said = JSON.stringify((part.output as { value: unknown }).value);
            // The pages a read cut from a PDF, sent as they are: text, tables and figures.
            const bytes = read.pdfs ? await bytesOf(fileId) : null;
            if (!bytes) return { ...part, output: { type: "text", value: `${said}\n[These pages ${read.pdfs ? "have expired. Read them again if you need them" : "can't be shown to the model this chat now runs on, which doesn't read PDFs"}.]` } };
            return { ...part, output: { type: "content", value: [{ type: "text", text: said }, { type: "file", mediaType: "application/pdf", data: { type: "data", data: bytes }, filename: "pages.pdf" }] } };
          }),
        );
        return { ...message, content };
      }
      if (message.role !== "user" || typeof message.content === "string") return message;
      const content = await Promise.all(
        message.content.map(async (part): Promise<(typeof message.content)[number]> => {
          const fileId = part.type === "file" ? fileIdOf(part) : undefined;
          if (part.type !== "file" || !fileId) return part;
          // A chat moved to a model that takes no images after they were sent.
          if (!read.images) return { type: "text", text: "[The person attached an image here, but the model this chat runs on now can't see images.]" } satisfies TextPart;
          const bytes = await bytesOf(fileId);
          if (!bytes) return { type: "text", text: "[An image the person attached here has expired. Ask them to attach it again if you need it.]" } satisfies TextPart;
          return { type: "file", data: bytes, mediaType: part.mediaType, filename: part.filename };
        }),
      );
      return { ...message, content };
    }),
  );
  if (used.length) await ctx.runMutation(internal.assistant.files.touch, { fileIds: used });
  return out;
}

/** The pages a read of a PDF cut (`readPdf`), by the file ID its result names. */
function pagesOf(output: unknown): Id<"assistantFiles"> | null {
  const value = output && typeof output === "object" && "type" in output && output.type === "json" && "value" in output ? (output.value as { pdfPages?: unknown } | null) : null;
  return value && typeof value === "object" && typeof value.pdfPages === "string" ? (value.pdfPages as Id<"assistantFiles">) : null;
}

/** Where each of these files' bytes are, or null for one that expired or went, and whether the model they'd go to takes images and PDFs. */
export const stored = internalQuery({
  args: { fileIds: v.array(v.id("assistantFiles")), modelId: v.union(v.id("models"), v.null()) },
  returns: v.object({ files: v.array(v.object({ fileId: v.id("assistantFiles"), storageId: v.union(v.id("_storage"), v.null()) })), images: v.boolean(), pdfs: v.boolean() }),
  handler: async (ctx, { fileIds, modelId }) => {
    const ids = [...new Set(fileIds)];
    const files = await Promise.all(ids.map((id) => ctx.db.get("assistantFiles", id)));
    const model = modelId ? await ctx.db.get("models", modelId) : await ctx.db.query("models").withIndex("by_model_id", (q) => q.eq("modelId", SERVER_MODEL_SLUG)).unique();
    return { files: ids.map((fileId, i) => ({ fileId, storageId: files[i]?.storageId ?? null })), images: readsImages(model?.inputModalities), pdfs: readsPdfs(model?.inputModalities) };
  },
});

/** Notes these files as used, so they don't expire. Pages cut from a PDF keep the PDF too, which their citations open. */
export const touch = internalMutation({
  args: { fileIds: v.array(v.id("assistantFiles")) },
  returns: v.null(),
  handler: async (ctx, { fileIds }) => {
    const now = Date.now();
    for (const id of new Set(fileIds)) {
      const file = await ctx.db.get("assistantFiles", id);
      const pdf = file?.parentId ? await ctx.db.get("assistantFiles", file.parentId) : null;
      for (const one of [file, pdf]) if (one && one.usedAt < now - TOUCH_AFTER_MS) await ctx.db.patch("assistantFiles", one._id, { usedAt: now });
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
 * Hourly: a sent file no reply has used for 30 days loses its bytes, and a file attached and
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

/**
 * Before a read cuts pages from a PDF: the same pages, when a read already cut them, to send
 * again. Otherwise it counts against the person's cuts this hour, and refuses past them.
 */
export const cutting = internalMutation({
  args: { userId: v.id("users"), fileId: v.id("assistantFiles"), range: v.string() },
  returns: v.union(v.id("assistantFiles"), v.null()),
  handler: async (ctx, { userId, fileId, range }) => {
    const done = await ctx.db.query("assistantFiles").withIndex("by_parent_and_range", (q) => q.eq("parentId", fileId).eq("range", range)).first();
    if (done?.storageId) return done._id;
    const { ok, retryAt } = await rateLimit(ctx, { name: "assistant-pdf-cut", key: userId, config: { kind: "token bucket", rate: PDF_CUTS_PER_HOUR, period: HOUR, capacity: PDF_CUTS_PER_HOUR } });
    if (ok) return null;
    const minutes = Math.max(1, Math.ceil(((retryAt ?? Date.now()) - Date.now()) / 60_000));
    throw createError("VALIDATION_ERROR", `Up to ${PDF_CUTS_PER_HOUR} reads of PDF pages can run an hour. More can in ${minutes} ${minutes === 1 ? "minute" : "minutes"}; pages already read can be read again now.`);
  },
});

/** Pages a read cut from a PDF, kept as a file of the PDF's chat: deleted with it, and expired as it is. Null, with the pages deleted, once the PDF is gone. */
export const addPart = internalMutation({
  args: { fileId: v.id("assistantFiles"), storageId: v.id("_storage"), range: v.string(), bytes: v.number() },
  returns: v.union(v.id("assistantFiles"), v.null()),
  handler: async (ctx, { fileId, storageId, range, bytes }) => {
    const pdf = await ctx.db.get("assistantFiles", fileId);
    if (!pdf?.threadId) {
      // Returned, not thrown: a throw would undo the delete.
      await ctx.storage.delete(storageId);
      return null;
    }
    return await ctx.db.insert("assistantFiles", { userId: pdf.userId, threadId: pdf.threadId, storageId, name: `${pdf.name}, pages ${range}`, bytes, mediaType: "application/pdf", state: "sent", usedAt: Date.now(), parentId: fileId, range });
  },
});

/**
 * What a read of an attached file takes, and what it comes to on the chat's model, or why it
 * can't: the model is told before the person is asked. A PDF is read by pages, at most 20 at a
 * time, the first 20 when it names none; a text file by lines, as many whole lines as fit in
 * what one read returns, the first ones when it names none.
 */
async function readable(ctx: QueryCtx, userId: Id<"users">, { file: fileId, range }: { file: Id<"assistantFiles">; range?: string }) {
  const file = await ctx.db.get("assistantFiles", fileId);
  const thread = file?.threadId ? (await requireThread(ctx, userId, file.threadId).catch(() => null))?.thread : null;
  const pdf = file ? isPdf(file.mediaType) : false;
  if (!file || !thread || file.parentId || !(pdf || isText(file.mediaType))) throw createError("NOT_FOUND", "No PDF or text file attached to this chat has that file ID.");
  if (!file.storageId) throw createError("NOT_FOUND", `"${file.name}" has expired. Ask the person to attach it again.`);
  const { modelId } = await chatModel(ctx, thread, userId);
  const price = (await pricingOf(ctx, modelId)).input;
  if (pdf) {
    const of = file.pages ?? 0;
    const pages = pagesIn(range, of);
    if (!pages) throw createError("VALIDATION_ERROR", `"${file.name}" has ${of} pages. Ask for a range within them, such as "1-${Math.min(of, PDF_PAGES_PER_READ)}", at most ${PDF_PAGES_PER_READ} pages at a time.`);
    const model = modelId ? await ctx.db.get("models", modelId) : await ctx.db.query("models").withIndex("by_model_id", (q) => q.eq("modelId", SERVER_MODEL_SLUG)).unique();
    if (!readsPdfs(model?.inputModalities)) throw createError("VALIDATION_ERROR", "The model this chat runs on can't read PDFs. Tell the person to pick one that can.");
    return { file, of, ...pages, credits: convertUsdToCredits({ usd: ((pages.last - pages.first + 1) * PDF_PAGE_TOKENS * price) / 1_000_000 }) };
  }
  const of = file.lines ?? 0;
  const lines = linesIn(range, of);
  if (!lines) throw createError("VALIDATION_ERROR", `"${file.name}" has ${of} lines. Ask for a range within them, such as "1-${Math.min(of, TEXT_LINES_PER_READ)}".`);
  // The most one read returns, whatever its lines' lengths, at about four characters a token.
  const chars = Math.min(TEXT_CHARS_PER_READ, file.bytes);
  return { file, of, ...lines, credits: convertUsdToCredits({ usd: (Math.ceil(chars / 4) * price) / 1_000_000 }) };
}

export const readRange = internalQuery({
  args: { userId: v.id("users"), file: v.id("assistantFiles"), range: v.optional(v.string()) },
  returns: v.object({ storageId: v.id("_storage"), name: v.string(), pdf: v.boolean(), of: v.number(), first: v.number(), last: v.number() }),
  handler: async (ctx, { userId, ...args }) => {
    const { file, of, first, last } = await readable(ctx, userId, args);
    return { storageId: file.storageId!, name: file.name, pdf: isPdf(file.mediaType), of, first, last };
  },
});

/**
 * Lines `first` to `last` of a text file: as many whole lines as fit in `room` characters of
 * the result the model is sent, and where it stopped. A line longer than that comes as its
 * start, saying so.
 */
function linesFrom(text: string, first: number, last: number, room: number) {
  const all = text.split("\n").slice(first - 1, last);
  let size = 0;
  let taken = 0;
  // In the result, a line takes its escaped text and the "\n" that joins it to the next: its own JSON string's length.
  for (const line of all) {
    const cost = JSON.stringify(line).length;
    if (size + cost > room) break;
    size += cost;
    taken += 1;
  }
  if (taken) return { text: all.slice(0, taken).join("\n"), last: first + taken - 1 };
  const note = `\n[Line ${first} is longer than one read returns. This is its start; the rest of it can't be read.]`;
  let start = all[0].slice(0, room);
  while (JSON.stringify(start + note).length > room) start = start.slice(0, Math.floor(start.length * 0.9));
  return { text: start + note, last: first };
}

const readResult = v.object({
  file: v.id("assistantFiles"),
  name: v.string(),
  /** A PDF's pages, as "3-7", and how many it has; the pages themselves reach the model as they are (`withFiles`). */
  pages: v.optional(v.string()),
  pdfPages: v.optional(v.id("assistantFiles")),
  /** A text file's lines, as "1-480", and how many it has, with their text. */
  lines: v.optional(v.string()),
  text: v.optional(v.string()),
  of: v.number(),
});

export const readAction = defineUserAction({
  path: "assistant/files:read",
  description:
    "Reads part of a file the person attached to this chat, by the file ID its message gives. A PDF by pages: `range` such as \"3-7\", at most 20 at a time, the first 20 without one; you get the pages as they are, text, tables and figures. " +
    "A text, Markdown or CSV file by lines: `range` such as \"1-500\"; you get as many whole lines as fit in one read, and the result says the last one, so read on from there. " +
    "Read the parts you need, not the whole file at once, and cite what you take from a PDF by page. The person is asked first, with what the read costs.",
  args: { file: v.id("assistantFiles"), range: v.optional(v.string()) },
  returns: readResult,
  spendsCredits: true,
  outsideEffect: false,
  undoable: false,
  estimate: async (ctx, userId, args) => (await readable(ctx, userId, args)).credits,
  check: async (ctx, userId, args) => {
    await readable(ctx, userId, args);
  },
  run: async (ctx, userId, { file, range }): Promise<Infer<typeof readResult>> => {
    const read = await ctx.runQuery(internal.assistant.files.readRange, { userId, file, range });
    const span = (first: number, last: number) => (first === last ? `${first}` : `${first}-${last}`);
    // A file read is one in use: it doesn't expire while a chat reads it.
    await ctx.runMutation(internal.assistant.files.touch, { fileIds: [file] });
    if (read.pdf) {
      const pages = span(read.first, read.last);
      const pdfPages = (await ctx.runMutation(internal.assistant.files.cutting, { userId, fileId: file, range: pages })) ?? (await ctx.runAction(internal.assistant.pdf.cut, { fileId: file, storageId: read.storageId, first: read.first, last: read.last }));
      return { file, name: read.name, pages, pdfPages, of: read.of };
    }
    const blob = await ctx.storage.get(read.storageId);
    if (!blob) throw createError("NOT_FOUND", `"${read.name}" has expired. Ask the person to attach it again.`);
    // The lines get what's left of what a result carries to the model once the rest of it is in.
    const rest = JSON.stringify({ file, name: read.name, lines: span(read.first, read.last), text: "", of: read.of }).length;
    const lines = linesFrom(await blob.text(), read.first, read.last, MODEL_READS - rest);
    return { file, name: read.name, lines: span(read.first, lines.last), text: lines.text, of: read.of };
  },
});
export const read = userAction(readAction);
export const readForAssistant = assistantAction(readAction);
