"use node";
/**
 * PDFs attached to assistant chats (#648), in Node: one can be up to 100 MB, more than the
 * default runtime holds. `join` makes the parts an upload stored (./files.ts `upload`) into
 * the PDF, once it opens, and counts its pages. `cut` makes the pages a read asks for into a
 * PDF of their own, which the model is sent (./files.ts `withFiles`).
 */
import { PDFDocument } from "@cantoo/pdf-lib";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";

/** Joins a PDF's parts into one file and binds it, with its pages; a PDF that doesn't open goes, parts and all. */
export const join = internalAction({
  args: { fileId: v.id("assistantFiles") },
  returns: v.union(v.object({ pages: v.number() }), v.object({ error: v.string() })),
  // Typed here: the generated API's types depend on this module, so inference would loop.
  handler: async (ctx, { fileId }): Promise<{ pages: number } | { error: string }> => {
    const chunks = await ctx.runQuery(internal.assistant.files.chunksOf, { fileId });
    const parts = await Promise.all(chunks.map((chunk) => ctx.storage.get(chunk)));
    if (!parts.length || parts.some((part) => !part)) return { error: "This file was removed." };
    const whole = new Blob(parts as Blob[], { type: "application/pdf" });
    const pages = await countPages(new Uint8Array(await whole.arrayBuffer()));
    if (pages === null) {
      await ctx.runMutation(internal.assistant.files.drop, { fileId });
      return { error: "This PDF can't be opened. It may be damaged or password-protected." };
    }
    const storageId = await ctx.storage.store(whole);
    return (await ctx.runMutation(internal.assistant.files.joinChunks, { fileId, storageId, pages, bytes: whole.size })) ? { pages } : { error: "This file was removed." };
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
