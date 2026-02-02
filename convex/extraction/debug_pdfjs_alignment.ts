"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { getDocumentProxy } from "unpdf";
import { buildPageTextFromItems } from "../../lib/extraction/pdfjs-text";

export const debugPdfAlignment = internalAction({
  args: {
    paperId: v.id("extractionPapers"),
  },
  handler: async (ctx, args): Promise<{ error?: string; pageNumber?: number; textPreview?: string; textLength?: number }> => {
    const paper = await ctx.runQuery(
      internal.extraction.queries.getPaperInternal,
      { paperId: args.paperId }
    );
    if (!paper?.storageId) return { error: "Paper missing storageId" };

    const url = await ctx.storage.getUrl(paper.storageId);
    if (!url) return { error: "Unable to resolve storage URL" };

    const response = await fetch(url);
    if (!response.ok) {
      return { error: `Failed to fetch PDF: ${response.status}` };
    }

    const buffer = await response.arrayBuffer();
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const page = await pdf.getPage(1);
    const textContent = await page.getTextContent({
      disableNormalization: false,
      includeMarkedContent: false,
    });

    const items = textContent.items
      .map((item) => {
        const textItem = item as { str?: string; hasEOL?: boolean };
        if (typeof textItem.str !== "string") return null;
        return { str: textItem.str, hasEOL: textItem.hasEOL ?? false };
      })
      .filter((item): item is { str: string; hasEOL: boolean } => item !== null);
    const { text } = buildPageTextFromItems(items);

    return {
      pageNumber: 1,
      textPreview: text.slice(0, 200),
      textLength: text.length,
    };
  },
});
