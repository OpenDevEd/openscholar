"use node";
/**
 * PDFs attached to assistant chats (#648), in Node: one can be up to 100 MB, more than the
 * default runtime holds. `pdfReady` checks an uploaded PDF is the one this person's browser
 * uploaded for its row, and that it opens, and counts its pages. `cut` makes the pages a read
 * asks for into a PDF of their own, which the model is sent (./files.ts `withFiles`).
 */
import { PDFDocument } from "@cantoo/pdf-lib";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action, internalAction } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { MAX_PDF_BYTES, MAX_PDF_MB, PDF_TAG_BYTES, pdfTag } from "../../lib/assistant/files";

export const pdfReady = action({
  args: { fileId: v.id("assistantFiles"), storageId: v.id("_storage") },
  returns: v.object({ pages: v.number() }),
  handler: async (ctx, { fileId, storageId }) => {
    // Its size is checked before any of it is read.
    // ponytail: bytes too large to read are left where they are; only a browser that skips its own size check uploads them.
    const size = await ctx.runQuery(internal.assistant.files.uploadSize, { storageId });
    if (size === null) throw createError("NOT_FOUND", "That upload isn't there. Attach the file again.");
    if (size > MAX_PDF_BYTES + PDF_TAG_BYTES) throw createError("VALIDATION_ERROR", `A PDF can be up to ${MAX_PDF_MB} MB.`);
    const blob = await ctx.storage.get(storageId);
    const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    // Only bytes that end with this row's tag were uploaded for it: any others are never bound or deleted.
    const tag = pdfTag(fileId);
    if (!bytes || Buffer.from(bytes.subarray(-tag.length)).toString("latin1") !== tag) throw createError("NOT_FOUND", "That upload isn't yours to attach.");
    const pages = await countPages(bytes);
    const bound = await ctx.runMutation(internal.assistant.files.claimPdf, { fileId, storageId, pages });
    if (bound === "unreadable") throw createError("VALIDATION_ERROR", "This PDF can't be opened. It may be damaged or password-protected.");
    if (bound === "removed") throw createError("NOT_FOUND", "This file was removed.");
    return { pages: pages! };
  },
});

async function countPages(bytes: Uint8Array) {
  try {
    return (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
  } catch {
    return null;
  }
}

/** Pages `first` to `last` of a PDF, as a PDF of their own, stored and kept as a file of its chat. */
export const cut = internalAction({
  args: { fileId: v.id("assistantFiles"), storageId: v.id("_storage"), first: v.number(), last: v.number() },
  returns: v.id("assistantFiles"),
  // Typed here: the generated API's types depend on this module, so inference would loop.
  handler: async (ctx, { fileId, storageId, first, last }): Promise<Id<"assistantFiles">> => {
    const blob = await ctx.storage.get(storageId);
    if (!blob) throw createError("NOT_FOUND", "This PDF has expired. Ask the person to attach it again.");
    const source = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()), { updateMetadata: false });
    const part = await PDFDocument.create();
    const pages = await part.copyPages(source, Array.from({ length: last - first + 1 }, (_, i) => first - 1 + i));
    for (const page of pages) part.addPage(page);
    const bytes = await part.save();
    const partStorage = await ctx.storage.store(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
    const fileOfPages = await ctx.runMutation(internal.assistant.files.addPart, { fileId, storageId: partStorage, range: first === last ? `${first}` : `${first}-${last}`, bytes: bytes.byteLength });
    if (!fileOfPages) throw createError("NOT_FOUND", "This PDF is no longer in the chat.");
    return fileOfPages;
  },
});
