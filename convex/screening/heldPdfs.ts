"use node";

/**
 * The first reading of a PDF handed to a screening (./files.ts), which needs Node. A cheap model is sent the file's
 * first pages as the PDF they are, the way the assistant sends one (../assistant/pdf.ts): printed text, tables,
 * figures and scans alike. It copies the title, the authors, the year and the DOI those pages print. Where the
 * index holds that DOI under that title, the screening shows the index's paper. Otherwise the paper is the file,
 * and whoever screens it reads the file. Only a file that doesn't open is left out.
 */
import { PDFDocument } from "@cantoo/pdf-lib";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { executeAIOperation } from "../../lib/ai/core/execute";
import { MAX_PDF_BYTES } from "../../lib/assistant/files";
import { normalDoi } from "../../lib/papers/paper-ref";
import { PDF_LOOK_PAGES, pdfLookCredits } from "../../lib/pricing/estimate";
import { sameTitle } from "../../lib/screening/files";
import { outOfCredits, withUserCredits } from "../ai/helpers";
import { openRouterModel } from "../ai/provider";
import { MAX_AUTHORS } from "../lib/listCaps";
import { spender } from "../paperSets/search";
import { byDois } from "./held";
import { pdfReadValidator } from "./validators";

type Read = typeof pdfReadValidator.type;

const TITLE_MAX = 500;

const printed = z.object({
  title: z.string().describe("The document's full title, copied as printed. Empty if these pages print none."),
  authors: z.array(z.string()).describe("Its authors' names as printed, in their order. Empty if these pages print none."),
  year: z.number().int().nullable().describe("The year it was published, as printed. Null if these pages print none."),
  doi: z.string().nullable().describe("The document's own DOI, as printed on these pages. Never the DOI of a work it cites. Null if these pages print none."),
});


export const look = internalAction({
  args: { fileId: v.id("screeningFiles") },
  returns: pdfReadValidator,
  handler: async (ctx, { fileId }): Promise<Read> => {
    const held = await ctx.runQuery(internal.screening.files.waiting, { fileId });
    if (!held) return { state: "read" };
    const blob = await ctx.storage.get(held.file);
    if (!blob || blob.size > MAX_PDF_BYTES) return { state: "broken" };
    let firstPages: Uint8Array;
    let pages: number;
    try {
      const whole = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()), { updateMetadata: false });
      pages = whole.getPageCount();
      if (!pages) return { state: "broken" };
      const part = await PDFDocument.create();
      for (const page of await part.copyPages(whole, Array.from({ length: Math.min(pages, PDF_LOOK_PAGES) }, (_, i) => i))) part.addPage(page);
      firstPages = await part.save();
    } catch (error) {
      // Damaged, password-protected, or not a PDF at all: what the assistant refuses too.
      console.error("[screening] A PDF couldn't be opened", { name: held.name, error: String(error).slice(0, 300) });
      return { state: "broken" };
    }
    const who = await ctx.runQuery(internal.screening.held.reader, { userId: held.userId, workspaceId: held.workspaceId });
    // With no model that reads a PDF, or no credits to read one with, the file is still the paper: under its own name.
    if (!who?.model?.files) return { state: "read", pages };
    const model = who.model;
    const pricing = { input: model.input, output: model.output };
    let read: z.infer<typeof printed>;
    try {
      ({ result: read } = await withUserCredits<z.infer<typeof printed>>(
        ctx,
        { userId: held.userId, workspaceId: held.workspaceId, chargeId: `screening-pdf:${held.file}:${crypto.randomUUID()}`, estimate: pdfLookCredits(pricing), hold: false, balance: who.balance, clerkId: who.clerkId, kind: "screening", description: "Reading a PDF for a screening", model: model.slug },
        pricing,
        async () => {
          const { output, usage } = await executeAIOperation({
            model: await openRouterModel(model.slug),
            schema: printed,
            input: firstPages,
            buildPrompts: (data) => ({
              system: "You are given the first pages of a document as a PDF. Copy what they print: the document's title, its authors, the year it was published and its own DOI. Copy, never guess: leave out what these pages don't print.",
              prompt: "Return this document's title, authors, year and DOI as these pages print them.",
              files: [{ data, filename: held.name }],
            }),
            repairStrategy: { type: "full-json" },
            temperature: 0,
          });
          return { result: output, totalUsage: usage };
        },
      ));
    } catch (error) {
      if (outOfCredits(error)) return { state: "read", pages };
      throw error;
    }
    const title = read.title.trim().slice(0, TITLE_MAX);
    const doi = normalDoi(read.doi ?? undefined) ?? undefined;
    // The index's paper, where it holds this DOI under the title these pages print: a DOI alone may be a cited work's.
    const found = doi && title ? (await byDois([doi], spender(ctx, who.clerkId)).catch(() => null))?.get(doi) : undefined;
    const known = found !== undefined && sameTitle(found.title, title);
    return {
      state: "read",
      pages,
      ...(title ? { title: known ? found.title : title } : {}),
      ...(read.authors.length ? { authors: read.authors.slice(0, MAX_AUTHORS).map((name) => name.slice(0, 300)) } : {}),
      ...(read.year ? { year: read.year } : {}),
      // A DOI nothing confirms is not kept: the paper would be merged with whatever else carries it.
      // The index's paper with no abstract is still read as this file.
      ...(known ? { doi, known, ...(found.abstract?.trim() ? {} : { bare: true }) } : {}),
    };
  },
});
