"use node";

import { internalAction, type ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import { RAG } from "@convex-dev/rag";
import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import {
  calculateServerCreditsToDeduct,
  calculateServerRawCreditCost,
  convertServerCostDollarsToCredits,
  fetchServerPricing,
  getModel,
} from "../ai/helpers";
import { STANDARD_PROVIDER_OPTIONS } from "../../lib/ai/core/schemas";
import {
  truncateForTracking,
  type AITrackingEntry,
} from "../../lib/posthog-ai-shared";
import {
  captureAIGenerationBatchServer,
  captureAIGenerationServer,
  captureServerEvent,
} from "../../lib/posthog-server";
import type { AIProvider } from "../../lib/types";
import { SERVER_AI_CONFIG } from "../ai/config";
import { ESTIMATED_CREDITS_PER_QUERY } from "../lib/constants";
import { createError } from "../lib/errors";
import { downloadPdf, type DownloadPdfResult } from "../../lib/pdf/download";
import { decryptApiKey } from "../lib/crypto";
import {
  classifyUnknownError,
  isRetryable,
  type ClassifiedError,
  type ErrorCode,
} from "@/lib/errors/taxonomy";
import { MIN_ABSTRACT_LENGTH } from "./content";
import {
  buildEnhancedExtractionPrompt,
  type ExtractionQuestion,
} from "./prompts";
import {
  buildChunkedEvidenceUnitsFromPdfPages,
  reciprocalRankFuse,
  scoreLexicalEvidence,
  type RankedEvidenceScore,
} from "./evidence_units";
import { extractPdfJsTextPages } from "./pdfjs_extract";
import { buildPageTextFromItems } from "../../lib/extraction/pdfjs-text";
import {
  isGenericArrayEntity,
  normalizeArrayEntity,
  splitArrayFragments,
} from "../../lib/extraction/analysis";
import {
  applyAbstractOnlyPolicy,
  applyEvidencePolicy,
  BEST_EFFORT_CONFIDENCE_CAP,
  BEST_EFFORT_MAX_CITATIONS,
  dedupeEvidenceIds,
  isUsableAbstract as isUsableAbstractPure,
  normalizeExtractionOutputForQuestion,
  sanitizeArrayAnswer,
  STRICT_NULL_CONFIDENCE_CAP,
  validateSupportEvidenceIds,
  type Citation,
  type CitationStatus,
  type EvidenceUnitDoc,
  type ExtractionQuestionResult,
  type RetrievalCandidate,
  type RetrievalDiagnostics,
  type StrictExtractionOutput,
} from "../../lib/extraction/evidence-policy";
import {
  answerValidator,
  citationStatusValidator,
  citationValidator,
  classifiedErrorValidator,
  questionInputValidator,
  retrievalDiagnosticsValidator,
} from "./validators";

const isUsableAbstract = (abstract?: string | null) =>
  isUsableAbstractPure(abstract, MIN_ABSTRACT_LENGTH);

const rag = new RAG<{ paperId: string }>(components.rag, {
  textEmbeddingModel: openai.embedding("text-embedding-3-small"),
  embeddingDimension: 1536,
  filterNames: ["paperId"],
});

const DENSE_LIMIT = 120;
const DENSE_THRESHOLD = 0.05;
const RRF_CONSTANT = 30;
const FUSED_TOP_N = 48;
const EVIDENCE_POOL_N = 16;
const DEFAULT_EXTRACTION_EMBEDDING_USD_PER_1M_TOKENS = 0.02;
function parsePositiveFloat(
  input: string | undefined,
  fallback: number,
): number {
  if (!input) return fallback;
  const parsed = Number.parseFloat(input);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const EXTRACTION_EMBEDDING_USD_PER_1M_TOKENS = parsePositiveFloat(
  process.env.EXTRACTION_EMBEDDING_USD_PER_1M_TOKENS,
  DEFAULT_EXTRACTION_EMBEDDING_USD_PER_1M_TOKENS,
);

function estimateEmbeddingCostDollars(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return (tokens / 1_000_000) * EXTRACTION_EMBEDDING_USD_PER_1M_TOKENS;
}

/**
 * Build a fully classified error from anything an action catch site
 * sees. Layered on top of `classifyUnknownError` so we can attach a
 * stage-specific fallback code when the upstream throw doesn't carry
 * enough signal to fingerprint on its own.
 */
function toClassifiedError(
  error: unknown,
  fallbackCode: ErrorCode,
  fallbackMessage: string,
): ClassifiedError {
  const result = classifyUnknownError(error);
  if (result.code === "unknown") {
    return {
      ...result,
      code: fallbackCode,
      retryable: isRetryable[fallbackCode],
      message:
        result.message === "Unknown error" ? fallbackMessage : result.message,
    };
  }
  return result;
}

/**
 * Build a ClassifiedError from a known taxonomy code + human message.
 * Used by graceful (non-throw) failure returns at the action level.
 */
function mkError(code: ErrorCode, message: string): ClassifiedError {
  return { code, message, retryable: isRetryable[code] };
}

function toTupleRange(
  charRange: number[] | [number, number],
): [number, number] {
  const start = Number(charRange?.[0] ?? 0);
  const end = Number(charRange?.[1] ?? start);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return [0, 0];
  }
  return [start, end];
}

function getZodTypeForQuestion(type: string) {
  switch (type) {
    case "boolean":
      return z.boolean().nullable();
    case "number":
      return z.number().nullable();
    case "array":
      return z.array(z.string()).nullable();
    default:
      return z.string().nullable();
  }
}

function buildAnswerSchema(type: string) {
  return z.object({
    answer: getZodTypeForQuestion(type),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
    supportEvidenceIds: z.array(z.string()).default([]),
  });
}

function parseDenseScores(
  results: Array<{
    score?: number;
    content?: Array<{ metadata?: { evidenceId?: string } }>;
    metadata?: { evidenceId?: string };
  }>,
): RankedEvidenceScore[] {
  const byEvidence = new Map<string, number>();

  for (const result of results) {
    const score =
      typeof result?.score === "number" && Number.isFinite(result.score)
        ? result.score
        : undefined;
    if (score === undefined) continue;

    const push = (evidenceId?: string) => {
      if (!evidenceId) return;
      const existing = byEvidence.get(evidenceId);
      if (existing === undefined || score > existing) {
        byEvidence.set(evidenceId, score);
      }
    };

    if (Array.isArray(result?.content)) {
      for (const chunk of result.content) {
        const evidenceId =
          typeof chunk?.metadata?.evidenceId === "string"
            ? chunk.metadata.evidenceId
            : undefined;
        push(evidenceId);
      }
      continue;
    }

    const fallbackEvidenceId =
      typeof result?.metadata?.evidenceId === "string"
        ? result.metadata.evidenceId
        : undefined;
    push(fallbackEvidenceId);
  }

  return Array.from(byEvidence.entries())
    .map(([evidenceId, score]) => ({ evidenceId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, DENSE_LIMIT);
}

async function runDenseSearch(
  ctx: ActionCtx,
  namespace: string,
  paperId: string,
  question: string,
): Promise<RankedEvidenceScore[]> {
  try {
    const search = await rag.search(ctx, {
      namespace,
      query: question,
      limit: DENSE_LIMIT,
      vectorScoreThreshold: DENSE_THRESHOLD,
      filters: [{ name: "paperId", value: paperId }],
    });

    const results = Array.isArray(search?.results) ? search.results : [];
    return parseDenseScores(results);
  } catch (error) {
    console.error("[runDenseSearch] Dense retrieval failed", error);
    return [];
  }
}

function buildCitations(validated: RetrievalCandidate[]): Citation[] {
  return validated.map((item) => ({
    evidenceId: item.unit.evidenceId,
    page: item.unit.page,
    charRange: item.unit.charRange,
    quote: item.unit.text,
    retrieval: {
      denseScore: item.denseScore,
      lexicalScore: item.lexicalScore,
      fusedScore: item.fusedScore,
      rerankScore: item.rerankScore,
    },
    validated: true,
  }));
}

function toEvidenceContext(candidates: RetrievalCandidate[]) {
  return candidates.map((item) => ({
    evidenceId: item.unit.evidenceId,
    text: item.unit.text,
    page: item.unit.page,
    charRange: item.unit.charRange,
    section: item.unit.section,
    relevanceScore: item.fusedScore ?? item.denseScore ?? item.lexicalScore,
  }));
}

type ExtractionWithUsage = {
  result: ExtractionQuestionResult;
  usage: { inputTokens: number; outputTokens: number };
  prompt: string;
};

async function extractQuestionAnswer(params: {
  model: Awaited<ReturnType<typeof getModel>>;
  question: {
    key: string;
    question: string;
    type: "string" | "boolean" | "number" | "array";
    description?: string;
  };
  abstract?: string;
  evidencePool: RetrievalCandidate[];
  diagnosticsSeed: Omit<
    RetrievalDiagnostics,
    "validatedCitations" | "strictNull"
  >;
}): Promise<ExtractionWithUsage> {
  const { model, question, abstract, evidencePool, diagnosticsSeed } = params;

  try {
    const prompt = buildEnhancedExtractionPrompt(
      question as ExtractionQuestion,
      abstract,
      toEvidenceContext(evidencePool),
    );

    const { output: object, usage } = await generateText({
      model,
      output: Output.object({ schema: buildAnswerSchema(question.type) }),
      prompt,
      temperature: 0,
      providerOptions: STANDARD_PROVIDER_OPTIONS as Parameters<
        typeof generateText
      >[0]["providerOptions"],
    });

    const extracted = normalizeExtractionOutputForQuestion(
      question.type,
      object as StrictExtractionOutput,
    );
    const validated = validateSupportEvidenceIds(
      extracted.supportEvidenceIds || [],
      evidencePool,
    );
    const policy = applyEvidencePolicy({
      extracted,
      validated,
      fallbackCandidates: evidencePool,
    });
    const citations = buildCitations(policy.selectedCandidates);

    const result: ExtractionQuestionResult = {
      questionKey: question.key,
      answer: policy.answer,
      confidence: policy.confidence,
      reasoning: extracted.reasoning,
      citations,
      citationStatus: policy.citationStatus,
      retrievalDiagnostics: {
        ...diagnosticsSeed,
        validatedCitations: citations.length,
        strictNull: policy.strictNull,
      },
      pdfContentUsed: citations.length > 0,
    };

    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;

    return {
      result,
      usage: { inputTokens, outputTokens },
      prompt,
    };
  } catch (error) {
    return {
      result: {
        questionKey: question.key,
        answer: null,
        confidence: 0,
        reasoning: `Extraction failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        citations: [],
        citationStatus: "extraction_error",
        retrievalDiagnostics: {
          ...diagnosticsSeed,
          validatedCitations: 0,
          strictNull: false,
        },
        pdfContentUsed: false,
      },
      usage: { inputTokens: 0, outputTokens: 0 },
      prompt: "",
    };
  }
}

async function extractQuestionAnswerFromAbstract(params: {
  model: Awaited<ReturnType<typeof getModel>>;
  question: {
    key: string;
    question: string;
    type: "string" | "boolean" | "number" | "array";
    description?: string;
  };
  abstract: string;
  pdfEnabled: boolean;
}): Promise<ExtractionWithUsage> {
  const { model, question, abstract } = params;

  try {
    const prompt = buildEnhancedExtractionPrompt(
      question as ExtractionQuestion,
      abstract,
      [],
    );

    const { output: object, usage } = await generateText({
      model,
      output: Output.object({ schema: buildAnswerSchema(question.type) }),
      prompt,
      temperature: 0,
      providerOptions: STANDARD_PROVIDER_OPTIONS as Parameters<
        typeof generateText
      >[0]["providerOptions"],
    });

    const extracted = normalizeExtractionOutputForQuestion(
      question.type,
      object as StrictExtractionOutput,
    );
    const policy = applyAbstractOnlyPolicy({
      extracted,
      pdfEnabled: params.pdfEnabled,
    });
    const reasoningPrefix =
      policy.answer === null
        ? "Abstract-only mode: no direct support found in the abstract."
        : "Abstract-only mode: answer inferred from abstract content.";

    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;

    return {
      result: {
        questionKey: question.key,
        answer: policy.answer,
        confidence: policy.confidence,
        reasoning: `${reasoningPrefix} ${extracted.reasoning}`.trim(),
        citations: [],
        citationStatus: policy.citationStatus,
        retrievalDiagnostics: {
          denseCandidates: 0,
          lexicalCandidates: 0,
          fusedCandidates: 0,
          rerankedCandidates: 0,
          validatedCitations: 0,
          strictNull: policy.strictNull,
        },
        pdfContentUsed: false,
      },
      usage: { inputTokens, outputTokens },
      prompt,
    };
  } catch (error) {
    return {
      result: {
        questionKey: question.key,
        answer: null,
        confidence: 0,
        reasoning: `Extraction failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        citations: [],
        citationStatus: "extraction_error",
        retrievalDiagnostics: {
          denseCandidates: 0,
          lexicalCandidates: 0,
          fusedCandidates: 0,
          rerankedCandidates: 0,
          validatedCitations: 0,
          strictNull: false,
        },
        pdfContentUsed: false,
      },
      usage: { inputTokens: 0, outputTokens: 0 },
      prompt: "",
    };
  }
}

async function buildEvidenceUnitsFromPdf(pdfBuffer: ArrayBuffer) {
  const extracted = await extractPdfJsTextPages(pdfBuffer);
  const pages = extracted.pages.map((page) => {
    const { text } = buildPageTextFromItems(page.items);
    return {
      pageNumber: page.pageNumber,
      text,
    };
  });

  const units = buildChunkedEvidenceUnitsFromPdfPages(
    pages.map((page) => ({
      pageNumber: page.pageNumber,
      text: page.text,
      section: "body",
    })),
    {
      targetChars: 650,
      maxChars: 900,
      overlapChars: 120,
      source: "pdfjs_chunks",
    },
  );

  if (units.length === 0) {
    throw new Error("No evidence units were generated from PDF.js content");
  }
  return units;
}

async function resolvePdfBlob(
  ctx: ActionCtx,
  job: { userId: Id<"users"> } | null,
  args: {
    paperId: Id<"extractionPapers">;
    jobId: Id<"extractionJobs">;
    pdfUrl: string;
    storageId?: Id<"_storage">;
    doi?: string;
  },
): Promise<{ pdfBlob: Blob | null; storageId?: Id<"_storage">; error?: string }> {
  if (args.storageId) {
    const stored = await ctx.storage.get(args.storageId);
    if (stored) {
      return { pdfBlob: stored, storageId: args.storageId };
    }
  }

  if (!args.pdfUrl) {
    return { pdfBlob: null, error: "No PDF URL provided" };
  }

  const zoteroConnection = job
    ? await ctx.runQuery(internal.zotero.internal.getConnection, {
        userId: job.userId,
      })
    : null;

  // Decrypt the Zotero API key
  let zoteroApiKey: string | undefined;
  if (zoteroConnection?.encryptedApiKey) {
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error("ENCRYPTION_KEY not configured");
    }
    zoteroApiKey = decryptApiKey(
      zoteroConnection.encryptedApiKey,
      encryptionKey,
      {
        userId: job?.userId ? String(job.userId) : "system",
        purpose: "zotero-pdf-download",
      },
    );
    await ctx.runMutation(internal.lib.audit.writeAuditLog, {
      action: "KEY_DECRYPT",
      userId: job?.userId ? String(job.userId) : "system",
      metadata: { purpose: "extraction-api-key-decrypt" },
    });
  }

  const downloaded: DownloadPdfResult = await downloadPdf(args.pdfUrl, {
    doi: args.doi,
    zoteroConnection: zoteroApiKey
      ? { apiKey: zoteroApiKey, userId: zoteroConnection!.zoteroUserId }
      : undefined,
  });

  if (!downloaded.success || !downloaded.pdfBlob) {
    return {
      pdfBlob: null,
      error: downloaded.error || "PDF download failed",
    };
  }
  return { pdfBlob: downloaded.pdfBlob };
}

type WorkerSkipReason =
  | "cancelled"
  | "job_terminal"
  | "credits_exhausted"
  | "paused"
  | "stale_epoch";

type JobControlState = {
  status: string | null;
  runEpoch: number;
};

function getWorkerSkipReason(
  control: JobControlState,
  expectedEpoch: number,
): WorkerSkipReason | null {
  if (control.runEpoch !== expectedEpoch) {
    return "stale_epoch";
  }
  switch (control.status) {
    case "cancelled":
      return "cancelled";
    case "completed":
    case "failed":
      return "job_terminal";
    case "creditsExhausted":
      return "credits_exhausted";
    case "paused":
      return "paused";
    default:
      return null;
  }
}

type IndexResult =
  | {
      status: "completed";
      storageId?: Id<"_storage">;
      chunksCount?: number;
    }
  | {
      status: "skipped";
      reason: WorkerSkipReason;
    }
  | {
      status: "failed";
      error?: ClassifiedError;
    };

export const downloadAndIndexPdfAction = internalAction({
  args: {
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
    expectedEpoch: v.number(),
  },
  returns: v.union(
    v.object({
      status: v.literal("completed"),
      storageId: v.optional(v.id("_storage")),
      chunksCount: v.optional(v.number()),
    }),
    v.object({
      status: v.literal("skipped"),
      reason: v.union(
        v.literal("cancelled"),
        v.literal("job_terminal"),
        v.literal("credits_exhausted"),
        v.literal("paused"),
        v.literal("stale_epoch"),
      ),
    }),
    v.object({
      status: v.literal("failed"),
      error: v.optional(classifiedErrorValidator),
    }),
  ),
  handler: async (ctx, args): Promise<IndexResult> => {
    try {
      // One round trip for job + pdf-flag instead of two.
      const { job, pdfEnabled } = await ctx.runQuery(
        internal.extraction.queries.internal.getJobAndFlagsInternal,
        { jobId: args.jobId },
      );
      if (!job) {
        return {
          status: "failed",
          error: mkError("paper_not_found", "Job not found"),
        };
      }

      const initialSkipReason = getWorkerSkipReason(
        {
          status: job.status ?? null,
          runEpoch: job.runEpoch ?? 0,
        },
        args.expectedEpoch,
      );
      if (initialSkipReason) {
        return { status: "skipped", reason: initialSkipReason };
      }

      // Idempotency gate: a workpool retry that lands here after the paper
      // was already indexed (and billed) must not re-embed or re-charge.
      // Doubles as the source of truth for pdfUrl/storageId/abstract/doi —
      // pulling them off the row instead of the action args keeps the
      // workflow journal lean (~600 papers × ~2 KB of paper metadata adds
      // up fast across step boundaries).
      const existingPaper = await ctx.runQuery(
        internal.extraction.queries.papers.byId,
        { paperId: args.paperId },
      );
      if (!existingPaper) {
        return {
          status: "failed",
          error: mkError("paper_not_found", "Paper not found"),
        };
      }
      if (existingPaper.isIndexed || existingPaper.indexingBilled) {
        console.log(
          `[downloadAndIndexPdfAction] paper ${args.paperId} already indexed/billed; skipping`,
        );
        return {
          status: "completed",
          chunksCount: 0,
          storageId: existingPaper.storageId ?? undefined,
        };
      }
      if (!pdfEnabled) {
        if (
          existingPaper.abstract &&
          existingPaper.abstract.length > MIN_ABSTRACT_LENGTH
        ) {
          await ctx.runMutation(
            internal.extraction.mutations.evidence.replacePaperEvidenceUnits,
            {
              paperId: args.paperId,
              expectedEpoch: args.expectedEpoch,
              units: [],
            },
          );
          return {
            status: "completed",
            chunksCount: 0,
          };
        }
        return {
          status: "failed",
          error: mkError(
            "pdf_invalid",
            "PDF processing is disabled and no usable abstract is available.",
          ),
        };
      }

      const resolved = await resolvePdfBlob(ctx, job, {
        paperId: args.paperId,
        jobId: args.jobId,
        pdfUrl: existingPaper.pdfUrl ?? "",
        storageId: existingPaper.storageId,
        doi: existingPaper.doi,
      });

      // Keep pipeline alive for abstract-only papers by leaving evidence empty.
      if (!resolved.pdfBlob) {
        if (
          existingPaper.abstract &&
          existingPaper.abstract.length > MIN_ABSTRACT_LENGTH
        ) {
          const control = await ctx.runQuery(
            internal.extraction.queries.internal.getJobStatusInternal,
            { jobId: args.jobId },
          );
          const skipReason = getWorkerSkipReason(control, args.expectedEpoch);
          if (skipReason) {
            return { status: "skipped", reason: skipReason };
          }
          await ctx.runMutation(
            internal.extraction.mutations.evidence.replacePaperEvidenceUnits,
            {
              paperId: args.paperId,
              expectedEpoch: args.expectedEpoch,
              units: [],
            },
          );
          return {
            status: "completed",
            chunksCount: 0,
            storageId: resolved.storageId,
          };
        }
        return {
          status: "failed",
          error: mkError(
            "pdf_download_failed",
            resolved.error || "No PDF available",
          ),
        };
      }

      const beforeParse = await ctx.runQuery(
        internal.extraction.queries.internal.getJobStatusInternal,
        { jobId: args.jobId },
      );
      const beforeParseSkipReason = getWorkerSkipReason(
        beforeParse,
        args.expectedEpoch,
      );
      if (beforeParseSkipReason) {
        return { status: "skipped", reason: beforeParseSkipReason };
      }

      const pdfBuffer = await resolved.pdfBlob.arrayBuffer();
      const units = await buildEvidenceUnitsFromPdf(pdfBuffer);

      const beforePersist = await ctx.runQuery(
        internal.extraction.queries.internal.getJobStatusInternal,
        { jobId: args.jobId },
      );
      const beforePersistSkipReason = getWorkerSkipReason(
        beforePersist,
        args.expectedEpoch,
      );
      if (beforePersistSkipReason) {
        return { status: "skipped", reason: beforePersistSkipReason };
      }

      let storedId = resolved.storageId;
      if (!storedId) {
        storedId = await ctx.storage.store(resolved.pdfBlob);
        await ctx.runMutation(
          internal.extraction.mutations.papers.setPaperStorage,
          {
            paperId: args.paperId,
            storageId: storedId,
            expectedEpoch: args.expectedEpoch,
          },
        );
      }

      await ctx.runMutation(
        internal.extraction.mutations.evidence.replacePaperEvidenceUnits,
        {
          paperId: args.paperId,
          expectedEpoch: args.expectedEpoch,
          units: units.map((unit) => ({
            evidenceId: unit.evidenceId,
            page: unit.page,
            charRange: unit.charRange,
            text: unit.text,
            section: unit.section,
            tokens: unit.tokens,
            anchorConfidence: unit.anchorConfidence,
            source: unit.source,
          })),
        },
      );

      if (units.length > 0) {
        const beforeRag = await ctx.runQuery(
          internal.extraction.queries.internal.getJobStatusInternal,
          { jobId: args.jobId },
        );
        const beforeRagSkipReason = getWorkerSkipReason(
          beforeRag,
          args.expectedEpoch,
        );
        if (beforeRagSkipReason) {
          return { status: "skipped", reason: beforeRagSkipReason };
        }

        const ragResult = await rag.add(ctx, {
          namespace: `extraction:${args.jobId}`,
          key: `${args.paperId}:evidence-v3`,
          chunks: units.map((unit) => ({
            text: unit.text,
            metadata: {
              evidenceId: unit.evidenceId,
              page: unit.page,
              charRange: unit.charRange,
              section: unit.section || "body",
              anchorConfidence: unit.anchorConfidence,
            },
          })),
          filterValues: [{ name: "paperId", value: args.paperId }],
          metadata: { paperId: args.paperId },
        });

        const embeddingTokens = ragResult.usage?.tokens ?? 0;
        const embeddingCostDollars =
          estimateEmbeddingCostDollars(embeddingTokens);
        const embeddingCreditsToDeduct =
          convertServerCostDollarsToCredits(embeddingCostDollars);

        // If the job was cancelled mid-indexing, flip isIndexed but do not
        // charge the user — preserves the existing UX decision that a cancelled
        // job is free. If not cancelled, billing is done atomically with the
        // isIndexed flip inside markPaperIndexed, gated on indexingBilled so
        // workpool retries are safe.
        const freshControl = await ctx.runQuery(
          internal.extraction.queries.internal.getJobStatusInternal,
          { jobId: args.jobId },
        );
        const freshSkipReason = getWorkerSkipReason(
          freshControl,
          args.expectedEpoch,
        );
        if (freshSkipReason) {
          return { status: "skipped", reason: freshSkipReason };
        }
        const shouldBill =
          freshControl.status !== "cancelled" && embeddingCreditsToDeduct > 0;

        await ctx.runMutation(
          internal.extraction.mutations.papers.markPaperIndexed,
          {
            paperId: args.paperId,
            expectedEpoch: args.expectedEpoch,
            ragEntryId: ragResult.entryId,
            billing: shouldBill
              ? {
                  userId: job.userId,
                  jobId: args.jobId,
                  creditsToDeduct: embeddingCreditsToDeduct,
                  embeddingTokens,
                }
              : undefined,
          },
        );
      }

      return {
        status: "completed",
        chunksCount: units.length,
        storageId: storedId,
      };
    } catch (error) {
      return {
        status: "failed",
        error: toClassifiedError(
          error,
          "indexing_failed",
          "Unknown indexing error",
        ),
      };
    }
  },
});

// ──────────────────────────────────────────────────────────────────────
// Plan-02 per-question action
// ──────────────────────────────────────────────────────────────────────

type PerQuestionOutcome = {
  result: ExtractionQuestionResult;
  usage: { inputTokens: number; outputTokens: number };
  trackingEntry: AITrackingEntry | null;
};

/**
 * One-question extraction pipeline. Factored out of `waitAndExtractAction`
 * so the new per-question workflow step can call it without rebuilding
 * the three-mode (abstract-only / no-content / PDF-evidence) selector
 * that `waitAndExtractAction` encapsulates.
 *
 * Errors propagate so the workflow-step retry budget is meaningful —
 * catching + recording a failure row is the workflow handler's job once
 * retries exhaust. See `recordOneAnswerFailure`.
 */
async function runOneQuestionExtraction(params: {
  ctx: ActionCtx;
  paperId: Id<"extractionPapers">;
  jobId: Id<"extractionJobs">;
  model: Awaited<ReturnType<typeof getModel>>;
  question: {
    key: string;
    question: string;
    type: "string" | "boolean" | "number" | "array";
    description?: string;
  };
  abstractText: string | undefined;
  abstractPresent: boolean;
  units: EvidenceUnitDoc[];
  pdfEnabled: boolean;
}): Promise<PerQuestionOutcome> {
  const {
    ctx,
    paperId,
    jobId,
    model,
    question,
    abstractText,
    abstractPresent,
    units,
    pdfEnabled,
  } = params;

  if (units.length === 0) {
    if (abstractText) {
      const qStart = Date.now();
      const { result, usage, prompt } = await extractQuestionAnswerFromAbstract(
        {
          model,
          question,
          abstract: abstractText,
          pdfEnabled,
        },
      );
      const qLatency = Date.now() - qStart;
      console.info(
        "[extractOneQuestion] question diagnostics",
        JSON.stringify({
          paperId,
          questionKey: question.key,
          mode: "abstract_only",
          abstractPresent,
          denseCandidates: 0,
          lexicalCandidates: 0,
          fusedCandidates: 0,
          citationStatus: result.citationStatus,
          selectedEvidenceIds: [],
        }),
      );
      return {
        result,
        usage,
        trackingEntry: {
          feature: "extraction_question_abstract",
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          },
          latencyMs: qLatency,
          input: truncateForTracking(prompt),
          output: truncateForTracking(JSON.stringify(result)),
          temperature: 0,
        },
      };
    }

    const noContentResult: ExtractionQuestionResult = {
      questionKey: question.key,
      answer: null,
      confidence: 0,
      reasoning:
        "No PDF evidence and no usable abstract are available for this paper.",
      citations: [],
      citationStatus: "insufficient_evidence",
      retrievalDiagnostics: {
        denseCandidates: 0,
        lexicalCandidates: 0,
        fusedCandidates: 0,
        rerankedCandidates: 0,
        validatedCitations: 0,
        strictNull: true,
      },
      pdfContentUsed: false,
    };
    console.info(
      "[extractOneQuestion] question diagnostics",
      JSON.stringify({
        paperId,
        questionKey: question.key,
        mode: "no_content",
        abstractPresent,
        denseCandidates: 0,
        lexicalCandidates: 0,
        fusedCandidates: 0,
        citationStatus: noContentResult.citationStatus,
        selectedEvidenceIds: [],
      }),
    );
    return {
      result: noContentResult,
      usage: { inputTokens: 0, outputTokens: 0 },
      trackingEntry: null,
    };
  }

  const [denseScores, lexicalScores] = await Promise.all([
    runDenseSearch(ctx, `extraction:${jobId}`, paperId, question.question),
    scoreLexicalEvidence(
      question.question,
      units.map((unit) => ({
        evidenceId: unit.evidenceId,
        tokens: unit.tokens,
      })),
      DENSE_LIMIT,
    ),
  ]);
  const fusedScores = reciprocalRankFuse(
    denseScores,
    lexicalScores,
    RRF_CONSTANT,
  );
  const byEvidenceId = new Map(units.map((unit) => [unit.evidenceId, unit]));
  const fusedCandidates: RetrievalCandidate[] = [];
  for (const row of fusedScores.slice(0, FUSED_TOP_N)) {
    const unit = byEvidenceId.get(row.evidenceId);
    if (!unit) continue;
    fusedCandidates.push({
      unit,
      denseScore: row.denseScore,
      lexicalScore: row.lexicalScore,
      fusedScore: row.fusedScore,
    });
  }
  const evidencePool = fusedCandidates.slice(0, EVIDENCE_POOL_N);
  const diagnosticsSeed = {
    denseCandidates: denseScores.length,
    lexicalCandidates: lexicalScores.length,
    fusedCandidates: fusedCandidates.length,
    rerankedCandidates: evidencePool.length,
  };

  const qStart = Date.now();
  const { result, usage, prompt } = await extractQuestionAnswer({
    model,
    question,
    abstract: abstractText,
    evidencePool,
    diagnosticsSeed,
  });
  const qLatency = Date.now() - qStart;

  console.info(
    "[extractOneQuestion] question diagnostics",
    JSON.stringify({
      paperId,
      questionKey: question.key,
      mode: "pdf_evidence",
      abstractPresent,
      denseCandidates: diagnosticsSeed.denseCandidates,
      lexicalCandidates: diagnosticsSeed.lexicalCandidates,
      fusedCandidates: diagnosticsSeed.fusedCandidates,
      citationStatus: result.citationStatus,
      selectedEvidenceIds: result.citations.map((c) => c.evidenceId),
    }),
  );

  return {
    result,
    usage,
    trackingEntry: {
      feature: "extraction_question_pdf",
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
      latencyMs: qLatency,
      input: truncateForTracking(prompt),
      output: truncateForTracking(JSON.stringify(result)),
      temperature: 0,
    },
  };
}

export const extractOneQuestion = internalAction({
  args: {
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
    questionId: v.id("extractionQuestions"),
    expectedEpoch: v.number(),
  },
  returns: v.union(
    v.object({ status: v.literal("completed") }),
    v.object({
      status: v.literal("skipped"),
      reason: v.union(
        v.literal("already_billed"),
        v.literal("cancelled"),
        v.literal("job_terminal"),
        v.literal("credits_exhausted"),
        // Plan-06: question was already enqueued before the user hit
        // pause. The workflow gate stops NEW dispatches; this guard
        // handles the ones already in flight.
        v.literal("paused"),
        v.literal("stale_epoch"),
      ),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    | { status: "completed" }
    | {
        status: "skipped";
        reason:
          | "already_billed"
          | "cancelled"
          | "job_terminal"
          | "credits_exhausted"
          | "paused"
          | "stale_epoch";
      }
  > => {
    const question = await ctx.runQuery(
      internal.extraction.queries.internal.getQuestionByIdInternal,
      { questionId: args.questionId },
    );
    if (!question) {
      throw createError("NOT_FOUND", "Question not found");
    }

    const [paper, jobWithFlags, existingResult] = await Promise.all([
      ctx.runQuery(internal.extraction.queries.papers.byId, {
        paperId: args.paperId,
      }),
      ctx.runQuery(
        internal.extraction.queries.internal.getJobAndFlagsInternal,
        {
          jobId: args.jobId,
        },
      ),
      ctx.runQuery(
        internal.extraction.queries.internal
          .getResultByPaperAndQuestionInternal,
        { paperId: args.paperId, questionKey: question.key },
      ),
    ]);
    if (!paper) {
      throw createError("NOT_FOUND", "Paper not found");
    }
    const { job, pdfEnabled } = jobWithFlags;
    if (!job) {
      throw createError("NOT_FOUND", "Job not found");
    }

    // Billing-idempotency gate: a workpool retry after a successful
    // persist must skip the LLM round trip and the credit charge.
    if (existingResult?.billed) {
      console.log(
        `[extractOneQuestion] Skipping ${args.paperId}:${question.key}; already billed`,
      );
      return { status: "skipped", reason: "already_billed" };
    }
    const initialSkipReason = getWorkerSkipReason(
      {
        status: job.status ?? null,
        runEpoch: job.runEpoch ?? 0,
      },
      args.expectedEpoch,
    );
    if (initialSkipReason) {
      return { status: "skipped", reason: initialSkipReason };
    }

    const operation = `Extraction (1 question)`;
    const [billingUser, balance, unitsRaw, model, pricing] = await Promise.all([
      ctx.runQuery(internal.users.internal.getUserById, {
        userId: job.userId,
      }),
      ctx.runQuery(internal.credits.internal.getBalanceByUserId, {
        userId: job.userId,
      }),
      ctx.runQuery(
        internal.extraction.queries.internal.getEvidenceUnitsInternal,
        {
          paperId: args.paperId,
        },
      ),
      getModel(),
      fetchServerPricing(ctx),
    ]);
    if (!billingUser) {
      throw createError(
        "AI_UNAUTHENTICATED",
        "Authentication required to use AI features",
      );
    }

    // Plan-03: detect credit exhaustion at the pre-flight check and at
    // the recordOneAnswer deductCredits call. Transition the job to
    // creditsExhausted (non-terminal) and re-throw so the workflow
    // records a per-question failure row that plan-06's resume path
    // will retry.
    const handleCreditsExhaustionAndRethrow = async (
      error: unknown,
    ): Promise<never> => {
      const classified = classifyUnknownError(error);
      if (classified.code === "insufficient_credits") {
        try {
          await ctx.runMutation(
            internal.extraction.mutations.results.updateJobStatus,
            {
              jobId: args.jobId,
              expectedEpoch: args.expectedEpoch,
              status: "creditsExhausted",
              error: {
                code: classified.code,
                message: classified.message,
                context: classified.context,
                httpStatus: classified.httpStatus,
                providerName: classified.providerName,
                at: Date.now(),
              },
            },
          );
          await captureServerEvent(
            billingUser.clerkId,
            "extraction_job_credits_exhausted",
            {
              job_id: args.jobId,
              question_key: question.key,
            },
          );
        } catch (transitionErr) {
          console.warn(
            `[extractOneQuestion] Failed to transition job to creditsExhausted: ${transitionErr}`,
          );
        }
      }
      throw error;
    };

    if (!balance || balance.total < ESTIMATED_CREDITS_PER_QUERY) {
      await captureServerEvent(billingUser.clerkId, "credits_insufficient", {
        required_credits: ESTIMATED_CREDITS_PER_QUERY,
        available_credits: balance?.total ?? 0,
        feature: operation,
      });
      // handleCreditsExhaustionAndRethrow is typed Promise<never> but
      // TS does not narrow `balance` across an awaited throw-helper, so
      // the explicit throw below is unreachable yet keeps the flow
      // analyser happy for the downstream `balance.total` references.
      await handleCreditsExhaustionAndRethrow(
        createError(
          "AI_INSUFFICIENT_CREDITS",
          "Insufficient credits for AI operation",
        ),
      );
      throw createError(
        "AI_INSUFFICIENT_CREDITS",
        "Insufficient credits for AI operation",
      );
    }

    const units: EvidenceUnitDoc[] = (unitsRaw || []).map((unit) => ({
      evidenceId: unit.evidenceId,
      page: unit.page,
      charRange: toTupleRange(unit.charRange),
      text: unit.text,
      section: unit.section,
      tokens: Array.isArray(unit.tokens) ? unit.tokens : [],
      anchorConfidence: unit.anchorConfidence,
      source: unit.source,
    }));

    const abstractPresent = isUsableAbstract(paper.abstract);
    const abstractText = abstractPresent ? paper.abstract!.trim() : undefined;

    const startedAt = Date.now();
    const outcome = await runOneQuestionExtraction({
      ctx,
      paperId: args.paperId,
      jobId: args.jobId,
      model,
      question: {
        key: question.key,
        question: question.question,
        type: question.type,
        description: question.description,
      },
      abstractText,
      abstractPresent,
      units,
      pdfEnabled,
    });
    const latencyMs = Date.now() - startedAt;

    const creditsUsed = calculateServerCreditsToDeduct(outcome.usage, pricing);

    const beforePersist = await ctx.runQuery(
      internal.extraction.queries.internal.getJobStatusInternal,
      { jobId: args.jobId },
    );
    const beforePersistSkipReason = getWorkerSkipReason(
      beforePersist,
      args.expectedEpoch,
    );
    if (beforePersistSkipReason) {
      return { status: "skipped", reason: beforePersistSkipReason };
    }

    // Persist + bill in one transaction. recordOneAnswer internally
    // gates on result.billed, so a late workpool retry that re-runs
    // this action after a successful persist is still a no-op.
    // Plan-03: a mid-run insufficient_credits throw here transitions
    // the job to creditsExhausted before bubbling the error up.
    try {
      await ctx.runMutation(
        internal.extraction.mutations.results.recordOneAnswer,
        {
          paperId: args.paperId,
          questionKey: question.key,
          result: {
            answer: outcome.result.answer,
            confidence: outcome.result.confidence,
            reasoning: outcome.result.reasoning,
            citations: outcome.result.citations,
            citationStatus: outcome.result.citationStatus,
            retrievalDiagnostics: outcome.result.retrievalDiagnostics,
            pdfContentUsed: outcome.result.pdfContentUsed,
          },
          creditsUsed,
          expectedEpoch: args.expectedEpoch,
        },
      );
    } catch (error) {
      await handleCreditsExhaustionAndRethrow(error);
    }

    const creditContext = {
      creditsDeducted: creditsUsed,
      creditsRawCost: calculateServerRawCreditCost(outcome.usage, pricing),
      creditsRemaining: Math.max(0, balance.total - creditsUsed),
    };
    if (outcome.trackingEntry) {
      await captureAIGenerationServer({
        distinctId: billingUser.clerkId,
        provider: SERVER_AI_CONFIG.provider as AIProvider,
        modelId: SERVER_AI_CONFIG.model,
        feature: outcome.trackingEntry.feature,
        usage: outcome.trackingEntry.usage,
        latencyMs,
        input: outcome.trackingEntry.input,
        output: outcome.trackingEntry.output,
        temperature: outcome.trackingEntry.temperature,
        ...creditContext,
      });
    }

    return { status: "completed" };
  },
});
