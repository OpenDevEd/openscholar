"use node";

import { internalAction, type ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import { RAG } from "@convex-dev/rag";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import {
  calculateServerCreditsToDeduct,
  convertServerCostDollarsToCredits,
  getModel,
  withUserCreditsBatch,
} from "../ai/helpers";
import { STANDARD_PROVIDER_OPTIONS } from "../../lib/ai/core/schemas";
import { downloadPdf, type DownloadPdfResult } from "../../lib/pdf/download";
import { decryptApiKey } from "../lib/crypto";
import { MIN_ABSTRACT_LENGTH, isPdfExtractionEnabled } from "./content";
import { buildEnhancedExtractionPrompt, type ExtractionQuestion } from "./prompts";
import {
  buildChunkedEvidenceUnitsFromPdfPages,
  reciprocalRankFuse,
  scoreLexicalEvidence,
  type RankedEvidenceScore,
} from "./evidence_units";
import { extractPdfJsTextPages } from "./pdfjs_extract";
import { buildPageTextFromItems } from "../../lib/extraction/pdfjs-text";

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
const BEST_EFFORT_MAX_CITATIONS = 2;
const BEST_EFFORT_CONFIDENCE_CAP = 0.45;
const ABSTRACT_ONLY_CONFIDENCE_CAP = 0.7;
const STRICT_NULL_CONFIDENCE_CAP = 0.3;
const ARRAY_ANSWER_MAX_ITEMS = 8;
const ARRAY_GENERIC_PENALTY = 0.15;
const ARRAY_GENERIC_THRESHOLD = 0.6;
const DEFAULT_EXTRACTION_EMBEDDING_USD_PER_1M_TOKENS = 0.02;
const ARRAY_GENERIC_TERMS = new Set([
  "artificial intelligence",
  "artificial-intelligence",
  "ai",
  "generative ai",
  "large language model",
  "large language models",
  "llm",
  "llms",
  "language model",
  "language models",
  "machine learning",
  "deep learning",
  "neural network",
  "neural networks",
  "transformer",
  "transformer architecture",
  "transformer architectures",
  "transformer-based models",
]);

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

function normalizeArrayEntity(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s%.-]/g, "");
}

function isGenericArrayEntity(value: string) {
  const normalized = normalizeArrayEntity(value);
  if (!normalized) return true;
  if (ARRAY_GENERIC_TERMS.has(normalized)) return true;
  if (normalized.includes("machine learning")) return true;
  if (normalized.includes("deep learning")) return true;
  if (normalized.includes("neural network")) return true;
  if (normalized.includes("transformer architecture")) return true;
  return false;
}

function splitArrayFragments(raw: string): string[] {
  return raw
    .split(/[;,]/g)
    .map((value) => normalizeArrayEntity(value))
    .filter(Boolean);
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
}): {
  answer: string | boolean | number | string[] | null;
  confidence: number;
  citationStatus: CitationStatus;
  strictNull: boolean;
} {
  if (params.extracted.answer !== null) {
    return {
      answer: params.extracted.answer,
      confidence: Math.min(params.extracted.confidence, ABSTRACT_ONLY_CONFIDENCE_CAP),
      citationStatus: "best_effort",
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

    const { object, usage } = await generateObject({
      model,
      schema: buildAnswerSchema(question.type),
      prompt,
      temperature: 0,
      providerOptions: STANDARD_PROVIDER_OPTIONS,
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
}): Promise<ExtractionWithUsage> {
  const { model, question, abstract } = params;

  try {
    const prompt = buildEnhancedExtractionPrompt(
      question as ExtractionQuestion,
      abstract,
      []
    );

    const { object, usage } = await generateObject({
      model,
      schema: buildAnswerSchema(question.type),
      prompt,
      temperature: 0,
      providerOptions: STANDARD_PROVIDER_OPTIONS,
    });

    const extracted = normalizeExtractionOutputForQuestion(
      question.type,
      object as StrictExtractionOutput
    );
    const policy = applyAbstractOnlyPolicy({ extracted });
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

async function resolvePdfBlob(ctx: ActionCtx, args: {
  paperId: Id<"extractionPapers">;
  jobId: Id<"extractionJobs">;
  pdfUrl: string;
  storageId?: string;
  doi?: string;
}): Promise<{ pdfBlob: Blob | null; storageId?: string; error?: string }> {
  if (args.storageId) {
    const stored = await ctx.storage.get(args.storageId);
    if (stored) {
      return { pdfBlob: stored, storageId: args.storageId };
    }
  }

  if (!args.pdfUrl) {
    return { pdfBlob: null, error: "No PDF URL provided" };
  }

    const job = await ctx.runQuery(internal.extraction.queries.getJobInternal, {
      jobId: args.jobId,
    });
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
  handler: async (ctx, args): Promise<IndexResult> => {
    try {
      const job = await ctx.runQuery(internal.extraction.queries.getJobInternal, {
        jobId: args.jobId,
      });
      if (!job) {
        return {
          success: false,
          error: "Job not found",
        };
      }
      if (!isPdfExtractionEnabled()) {
        if (args.abstract && args.abstract.length > MIN_ABSTRACT_LENGTH) {
          await ctx.runMutation(internal.extraction.mutations.replacePaperEvidenceUnits, {
            paperId: args.paperId,
            units: [],
          });
          return {
            success: true,
            chunksCount: 0,
            error: "PDF processing disabled by feature flag; continuing in abstract-only mode.",
          };
        }
        return {
          success: false,
          error: "PDF processing is disabled and no usable abstract is available.",
        };
      }

      const resolved = await resolvePdfBlob(ctx, {
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

        // Credit guard: skip embedding credit deduction if job was cancelled
        const freshJobForCredits = await ctx.runQuery(
          internal.extraction.queries.getJobInternal,
          { jobId: args.jobId }
        );
        if (freshJobForCredits?.status === "cancelled") {
          console.log(`[creditGuard] Skipping embedding credit deduction - job ${args.jobId} cancelled`);
        } else if (embeddingCreditsToDeduct > 0) {
          await ctx.runMutation(internal.credits.internal.deductCredits, {
            userId: job.userId,
            amount: embeddingCreditsToDeduct,
            description: "AI: Extraction embedding index",
            metadata: {
              billingType: "extraction_embedding",
              paperId: String(args.paperId),
              jobId: String(args.jobId),
              embeddingTokens: String(embeddingTokens),
              embeddingUsdPer1m: String(EXTRACTION_EMBEDDING_USD_PER_1M_TOKENS),
            },
          });
        }

        await ctx.runMutation(internal.extraction.mutations.markPaperIndexed, {
          paperId: args.paperId,
          ragEntryId: ragResult.entryId,
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
    questions: v.array(
      v.object({
        key: v.string(),
        question: v.string(),
        type: v.union(
          v.literal("string"),
          v.literal("boolean"),
          v.literal("number"),
          v.literal("array")
        ),
        description: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    results?: ExtractionQuestionResult[];
    creditsUsed?: number;
    pdfContentUsed?: boolean;
    error?: string;
  }> => {
    try {
      const paper = await ctx.runQuery(internal.extraction.queries.getPaperInternal, {
        paperId: args.paperId,
      });
      if (!paper) {
        return { success: false, error: "Paper not found" };
      }
      const job = await ctx.runQuery(internal.extraction.queries.getJobInternal, {
        jobId: args.jobId,
      });
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

      // Credit guard: skip extraction credit deduction if job was cancelled
      const freshJobForCredits = await ctx.runQuery(
        internal.extraction.queries.getJobInternal,
        { jobId: args.jobId }
      );
      if (freshJobForCredits?.status === "cancelled") {
        console.log(`[creditGuard] Skipping extraction credit deduction - job ${args.jobId} cancelled`);
        // Return results without billing -- extraction work was done but job is cancelled
        // Still need to return a valid shape so onComplete can handle gracefully
        return {
          success: true,
          results: [],
          creditsUsed: 0,
          pdfContentUsed: false,
        };
      }

      const extracted = await withUserCreditsBatch(
        ctx,
        job.userId,
        `Extraction (${args.questions.length} questions)`,
        async () => {
          const model = await getModel();
          const results: ExtractionQuestionResult[] = [];
          const extractionUsages: { inputTokens: number; outputTokens: number }[] = [];
          let anyPdfEvidenceUsed = false;
          const abstractPresent = isUsableAbstract(paper.abstract);
          const abstractText = abstractPresent ? paper.abstract!.trim() : undefined;

          for (const question of args.questions) {
            if (units.length === 0) {
              if (abstractText) {
                const { result, usage } = await extractQuestionAnswerFromAbstract({
                  model,
                  question,
                  abstract: abstractText,
                });
                results.push(result);
                extractionUsages.push(usage);
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
                continue;
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
              results.push(noContentResult);
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
              continue;
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

            const { result: extracted, usage } = await extractQuestionAnswer({
              model,
              question,
              abstract: paper.abstract,
              evidencePool,
              diagnosticsSeed,
            });

            if (extracted.citations.length > 0) {
              anyPdfEvidenceUsed = true;
            }

            extractionUsages.push(usage);

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
                citationStatus: extracted.citationStatus,
                selectedEvidenceIds: extracted.citations.map((citation) => citation.evidenceId),
              }),
            );

            results.push(extracted);
          }

          const totalInputTokens = extractionUsages.reduce(
            (acc, usage) => acc + usage.inputTokens,
            0,
          );
          const totalOutputTokens = extractionUsages.reduce(
            (acc, usage) => acc + usage.outputTokens,
            0,
          );
          const totalUsage = {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          };
          const billedCredits = calculateServerCreditsToDeduct(totalUsage);

          return {
            result: {
              results,
              billedCredits,
              pdfContentUsed: anyPdfEvidenceUsed,
            },
            totalUsage,
          };
        },
      );

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
