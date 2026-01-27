"use node";

/**
 * Extraction Processor
 *
 * Runs AI extraction on documents for specific questions.
 * Ports the logic from convex/extraction/actions.ts processNextExtraction.
 */
import { registerProcessor } from "./index";
import { internal, api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { ProcessorResult, ExtractionPayload } from "../types";

// Register the processor
registerProcessor("extraction", async (ctx, job, item) => {
  const payload = item.payload as ExtractionPayload;
  const { documentId, questionId } = payload;

  if (!job.userId) {
    return { success: false, error: "User ID required for extraction" };
  }

  // Get document and analysis details
  const doc = await ctx.runQuery(internal.extraction.internal.getDocumentForExtraction, {
    documentId,
  });

  if (!doc) {
    return { success: false, skipped: true, error: "Document not found" };
  }

  const analysis = await ctx.runQuery(internal.extraction.internal.getAnalysisForExtraction, {
    analysisId: job.analysisId,
  });

  if (!analysis) {
    return { success: false, error: "Analysis not found" };
  }

  // Find the question
  type ExtractionQuestion = {
    id: string;
    key: string;
    question: string;
    type: string;
  };

  const question = analysis.extractionQuestions.find(
    (q: ExtractionQuestion) => q.id === questionId
  );

  if (!question) {
    return { success: false, skipped: true, error: "Question not found" };
  }

  // Call the extraction action
  try {
    const result = await ctx.runAction(internal.jobs.helpers.extractSingleDocument, {
      documentId,
      analysisId: job.analysisId,
      userId: job.userId,
      questionId,
      question: question.question,
      questionType: question.type,
      title: doc.title,
      abstract: doc.abstract || "",
    });

    if (result.success) {
      return {
        success: true,
        result: {
          extractionResultId: result.extractionResultId,
        },
      };
    } else {
      return {
        success: false,
        error: result.error ?? "Extraction failed",
      };
    }
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, error };
  }
});
