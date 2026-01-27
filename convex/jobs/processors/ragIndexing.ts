"use node";

/**
 * RAG Indexing Processor
 *
 * Indexes document content into the RAG system.
 * Ports the logic from convex/rag/actions.ts indexNextDocument.
 */
import { registerProcessor } from "./index";
import { internal } from "../../_generated/api";
import type { ProcessorResult, RagIndexingPayload } from "../types";

// Register the processor
registerProcessor("rag_indexing", async (ctx, job, item) => {
  const payload = item.payload as RagIndexingPayload;
  const documentId = payload.documentId;

  // Get document details
  const doc = await ctx.runQuery(internal.rag.queries.getDocument, {
    documentId,
  });

  if (!doc) {
    return { success: false, skipped: true, error: "Document not found" };
  }

  // Check if there's content to index
  if (!doc.abstract && !doc.fullText) {
    return { success: false, skipped: true, error: "No content to index" };
  }

  // Check if already indexed
  if (doc.ragEntryId) {
    return { success: false, skipped: true, error: "Already indexed" };
  }

  // Call the indexing action
  try {
    const result = await ctx.runAction(internal.jobs.helpers.indexSingleDocument, {
      documentId,
      analysisId: job.analysisId,
    });

    if (result.success) {
      return {
        success: true,
        result: {
          chunksIndexed: result.chunksIndexed ?? 0,
          entryId: result.entryId ?? "",
        },
      };
    } else {
      return {
        success: false,
        error: result.error ?? "Indexing failed",
      };
    }
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, error };
  }
});
