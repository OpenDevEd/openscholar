"use node";
/**
 * PDFs attached to assistant chats (#648), in Node: one can be up to 100 MB, more than the
 * default runtime holds. `pdfReady` checks an uploaded PDF is one this person's browser stored
 * for its row, and that it opens, and counts its pages. `cut` makes the pages a read asks
 * for into a PDF of their own, which the model is sent (./files.ts `withFiles`).
 */
import { PDFDocument } from "@cantoo/pdf-lib";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action, internalAction } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";

export const pdfReady = action({
  args: { fileId: v.id("assistantFiles"), storageId: v.id("_storage") },
  returns: v.object({ pages: v.number() }),
  handler: async (ctx, { fileId, storageId }) => {
    // Checked as theirs before anything is read: a file that isn't is never touched.
    await ctx.runMutation(internal.assistant.files.claimPdf, { fileId, storageId });
    const blob = await ctx.storage.get(storageId);
    const pages = blob ? await countPages(new Uint8Array(await blob.arrayBuffer())) : null;
    if (pages === null) {
      await ctx.runMutation(internal.assistant.files.refusePdf, { fileId, storageId });
      throw createError("VALIDATION_ERROR", "This PDF can't be opened. It may be damaged or password-protected.");
    }
    await ctx.runMutation(internal.assistant.files.claimPdf, { fileId, storageId, pages });
    return { pages };
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
    return await ctx.runMutation(internal.assistant.files.addPart, { fileId, storageId: partStorage, range: first === last ? `${first}` : `${first}-${last}`, bytes: bytes.byteLength });
  },
});
