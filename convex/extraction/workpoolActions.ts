"use node";

import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { components, internal } from "../_generated/api";
import { RAG } from "@convex-dev/rag";
import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { convertUsdToCredits, creditsForUsage } from "../../lib/pricing";
import { resolveOpenRouterModel } from "../chat/provider";
type ExtractionModel = Awaited<ReturnType<typeof resolveOpenRouterModel>>["model"];
type ExtractionPricing = Awaited<ReturnType<typeof resolveOpenRouterModel>>["pricing"];
import { callOptions, type Effort } from "../../lib/ai/core/call-options";
import { decideYesNo, paperState } from "../../lib/ai/decisions";
import { usageOf } from "../../lib/ai/core/cost";
import type { Usage } from "../../lib/ai/core/types";
import {
  truncateForTracking,
  type AITrackingEntry,
} from "../../lib/posthog-ai-shared";
import { captureAIGenerationServer } from "../../lib/posthog-server";
import type { AIProvider } from "../../lib/types";
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
    supportEvidenceIds: z.array(z.string()),
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
  usage: Usage;
  prompt: string;
};

async function extractQuestionAnswer(params: {
  model: ExtractionModel;
  effort?: Effort;
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
  const { model, effort, question, abstract, evidencePool, diagnosticsSeed } = params;

  try {
    const prompt = buildEnhancedExtractionPrompt(
      question as ExtractionQuestion,
      abstract,
      toEvidenceContext(evidencePool),
    );

    const generated = await generateText({
      model,
      output: Output.object({ schema: buildAnswerSchema(question.type) }),
      prompt,
      temperature: 0,
      providerOptions: callOptions(model, { effort }),
    });
    const object = generated.output;

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


    return {
      result,
      usage: usageOf(generated),
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
  model: ExtractionModel;
  effort?: Effort;
  question: {
    key: string;
    question: string;
    type: "string" | "boolean" | "number" | "array";
    description?: string;
  };
  abstract: string;
  pdfEnabled: boolean;
}): Promise<ExtractionWithUsage> {
  const { model, effort, question, abstract } = params;

  try {
    const prompt = buildEnhancedExtractionPrompt(
      question as ExtractionQuestion,
      abstract,
      [],
    );

    const generated = await generateText({
      model,
      output: Output.object({ schema: buildAnswerSchema(question.type) }),
      prompt,
      temperature: 0,
      providerOptions: callOptions(model, { effort }),
    });
    const object = generated.output;

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
      usage: usageOf(generated),
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
): Promise<{
  pdfBlob: Blob | null;
  storageId?: Id<"_storage">;
  error?: string;
}> {
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

export type JobWorkerSkipReason =
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
): JobWorkerSkipReason | null {
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

export type WorkerSkipReason = JobWorkerSkipReason | "already_billed";

export type IndexResult =
  | {
      status: "completed";
      storageId?: Id<"_storage">;
      chunksCount?: number;
      /** Credits the embedding cost; 0 when nothing was embedded. */
      embeddingCredits: number;
    }
  | {
      status: "skipped";
      reason: JobWorkerSkipReason;
    }
  | {
      status: "failed";
      error?: ClassifiedError;
    };

export type DownloadAndIndexPdfArgs = {
  paperId: Id<"extractionPapers">;
  jobId: Id<"extractionJobs">;
  expectedEpoch: number;
};

export async function runDownloadAndIndexPdf(
  ctx: ActionCtx,
  args: DownloadAndIndexPdfArgs,
): Promise<IndexResult> {
  let embeddingCredits = 0;
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
    // Doubles as the source of truth for pdfUrl/storageId/abstract/doi.
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
        `[runDownloadAndIndexPdf] paper ${args.paperId} already indexed/billed; skipping`,
      );
      return {
        status: "completed",
        chunksCount: 0,
        storageId: existingPaper.storageId ?? undefined,
        embeddingCredits,
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
          embeddingCredits,
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
          embeddingCredits,
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
      embeddingCredits = convertUsdToCredits({ usd: embeddingCostDollars });

      // A job cancelled mid-indexing is free: flip isIndexed without charging.
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
      if (freshControl.status === "cancelled") embeddingCredits = 0;

      await ctx.runMutation(
        internal.extraction.mutations.papers.markPaperIndexed,
        {
          paperId: args.paperId,
          expectedEpoch: args.expectedEpoch,
          ragEntryId: ragResult.entryId,
        },
      );
    }

    return {
      status: "completed",
      chunksCount: units.length,
      storageId: storedId,
      embeddingCredits,
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
}

type PerQuestionOutcome = {
  result: ExtractionQuestionResult;
  usage: Usage;
  trackingEntry: AITrackingEntry | null;
};

/**
 * One-question extraction pipeline used inside a paper-level batch.
 * Errors propagate to the batch runner so failures can be written once
 * through recordQuestionBatch.
 */
async function runOneQuestionExtraction(params: {
  ctx: ActionCtx;
  paperId: Id<"extractionPapers">;
  jobId: Id<"extractionJobs">;
  model: ExtractionModel;
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
  effort?: Effort;
}): Promise<PerQuestionOutcome> {
  const {
    ctx,
    paperId,
    jobId,
    model,
    effort,
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
          effort,
          question,
          abstract: abstractText,
          pdfEnabled,
        },
      );
      const qLatency = Date.now() - qStart;
      console.info(
        "[runExtractQuestionWithContext] question diagnostics",
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
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
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
      "[runExtractQuestionWithContext] question diagnostics",
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
    effort,
    question,
    abstract: abstractText,
    evidencePool,
    diagnosticsSeed,
  });
  const qLatency = Date.now() - qStart;

  console.info(
    "[runExtractQuestionWithContext] question diagnostics",
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
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
      },
      latencyMs: qLatency,
      input: truncateForTracking(prompt),
      output: truncateForTracking(JSON.stringify(result)),
      temperature: 0,
    },
  };
}

export type PaperExtractionContext = {
  job: Doc<"extractionJobs">;
  paper: Doc<"extractionPapers">;
  user: Doc<"users"> | null;
  pdfEnabled: boolean;
  questions: Array<Doc<"extractionQuestions">>;
  results: Array<Doc<"extractionResults">>;
  evidenceUnits: Array<Doc<"extractionEvidenceUnits">>;
};

export type CompletedQuestionBatchItem = {
  questionKey: string;
  result: ExtractionQuestionResult;
  creditsUsed: number;
  usage: Usage;
  trackingEntry: AITrackingEntry | null;
};

export type CompletedQuestionBatchWrite = {
  questionKey: string;
  result: {
    answer: ExtractionQuestionResult["answer"];
    confidence: ExtractionQuestionResult["confidence"];
    reasoning: ExtractionQuestionResult["reasoning"];
    citations: ExtractionQuestionResult["citations"];
    citationStatus: ExtractionQuestionResult["citationStatus"];
    retrievalDiagnostics: ExtractionQuestionResult["retrievalDiagnostics"];
    pdfContentUsed: ExtractionQuestionResult["pdfContentUsed"];
  };
  creditsUsed: number;
};

export type QuestionBatchOutcome =
  | ({ status: "completed" } & CompletedQuestionBatchItem)
  | {
      status: "failed";
      questionKey: string;
      error: ClassifiedError;
    }
  | {
      status: "skipped";
      questionKey: string;
      reason: WorkerSkipReason;
    };

export function toCompletedQuestionBatchWrite(
  outcome: CompletedQuestionBatchItem,
): CompletedQuestionBatchWrite {
  return {
    questionKey: outcome.questionKey,
    result: {
      answer: outcome.result.answer,
      confidence: outcome.result.confidence,
      reasoning: outcome.result.reasoning,
      citations: outcome.result.citations,
      citationStatus: outcome.result.citationStatus,
      retrievalDiagnostics: outcome.result.retrievalDiagnostics,
      pdfContentUsed: outcome.result.pdfContentUsed,
    },
    creditsUsed: outcome.creditsUsed,
  };
}

export function batchSkipReasonToWorkerSkipReason(reason: string): WorkerSkipReason {
  if (reason === "paused") return "paused";
  if (reason === "credits_exhausted") return "credits_exhausted";
  if (reason === "stale_epoch") return "stale_epoch";
  return "job_terminal";
}

export async function captureCompletedQuestionTracking({
  distinctId,
  outcomes,
  persistedQuestionKeys,
  modelSlug,
}: {
  distinctId: string;
  outcomes: ReadonlyArray<CompletedQuestionBatchItem>;
  persistedQuestionKeys: ReadonlySet<string>;
  modelSlug: string;
}): Promise<void> {
  await Promise.all(
    outcomes.map(async (outcome) => {
      if (
        !outcome.trackingEntry ||
        !persistedQuestionKeys.has(outcome.questionKey)
      ) {
        return;
      }
      await captureAIGenerationServer({
        distinctId,
        provider: "openrouter" as AIProvider,
        modelId: modelSlug,
        feature: outcome.trackingEntry.feature,
        usage: outcome.trackingEntry.usage,
        latencyMs: outcome.trackingEntry.latencyMs,
        input: outcome.trackingEntry.input,
        output: outcome.trackingEntry.output,
        temperature: outcome.trackingEntry.temperature,
        creditsDeducted: outcome.creditsUsed,
      });
    }),
  );
}

function toEvidenceUnitDocs(
  unitsRaw: ReadonlyArray<Doc<"extractionEvidenceUnits">>,
): EvidenceUnitDoc[] {
  return unitsRaw.map((unit) => ({
    evidenceId: unit.evidenceId,
    page: unit.page,
    charRange: toTupleRange(unit.charRange),
    text: unit.text,
    section: unit.section,
    tokens: Array.isArray(unit.tokens) ? unit.tokens : [],
    anchorConfidence: unit.anchorConfidence,
    source: unit.source,
  }));
}

function getExistingResult(
  context: Pick<PaperExtractionContext, "results">,
  questionKey: string,
): Doc<"extractionResults"> | null {
  return (
    context.results.find((result) => result.questionKey === questionKey) ?? null
  );
}

function getQuestionEntrySkipReason({
  job,
  existingResult,
  expectedEpoch,
}: {
  job: Doc<"extractionJobs">;
  existingResult: Doc<"extractionResults"> | null;
  expectedEpoch: number;
}): WorkerSkipReason | null {
  if (existingResult?.billed) return "already_billed";
  return getWorkerSkipReason(
    {
      status: job.status ?? null,
      runEpoch: job.runEpoch ?? 0,
    },
    expectedEpoch,
  );
}

export async function runExtractQuestionWithContext({
  ctx,
  context,
  question,
  expectedEpoch,
  model,
  pricing,
}: {
  ctx: ActionCtx;
  context: PaperExtractionContext;
  question: Doc<"extractionQuestions">;
  expectedEpoch: number;
  model: ExtractionModel;
  pricing: ExtractionPricing;
}): Promise<QuestionBatchOutcome> {
  const existingResult = getExistingResult(context, question.key);
  const skipReason = getQuestionEntrySkipReason({
    job: context.job,
    existingResult,
    expectedEpoch,
  });
  if (skipReason) {
    if (skipReason === "already_billed") {
      console.log(
        `[runExtractQuestionWithContext] Skipping ${context.paper._id}:${question.key}; already billed`,
      );
    }
    return {
      status: "skipped",
      questionKey: question.key,
      reason: skipReason,
    };
  }
  if (!context.user) {
    throw createError(
      "AI_UNAUTHENTICATED",
      "Authentication required to use AI features",
    );
  }

  const units = toEvidenceUnitDocs(context.evidenceUnits);
  const abstractPresent = isUsableAbstract(context.paper.abstract);
  const abstractText = abstractPresent
    ? context.paper.abstract!.trim()
    : undefined;

  const startedAt = Date.now();
  const outcome = await runOneQuestionExtraction({
    ctx,
    paperId: context.paper._id,
    jobId: context.job._id,
    model,
    effort: context.job.serverEffort,
    question: {
      key: question.key,
      question: question.question,
      type: question.type,
      description: question.description,
    },
    abstractText,
    abstractPresent,
    units,
    pdfEnabled: context.pdfEnabled,
  });
  const latencyMs = Date.now() - startedAt;
  return {
    status: "completed",
    questionKey: question.key,
    result: outcome.result,
    creditsUsed: creditsForUsage(outcome.usage, pricing),
    usage: outcome.usage,
    trackingEntry: outcome.trackingEntry
      ? { ...outcome.trackingEntry, latencyMs }
      : null,
  };
}

/**
 * Yes/no questions about one paper, answered by a decision model (Jev) in one
 * call. Jev cites nothing and gives no reasoning, so answers follow the
 * abstract-only rules: grounded when PDFs are off, best effort when they're on.
 */
export async function runDecisionQuestions({
  context,
  questions,
  expectedEpoch,
  modelSlug,
  pricing,
}: {
  context: PaperExtractionContext;
  questions: ReadonlyArray<Doc<"extractionQuestions">>;
  expectedEpoch: number;
  modelSlug: string;
  pricing: ExtractionPricing;
}): Promise<QuestionBatchOutcome[]> {
  const outcomes: QuestionBatchOutcome[] = [];
  const asked: Array<Doc<"extractionQuestions">> = [];
  for (const question of questions) {
    const reason = getQuestionEntrySkipReason({ job: context.job, existingResult: getExistingResult(context, question.key), expectedEpoch });
    if (reason) outcomes.push({ status: "skipped", questionKey: question.key, reason });
    else asked.push(question);
  }
  if (asked.length === 0) return outcomes;
  if (!context.user) throw createError("AI_UNAUTHENTICATED", "Authentication required to use AI features");

  const prompts = asked.map((q) => (q.description ? `${q.question} (${q.description})` : q.question));
  const state = paperState(
    {
      title: context.paper.title,
      abstract: isUsableAbstract(context.paper.abstract) ? context.paper.abstract!.trim() : undefined,
      fullText: toEvidenceUnitDocs(context.evidenceUnits).map((unit) => unit.text).join("\n\n"),
    },
    prompts,
  );

  const startedAt = Date.now();
  try {
    const { answers, usage } = await decideYesNo({
      apiKey: process.env.OPENROUTER_API_KEY!,
      model: modelSlug,
      state,
      questions: prompts,
      sessionId: String(context.job._id),
    });
    const credits = creditsForUsage(usage, pricing);
    asked.forEach((question, i) => {
      const { answer, confidence } = answers[i]!;
      const result: ExtractionQuestionResult = {
        questionKey: question.key,
        answer,
        confidence: answer === null ? Math.min(confidence, STRICT_NULL_CONFIDENCE_CAP) : confidence,
        citations: [],
        citationStatus: answer === null ? "insufficient_evidence" : context.pdfEnabled ? "best_effort" : "grounded",
        retrievalDiagnostics: {
          denseCandidates: 0, lexicalCandidates: 0, fusedCandidates: 0, rerankedCandidates: 0, validatedCitations: 0,
          strictNull: answer === null,
        },
        pdfContentUsed: Boolean(state.fullText),
      };
      // The one call is charged once, on the first question it answered.
      outcomes.push({
        status: "completed",
        questionKey: question.key,
        result,
        creditsUsed: i === 0 ? credits : 0,
        usage: i === 0 ? usage : { costUsd: 0 },
        trackingEntry: i === 0
          ? {
              feature: "extraction_question_decision",
              usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 },
              latencyMs: Date.now() - startedAt,
              input: truncateForTracking(JSON.stringify({ questions: prompts })),
              output: truncateForTracking(JSON.stringify(answers)),
              temperature: 0,
            }
          : null,
      });
    });
  } catch (error) {
    console.error(`[runDecisionQuestions] ${modelSlug} failed for paper ${context.paper._id}`, error);
    for (const question of asked) outcomes.push({ status: "failed", questionKey: question.key, error: classifyUnknownError(error) });
  }
  return outcomes;
}
