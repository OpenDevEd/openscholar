/**
 * Universal Job System - Type Definitions and Validators
 *
 * This module defines the type-safe validators and TypeScript types
 * for the universal job system that handles PDF downloads, RAG indexing,
 * and LLM extraction with a single, robust architecture.
 */
import { v, Infer } from "convex/values";
import type { Id, Doc } from "../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// JOB TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const JOB_TYPES = {
  PDF_DOWNLOAD: "pdf_download",
  RAG_INDEXING: "rag_indexing",
  EXTRACTION: "extraction",
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

export const jobTypeValidator = v.union(
  v.literal("pdf_download"),
  v.literal("rag_indexing"),
  v.literal("extraction")
);

// ═══════════════════════════════════════════════════════════════════════════
// STATUS VALIDATORS
// ═══════════════════════════════════════════════════════════════════════════

export const jobStatusValidator = v.union(
  v.literal("pending"), // Waiting for dependency
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled")
);

export type JobStatus = Infer<typeof jobStatusValidator>;

export const itemStatusValidator = v.union(
  v.literal("pending"),
  v.literal("claimed"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("skipped")
);

export type ItemStatus = Infer<typeof itemStatusValidator>;

// ═══════════════════════════════════════════════════════════════════════════
// PAYLOAD VALIDATORS (Type-Safe Discriminated Union)
// ═══════════════════════════════════════════════════════════════════════════

export const pdfDownloadPayloadValidator = v.object({
  type: v.literal("pdf_download"),
  documentId: v.id("documents"),
});

export const ragIndexingPayloadValidator = v.object({
  type: v.literal("rag_indexing"),
  documentId: v.id("documents"),
});

export const extractionPayloadValidator = v.object({
  type: v.literal("extraction"),
  documentId: v.id("documents"),
  questionId: v.string(),
});

export const jobItemPayloadValidator = v.union(
  pdfDownloadPayloadValidator,
  ragIndexingPayloadValidator,
  extractionPayloadValidator
);

// TypeScript types for payloads
export type PdfDownloadPayload = Infer<typeof pdfDownloadPayloadValidator>;
export type RagIndexingPayload = Infer<typeof ragIndexingPayloadValidator>;
export type ExtractionPayload = Infer<typeof extractionPayloadValidator>;
export type JobItemPayload = Infer<typeof jobItemPayloadValidator>;

// ═══════════════════════════════════════════════════════════════════════════
// RESULT VALIDATORS
// ═══════════════════════════════════════════════════════════════════════════

// Result summaries stored in jobItems (not full data, just references)
export const pdfDownloadResultValidator = v.object({
  textLength: v.number(),
  pages: v.number(),
  storageId: v.id("_storage"),
});

export const ragIndexingResultValidator = v.object({
  chunksIndexed: v.number(),
  entryId: v.string(),
});

export const extractionResultValidator = v.object({
  extractionResultId: v.id("extractionResults"),
});

export const jobItemResultValidator = v.optional(
  v.union(
    pdfDownloadResultValidator,
    ragIndexingResultValidator,
    extractionResultValidator,
    v.object({}) // Empty result for skipped items
  )
);

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export const JOB_DEFAULTS = {
  pdf_download: {
    concurrencyLimit: 5,
    itemTimeoutMs: 2 * 60 * 1000, // 2 minutes
    jobTimeoutMs: 30 * 60 * 1000, // 30 minutes
    maxAttempts: 3,
  },
  rag_indexing: {
    concurrencyLimit: 10,
    itemTimeoutMs: 2 * 60 * 1000,
    jobTimeoutMs: 30 * 60 * 1000,
    maxAttempts: 3,
  },
  extraction: {
    concurrencyLimit: 5,
    itemTimeoutMs: 2 * 60 * 1000,
    jobTimeoutMs: 30 * 60 * 1000,
    maxAttempts: 3,
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// PROCESSOR TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ProcessorResult = {
  success: boolean;
  skipped?: boolean;
  result?: Record<string, unknown>;
  error?: string;
};

// ═══════════════════════════════════════════════════════════════════════════
// CLAIM RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const claimResultValidator = v.union(
  v.null(), // No work available or job complete
  v.object({
    waitAndRetry: v.literal(true), // At capacity, retry later
  }),
  v.object({
    waitAndRetry: v.optional(v.literal(false)),
    jobType: jobTypeValidator,
    jobUserId: v.optional(v.id("users")),
    jobAnalysisId: v.id("analyses"),
    jobMetadata: v.optional(v.any()),
    itemId: v.id("jobItems"),
    itemIndex: v.number(),
    itemPayload: jobItemPayloadValidator,
    itemAttempts: v.number(),
    isRetry: v.boolean(),
    itemTimeoutMs: v.number(),
  })
);

export type ClaimResult = Infer<typeof claimResultValidator>;

// ═══════════════════════════════════════════════════════════════════════════
// RELEASE RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const releaseResultValidator = v.object({
  processed: v.number(),
  total: v.number(),
  isJobComplete: v.boolean(),
  triggeredNextJob: v.optional(v.id("jobs")),
});

export type ReleaseResult = Infer<typeof releaseResultValidator>;

// ═══════════════════════════════════════════════════════════════════════════
// JOB STATUS RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const jobStatusResponseValidator = v.object({
  _id: v.id("jobs"),
  type: jobTypeValidator,
  status: jobStatusValidator,
  analysisId: v.id("analyses"),
  userId: v.optional(v.id("users")),
  totalItems: v.number(),
  processed: v.number(),
  succeeded: v.number(),
  failed: v.number(),
  skipped: v.number(),
  concurrencyLimit: v.number(),
  startedAt: v.number(),
  lastActivityAt: v.number(),
  completedAt: v.optional(v.number()),
  chainId: v.optional(v.string()),
  chainPosition: v.optional(v.number()),
  dependsOn: v.optional(v.id("jobs")),
  errors: v.array(v.string()),
});

export type JobStatusResponse = Infer<typeof jobStatusResponseValidator>;

// ═══════════════════════════════════════════════════════════════════════════
// JOB ITEM RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const jobItemResponseValidator = v.object({
  _id: v.id("jobItems"),
  jobId: v.id("jobs"),
  index: v.number(),
  status: itemStatusValidator,
  payload: jobItemPayloadValidator,
  attempts: v.number(),
  claimedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  result: v.optional(v.any()),
  error: v.optional(v.string()),
});

export type JobItemResponse = Infer<typeof jobItemResponseValidator>;
