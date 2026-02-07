"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { buildPageTextFromItems } from "../../lib/extraction/pdfjs-text";
import { findIntersectingItems } from "../../lib/extraction/pdf-highlight";
import { extractPdfJsTextPages } from "./pdfjs_extract";

export const debugPdfAlignment = internalAction({
  args: {
    paperId: v.id("extractionPapers"),
    pageNumber: v.optional(v.number()),
    charRange: v.optional(v.array(v.number())),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    error?: string;
    pageNumber?: number;
    textPreview?: string;
    textLength?: number;
    totalPages?: number;
    requestedRange?: [number, number];
    clampedRange?: [number, number];
    intersectingItems?: number;
    firstIntersectingItem?: { index: number; start: number; end: number };
    textItemCount?: number;
    nonEmptyTextItemCount?: number;
  }> => {
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
    const extracted = await extractPdfJsTextPages(buffer);
    const targetPageNumber = Math.max(1, Math.floor(args.pageNumber ?? 1));
    const targetPage = extracted.pages.find((page) => page.pageNumber === targetPageNumber);
    if (!targetPage) {
      return { error: `No text extracted from page ${targetPageNumber}` };
    }
    const { text, ranges } = buildPageTextFromItems(targetPage.items);
    const textItemCount = targetPage.items.length;
    const nonEmptyTextItemCount = targetPage.items.filter((item) => item.str.length > 0).length;

    const requestedRange =
      Array.isArray(args.charRange) && args.charRange.length >= 2
        ? ([
            Number(args.charRange[0] ?? 0),
            Number(args.charRange[1] ?? args.charRange[0] ?? 0),
          ] as [number, number])
        : undefined;
    let clampedRange: [number, number] | undefined;
    let intersectingItems: number | undefined;
    let firstIntersectingItem: { index: number; start: number; end: number } | undefined;

    if (requestedRange) {
      const start = Math.max(0, Math.min(text.length, requestedRange[0]));
      const end = Math.max(start, Math.min(text.length, requestedRange[1]));
      clampedRange = [start, end];
      const intersecting = findIntersectingItems(ranges, clampedRange);
      intersectingItems = intersecting.length;
      if (intersecting.length > 0) {
        firstIntersectingItem = intersecting[0];
      }
    }

    return {
      pageNumber: targetPageNumber,
      totalPages: extracted.totalPages,
      textPreview: text.slice(0, 200),
      textLength: text.length,
      requestedRange,
      clampedRange,
      intersectingItems,
      firstIntersectingItem,
      textItemCount,
      nonEmptyTextItemCount,
    };
  },
});
