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
import { truncateForTracking, type AITrackingEntry } from "../../lib/posthog-ai-shared";
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
import { MIN_ABSTRACT_LENGTH } from "./content";
import { buildEnhancedExtractionPrompt, type ExtractionQuestion } from "./prompts";
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
} from "../../lib/extraction/insights";
import {
  answerValidator,
  citationStatusValidator,
  citationValidator,
  questionInputValidator,
  retrievalDiagnosticsValidator,
} from "./validators";

type CitationStatus =
  | "grounded"
  | "best_effort"
  | "insufficient_evidence"
  | "extraction_error";

type Citation = {
  evidenceId: string;
  page: number;
  charRange: [number, number];
  quote: string;
  retrieval: {
    denseScore?: number;
    lexicalScore?: number;
    fusedScore?: number;
    rerankScore?: number;
  };
  validated: true;
};

type RetrievalDiagnostics = {
  denseCandidates: number;
  lexicalCandidates: number;
  fusedCandidates: number;
  rerankedCandidates: number;
  validatedCitations: number;
  strictNull: boolean;
};

type ExtractionQuestionResult = {
  questionKey: string;
  answer: string | boolean | number | string[] | null;
  confidence?: number;
  reasoning?: string;
  citations: Citation[];
  citationStatus: CitationStatus;
  retrievalDiagnostics: RetrievalDiagnostics;
  pdfContentUsed?: boolean;
};

type EvidenceUnitDoc = {
  evidenceId: string;
  page: number;
  charRange: [number, number];
  text: string;
  section?: string;
  tokens: string[];
  anchorConfidence: number;
  source: string;
};

type RetrievalCandidate = {
  unit: EvidenceUnitDoc;
  denseScore?: number;
  lexicalScore?: number;
  fusedScore?: number;
  rerankScore?: number;
};

type StrictExtractionOutput = {
  answer: string | boolean | number | string[] | null;
  confidence: number;
  reasoning: string;
  supportEvidenceIds: string[];
};

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
/**
 * Upper bound on simultaneous per-question LLM round trips for a single
 * paper. Questions are independent so running them in parallel turns wall
 * time from O(Q) into ~O(1); the cap keeps provider rate-limits quiet
 * under a full `pdfProcessingPool` (each paper × this = outbound cap).
 */
const QUESTION_CONCURRENCY_PER_PAPER = 5;

/**
 * Bounded-concurrency `Promise.all` — fires at most `concurrency` workers,
 * each pulls the next index until the input is drained. Order-preserving,
 * no external dependency.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    worker,
  );
  await Promise.all(workers);
  return results;
}
const BEST_EFFORT_MAX_CITATIONS = 2;
const BEST_EFFORT_CONFIDENCE_CAP = 0.45;
const ABSTRACT_ONLY_CONFIDENCE_CAP = 0.7;
const STRICT_NULL_CONFIDENCE_CAP = 0.3;
const ARRAY_ANSWER_MAX_ITEMS = 8;
const ARRAY_GENERIC_PENALTY = 0.15;
const ARRAY_GENERIC_THRESHOLD = 0.6;
const DEFAULT_EXTRACTION_EMBEDDING_USD_PER_1M_TOKENS = 0.02;
function parsePositiveFloat(input: string | undefined, fallback: number): number {
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

function toErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "message" in data) {
      const message = (data as { message?: unknown }).message;
      if (typeof message === "string" && message.length > 0) {
        return message;
      }
    }
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return fallback;
}

function toTupleRange(charRange: number[] | [number, number]): [number, number] {
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

function dedupeEvidenceIds(ids: string[]) {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered;
}

function sanitizeArrayAnswer(
  answer: string[] | string | null | undefined
): { answer: string[] | null; genericShare: number } {
  if (answer === null || answer === undefined) {
    return { answer: null, genericShare: 0 };
  }

  const values = Array.isArray(answer) ? answer : [answer];
  const normalized = new Set<string>();
  for (const value of values) {
    for (const token of splitArrayFragments(String(value))) {
      normalized.add(token);
    }
  }

  const cleaned = Array.from(normalized).sort().slice(0, ARRAY_ANSWER_MAX_ITEMS);
  if (cleaned.length === 0) {
    return { answer: null, genericShare: 0 };
  }

  const genericCount = cleaned.filter((value) => isGenericArrayEntity(value)).length;
  return {
    answer: cleaned,
    genericShare: genericCount / cleaned.length,
  };
}

export function normalizeExtractionOutputForQuestion(
  questionType: "string" | "boolean" | "number" | "array",
  extracted: StrictExtractionOutput
): StrictExtractionOutput {
  if (questionType !== "array") {
    return extracted;
  }

  const sanitized = sanitizeArrayAnswer(
    Array.isArray(extracted.answer) || typeof extracted.answer === "string"
      ? (extracted.answer as string[] | string)
      : null
  );

  const shouldPenalize =
    sanitized.answer !== null && sanitized.genericShare >= ARRAY_GENERIC_THRESHOLD;
  const confidence = shouldPenalize
    ? Math.max(0, extracted.confidence - ARRAY_GENERIC_PENALTY)
    : extracted.confidence;

  return {
    ...extracted,
    answer: sanitized.answer,
    confidence: Math.min(1, confidence),
  };
}

export function validateSupportEvidenceIds(
  supportEvidenceIds: string[],
  evidencePool: RetrievalCandidate[]
): RetrievalCandidate[] {
  const byId = new Map<string, RetrievalCandidate>();
  for (const candidate of evidencePool) {
    byId.set(candidate.unit.evidenceId, candidate);
  }

  const valid: RetrievalCandidate[] = [];
  for (const id of dedupeEvidenceIds(supportEvidenceIds)) {
    const found = byId.get(id);
    if (!found) continue;
    valid.push(found);
  }
  return valid;
}

export function applyEvidencePolicy(params: {
  extracted: StrictExtractionOutput;
  validated: RetrievalCandidate[];
  fallbackCandidates: RetrievalCandidate[];
}): {
  answer: string | boolean | number | string[] | null;
  confidence: number;
  citationStatus: CitationStatus;
  strictNull: boolean;
  selectedCandidates: RetrievalCandidate[];
} {
  if (params.validated.length > 0) {
    return {
      answer: params.extracted.answer,
      confidence: params.extracted.confidence,
      citationStatus: "grounded",
      strictNull: false,
      selectedCandidates: params.validated,
    };
  }

  const hasCandidateFallback = params.fallbackCandidates.length > 0;
  if (params.extracted.answer !== null && hasCandidateFallback) {
    return {
      answer: params.extracted.answer,
      confidence: Math.min(params.extracted.confidence, BEST_EFFORT_CONFIDENCE_CAP),
      citationStatus: "best_effort",
      strictNull: false,
      selectedCandidates: params.fallbackCandidates.slice(0, BEST_EFFORT_MAX_CITATIONS),
    };
  }

  return {
    answer: null,
    confidence: Math.min(params.extracted.confidence, STRICT_NULL_CONFIDENCE_CAP),
    citationStatus: "insufficient_evidence",
    strictNull: true,
    selectedCandidates: [],
  };
}

export function isUsableAbstract(abstract?: string | null) {
  return typeof abstract === "string" && abstract.trim().length > MIN_ABSTRACT_LENGTH;
}

export function applyAbstractOnlyPolicy(params: {
  extracted: StrictExtractionOutput;
  pdfEnabled: boolean;
}): {
  answer: string | boolean | number | string[] | null;
  confidence: number;
  citationStatus: CitationStatus;
  strictNull: boolean;
} {
  const pdfDisabled = !params.pdfEnabled;

  if (params.extracted.answer !== null) {
    // When PDF is disabled, abstract IS the authoritative source — no penalty.
    // When PDF is enabled but unavailable for this paper, cap as degraded mode.
    return {
      answer: params.extracted.answer,
      confidence: pdfDisabled
        ? params.extracted.confidence
        : Math.min(params.extracted.confidence, ABSTRACT_ONLY_CONFIDENCE_CAP),
      citationStatus: pdfDisabled ? "grounded" : "best_effort",
      strictNull: false,
    };
  }

  return {
    answer: null,
    confidence: Math.min(params.extracted.confidence, STRICT_NULL_CONFIDENCE_CAP),
    citationStatus: "insufficient_evidence",
    strictNull: true,
  };
}

function parseDenseScores(results: Array<{
  score?: number;
  content?: Array<{ metadata?: { evidenceId?: string } }>;
  metadata?: { evidenceId?: string };
}>): RankedEvidenceScore[] {
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
  question: string
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
  diagnosticsSeed: Omit<RetrievalDiagnostics, "validatedCitations" | "strictNull">;
}): Promise<ExtractionWithUsage> {
  const { model, question, abstract, evidencePool, diagnosticsSeed } = params;

  try {
    const prompt = buildEnhancedExtractionPrompt(
      question as ExtractionQuestion,
      abstract,
      toEvidenceContext(evidencePool)
    );

    const { output: object, usage } = await generateText({
      model,
      output: Output.object({ schema: buildAnswerSchema(question.type) }),
      prompt,
      temperature: 0,
      providerOptions: STANDARD_PROVIDER_OPTIONS as Parameters<typeof generateText>[0]["providerOptions"],
    });

    const extracted = normalizeExtractionOutputForQuestion(
      question.type,
      object as StrictExtractionOutput
    );
    const validated = validateSupportEvidenceIds(
      extracted.supportEvidenceIds || [],
      evidencePool
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
      []
    );

    const { output: object, usage } = await generateText({
      model,
      output: Output.object({ schema: buildAnswerSchema(question.type) }),
      prompt,
      temperature: 0,
      providerOptions: STANDARD_PROVIDER_OPTIONS as Parameters<typeof generateText>[0]["providerOptions"],
    });

    const extracted = normalizeExtractionOutputForQuestion(
      question.type,
      object as StrictExtractionOutput
    );
    const policy = applyAbstractOnlyPolicy({ extracted, pdfEnabled: params.pdfEnabled });
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
    }
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
    storageId?: string;
    doi?: string;
  },
): Promise<{ pdfBlob: Blob | null; storageId?: string; error?: string }> {
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
    zoteroApiKey = decryptApiKey(zoteroConnection.encryptedApiKey, encryptionKey, {
      userId: job?.userId ? String(job.userId) : "system",
      purpose: "zotero-pdf-download",
    });
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

  const storedId = await ctx.storage.store(downloaded.pdfBlob);
  await ctx.runMutation(internal.extraction.mutations.setPaperStorage, {
    paperId: args.paperId,
    storageId: storedId,
  });

  return { pdfBlob: downloaded.pdfBlob, storageId: storedId };
}

type IndexResult = {
  success: boolean;
  storageId?: string;
  chunksCount?: number;
  error?: string;
};

export const downloadAndIndexPdfAction = internalAction({
  args: {
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
    pdfUrl: v.string(),
    storageId: v.optional(v.id("_storage")),
    title: v.string(),
    abstract: v.optional(v.string()),
    doi: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    storageId: v.optional(v.string()),
    chunksCount: v.optional(v.number()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<IndexResult> => {
    try {
      // One round trip for job + pdf-flag instead of two.
      const { job, pdfEnabled } = await ctx.runQuery(
        internal.extraction.queries.getJobAndFlagsInternal,
        { jobId: args.jobId },
      );
      if (!job) {
        return {
          success: false,
          error: "Job not found",
        };
      }

      // Idempotency gate: a workpool retry that lands here after the paper
      // was already indexed (and billed) must not re-embed or re-charge.
      const existingPaper = await ctx.runQuery(
        internal.extraction.queries.getPaperInternal,
        { paperId: args.paperId },
      );
      if (existingPaper?.isIndexed || existingPaper?.indexingBilled) {
        console.log(
          `[downloadAndIndexPdfAction] paper ${args.paperId} already indexed/billed; skipping`,
        );
        return {
          success: true,
          chunksCount: 0,
          storageId: existingPaper.storageId ?? undefined,
        };
      }
      if (!pdfEnabled) {
        if (args.abstract && args.abstract.length > MIN_ABSTRACT_LENGTH) {
          await ctx.runMutation(internal.extraction.mutations.replacePaperEvidenceUnits, {
            paperId: args.paperId,
            units: [],
          });
          return {
            success: true,
            chunksCount: 0,
          };
        }
        return {
          success: false,
          error: "PDF processing is disabled and no usable abstract is available.",
        };
      }

      const resolved = await resolvePdfBlob(ctx, job, {
        paperId: args.paperId,
        jobId: args.jobId,
        pdfUrl: args.pdfUrl,
        storageId: args.storageId,
        doi: args.doi,
      });

      // Keep pipeline alive for abstract-only papers by leaving evidence empty.
      if (!resolved.pdfBlob) {
        if (args.abstract && args.abstract.length > MIN_ABSTRACT_LENGTH) {
          await ctx.runMutation(internal.extraction.mutations.replacePaperEvidenceUnits, {
            paperId: args.paperId,
            units: [],
          });
          return {
            success: true,
            chunksCount: 0,
            storageId: resolved.storageId,
            error: resolved.error,
          };
        }
        return { success: false, error: resolved.error || "No PDF available" };
      }

      const pdfBuffer = await resolved.pdfBlob.arrayBuffer();
      const units = await buildEvidenceUnitsFromPdf(pdfBuffer);

      await ctx.runMutation(internal.extraction.mutations.replacePaperEvidenceUnits, {
        paperId: args.paperId,
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
      });

      if (units.length > 0) {
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
        const embeddingCostDollars = estimateEmbeddingCostDollars(embeddingTokens);
        const embeddingCreditsToDeduct =
          convertServerCostDollarsToCredits(embeddingCostDollars);

        // If the job was cancelled mid-indexing, flip isIndexed but do not
        // charge the user — preserves the existing UX decision that a cancelled
        // job is free. If not cancelled, billing is done atomically with the
        // isIndexed flip inside markPaperIndexed, gated on indexingBilled so
        // workpool retries are safe.
        const freshJobForCredits = await ctx.runQuery(
          internal.extraction.queries.getJobInternal,
          { jobId: args.jobId },
        );
        const shouldBill =
          freshJobForCredits?.status !== "cancelled" &&
          embeddingCreditsToDeduct > 0;
        if (freshJobForCredits?.status === "cancelled") {
          console.log(
            `[creditGuard] Skipping embedding credit deduction - job ${args.jobId} cancelled`,
          );
        }

        await ctx.runMutation(internal.extraction.mutations.markPaperIndexed, {
          paperId: args.paperId,
          ragEntryId: ragResult.entryId,
          billing: shouldBill
            ? {
                userId: job.userId,
                jobId: args.jobId,
                creditsToDeduct: embeddingCreditsToDeduct,
                embeddingTokens,
              }
            : undefined,
        });
      }

      return {
        success: true,
        chunksCount: units.length,
        storageId: resolved.storageId,
      };
    } catch (error) {
      return {
        success: false,
        error: toErrorMessage(error, "Unknown indexing error"),
      };
    }
  },
});

export const waitAndExtractAction = internalAction({
  args: {
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
    questions: v.array(questionInputValidator),
  },
  returns: v.object({
    success: v.boolean(),
    results: v.optional(
      v.array(
        v.object({
          questionKey: v.string(),
          answer: answerValidator,
          confidence: v.optional(v.number()),
          reasoning: v.optional(v.string()),
          citations: v.array(citationValidator),
          citationStatus: citationStatusValidator,
          retrievalDiagnostics: retrievalDiagnosticsValidator,
          pdfContentUsed: v.optional(v.boolean()),
        }),
      ),
    ),
    creditsUsed: v.optional(v.number()),
    pdfContentUsed: v.optional(v.boolean()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<{
    success: boolean;
    results?: ExtractionQuestionResult[];
    creditsUsed?: number;
    pdfContentUsed?: boolean;
    error?: string;
  }> => {
    try {
      // Two round trips at the top instead of four — job+flags combined,
      // paper on its own. The credit-guard re-read of the job a bit below
      // is intentional (needs a fresh view to see a concurrent cancel).
      const [paper, jobWithFlags] = await Promise.all([
        ctx.runQuery(internal.extraction.queries.getPaperInternal, {
          paperId: args.paperId,
        }),
        ctx.runQuery(internal.extraction.queries.getJobAndFlagsInternal, {
          jobId: args.jobId,
        }),
      ]);
      if (!paper) {
        return { success: false, error: "Paper not found" };
      }
      const { job, pdfEnabled } = jobWithFlags;
      if (!job) {
        return { success: false, error: "Job not found" };
      }
      const unitsRaw = await ctx.runQuery(
        internal.extraction.queries.getEvidenceUnitsInternal,
        { paperId: args.paperId }
      );

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

      // Cancellation guard: if the job has been cancelled, abort the extraction
      // as a failure rather than returning a fake "success" with empty results.
      // Signalling success here would cause handleExtractionComplete to mark
      // the paper as completed and resurrect a terminated job.
      const freshJobForCredits = await ctx.runQuery(
        internal.extraction.queries.getJobInternal,
        { jobId: args.jobId }
      );
      if (freshJobForCredits?.status === "cancelled") {
        console.log(`[cancellationGuard] Aborting extraction - job ${args.jobId} cancelled`);
        return {
          success: false,
          error: "Job cancelled before extraction",
        };
      }

      // Billing-idempotency gate: if a previous run already billed this paper
      // and persisted results, a workpool retry must not re-charge the user.
      // The deduction itself happens inside saveExtractionResultsAndComplete
      // atomically with the results persist, gated on extractionBilled.
      if (paper.extractionBilled) {
        console.log(
          `[waitAndExtractAction] paper ${args.paperId} already billed; skipping LLM re-run`,
        );
        return {
          success: true,
          results: [],
          creditsUsed: 0,
          pdfContentUsed: paper.pdfContentUsed ?? false,
        };
      }

      // Credit pre-check so users without credits fail fast before any LLM
      // work happens. The authoritative deduction is deferred to
      // saveExtractionResultsAndComplete, where it runs in the same
      // transaction as the results persist, gated on paper.extractionBilled
      // so workpool retries cannot double-charge.
      const operation = `Extraction (${args.questions.length} questions)`;
      const billingUser = await ctx.runQuery(
        internal.users.internal.getUserById,
        { userId: job.userId },
      );
      if (!billingUser) {
        throw createError(
          "AI_UNAUTHENTICATED",
          "Authentication required to use AI features",
        );
      }
      const balance = await ctx.runQuery(
        internal.credits.internal.getBalanceByUserId,
        { userId: job.userId },
      );
      if (!balance || balance.total < ESTIMATED_CREDITS_PER_QUERY) {
        await captureServerEvent(billingUser.clerkId, "credits_insufficient", {
          required_credits: ESTIMATED_CREDITS_PER_QUERY,
          available_credits: balance?.total ?? 0,
          feature: operation,
        });
        throw createError(
          "AI_INSUFFICIENT_CREDITS",
          "Insufficient credits for AI operation",
        );
      }
      const pricing = await fetchServerPricing(ctx);

      const startedAt = Date.now();
      const extracted = await (async () => {
          const model = await getModel();
          const abstractPresent = isUsableAbstract(paper.abstract);
          const abstractText = abstractPresent ? paper.abstract!.trim() : undefined;

          type PerQuestionOutcome = {
            result: ExtractionQuestionResult;
            usage: { inputTokens: number; outputTokens: number };
            trackingEntry: AITrackingEntry | null;
            pdfEvidenceUsed: boolean;
          };

          const processQuestion = async (
            question: (typeof args.questions)[number],
          ): Promise<PerQuestionOutcome> => {
            try {
              if (units.length === 0) {
                if (abstractText) {
                  const qStart = Date.now();
                  const { result, usage, prompt } = await extractQuestionAnswerFromAbstract({
                    model,
                    question,
                    abstract: abstractText,
                    pdfEnabled,
                  });
                  const qLatency = Date.now() - qStart;
                  console.info(
                    "[waitAndExtractAction] question diagnostics",
                    JSON.stringify({
                      paperId: args.paperId,
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
                    pdfEvidenceUsed: false,
                  };
                }

                const noContentResult: ExtractionQuestionResult = {
                  questionKey: question.key,
                  answer: null,
                  confidence: 0,
                  reasoning: "No PDF evidence and no usable abstract are available for this paper.",
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
                  "[waitAndExtractAction] question diagnostics",
                  JSON.stringify({
                    paperId: args.paperId,
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
                  pdfEvidenceUsed: false,
                };
              }

              const denseScores = await runDenseSearch(
                ctx,
                `extraction:${args.jobId}`,
                args.paperId,
                question.question,
              );
              const lexicalScores = scoreLexicalEvidence(
                question.question,
                units.map((unit) => ({ evidenceId: unit.evidenceId, tokens: unit.tokens })),
                DENSE_LIMIT,
              );

              const fusedScores = reciprocalRankFuse(denseScores, lexicalScores, RRF_CONSTANT);
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
              const { result: extractedResult, usage, prompt: qPrompt } = await extractQuestionAnswer({
                model,
                question,
                abstract: paper.abstract,
                evidencePool,
                diagnosticsSeed,
              });
              const qLatency = Date.now() - qStart;

              console.info(
                "[waitAndExtractAction] question diagnostics",
                JSON.stringify({
                  paperId: args.paperId,
                  questionKey: question.key,
                  mode: "pdf_evidence",
                  abstractPresent,
                  denseCandidates: diagnosticsSeed.denseCandidates,
                  lexicalCandidates: diagnosticsSeed.lexicalCandidates,
                  fusedCandidates: diagnosticsSeed.fusedCandidates,
                  citationStatus: extractedResult.citationStatus,
                  selectedEvidenceIds: extractedResult.citations.map((citation) => citation.evidenceId),
                }),
              );

              return {
                result: extractedResult,
                usage,
                trackingEntry: {
                  feature: "extraction_question_pdf",
                  usage: {
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                  },
                  latencyMs: qLatency,
                  input: truncateForTracking(qPrompt),
                  output: truncateForTracking(JSON.stringify(extractedResult)),
                  temperature: 0,
                },
                pdfEvidenceUsed: extractedResult.citations.length > 0,
              };
            } catch (error) {
              // Partial-failure isolation: one question throwing must not fail
              // the whole paper. Record an extraction_error result so the UI
              // surfaces the bad answer; the other questions still save.
              const message = error instanceof Error ? error.message : String(error);
              console.error(
                `[waitAndExtractAction] question ${question.key} failed:`,
                message,
              );
              return {
                result: {
                  questionKey: question.key,
                  answer: null,
                  confidence: 0,
                  reasoning: `Extraction error: ${message}`,
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
                trackingEntry: null,
                pdfEvidenceUsed: false,
              };
            }
          };

          // Bounded concurrency per paper — questions are independent but we
          // don't want to spike provider rate-limits.
          const outcomes = await mapWithConcurrency(
            args.questions,
            QUESTION_CONCURRENCY_PER_PAPER,
            processQuestion,
          );

          const results = outcomes.map((o) => o.result);
          const trackingEntries = outcomes
            .map((o) => o.trackingEntry)
            .filter((e): e is AITrackingEntry => e !== null);
          const totalUsage = outcomes.reduce(
            (acc, o) => ({
              inputTokens: acc.inputTokens + o.usage.inputTokens,
              outputTokens: acc.outputTokens + o.usage.outputTokens,
            }),
            { inputTokens: 0, outputTokens: 0 },
          );
          const anyPdfEvidenceUsed = outcomes.some((o) => o.pdfEvidenceUsed);
          const billedCredits = calculateServerCreditsToDeduct(totalUsage, pricing);

          return {
            results,
            billedCredits,
            pdfContentUsed: anyPdfEvidenceUsed,
            totalUsage,
            trackingEntries,
          };
      })();

      // Mirror the analytics shape used elsewhere in the AI helpers so the
      // PostHog data is unchanged after moving the credit deduction into
      // saveExtractionResultsAndComplete.
      const latencyMs = Date.now() - startedAt;
      const creditContext = {
        creditsDeducted: extracted.billedCredits,
        creditsRawCost: calculateServerRawCreditCost(extracted.totalUsage, pricing),
        creditsRemaining: Math.max(0, balance.total - extracted.billedCredits),
        lifetimeCreditsUsed: balance.lifetimeUsed + extracted.billedCredits,
      };
      if (extracted.trackingEntries.length > 0) {
        const enriched = extracted.trackingEntries.map((e) => ({
          ...e,
          ...creditContext,
        }));
        await captureAIGenerationBatchServer(
          billingUser.clerkId,
          SERVER_AI_CONFIG.provider as AIProvider,
          SERVER_AI_CONFIG.model,
          enriched,
        );
      } else {
        const hasTokens =
          (extracted.totalUsage.inputTokens ?? 0) > 0 ||
          (extracted.totalUsage.outputTokens ?? 0) > 0;
        await captureAIGenerationServer({
          distinctId: billingUser.clerkId,
          provider: SERVER_AI_CONFIG.provider as AIProvider,
          modelId: SERVER_AI_CONFIG.model,
          feature: operation,
          usage: {
            inputTokens: extracted.totalUsage.inputTokens ?? 0,
            outputTokens: extracted.totalUsage.outputTokens ?? 0,
          },
          latencyMs,
          input: `Batch: ${operation}`,
          output: hasTokens ? "Completed (aggregated)" : "No items succeeded",
          isError: !hasTokens,
          ...creditContext,
        });
      }

      return {
        success: true,
        results: extracted.results,
        creditsUsed: extracted.billedCredits,
        pdfContentUsed: extracted.pdfContentUsed,
      };
    } catch (error) {
      return {
        success: false,
        error: toErrorMessage(error, "Unknown extraction error"),
      };
    }
  },
});
