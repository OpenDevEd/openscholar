"use node";

/**
 * PDF Download Processor
 *
 * Downloads and extracts text from open access PDFs.
 * Ports the logic from convex/rag/actions.ts processNextOpenAccessPdf.
 */
import { registerProcessor } from "./index";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { ProcessorResult, PdfDownloadPayload } from "../types";

// Register the processor
registerProcessor("pdf_download", async (ctx, job, item) => {
  const payload = item.payload as PdfDownloadPayload;
  const documentId = payload.documentId;

  // Get document details
  const doc = await ctx.runQuery(internal.rag.queries.getDocument, {
    documentId,
  });

  if (!doc) {
    return { success: false, skipped: true, error: "Document not found" };
  }

  if (!doc.openAccessUrl) {
    return { success: false, skipped: true, error: "No open access URL" };
  }

  if (doc.fullText || doc.pdfStorageId) {
    return { success: false, skipped: true, error: "Already has PDF/text" };
  }

  // Handle Zotero attachments
  // Handle Zotero attachments via special URL scheme
  if (doc.openAccessUrl && doc.openAccessUrl.startsWith("zotero://")) {
    try {
      const result = await ctx.runAction(internal.jobs.helpers.downloadZoteroAttachment, {
        documentId,
        analysisId: job.analysisId,
      });

      if (result.success) {
        return {
          success: true,
          result: {
            textLength: result.textLength ?? 0,
            pages: result.pages ?? 0,
            storageId: result.storageId,
          },
        };
      } else if (result.skipped) {
        return {
          success: false,
          skipped: true,
          error: result.error ?? "Skipped",
        };
      } else {
        return {
          success: false,
          error: result.error ?? "Zotero download failed",
        };
      }
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      return { success: false, error };
    }
  }

  // Standard Open Access Download
  if (!doc.openAccessUrl) {
    return { success: false, skipped: true, error: "No open access URL" };
  }

  // Call the existing PDF download action
  // This reuses all the existing smart fetch, retry, and extraction logic
  try {
    const result = await ctx.runAction(internal.jobs.helpers.downloadSinglePdf, {
      documentId,
      analysisId: job.analysisId,
    });

    if (result.success) {
      return {
        success: true,
        result: {
          textLength: result.textLength ?? 0,
          pages: result.pages ?? 0,
          storageId: result.storageId,
        },
      };
    } else if (result.skipped) {
      return {
        success: false,
        skipped: true,
        error: result.error ?? "Skipped",
      };
    } else {
      return {
        success: false,
        error: result.error ?? "Download failed",
      };
    }
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, error };
  }
});
