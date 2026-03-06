import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

const EFFECTIVE_CONFIDENCE_MULTIPLIER: Record<string, number> = {
  grounded: 1,
  best_effort: 0.55,
  insufficient_evidence: 0,
  extraction_error: 0,
};

const GENERIC_ARRAY_TERMS = new Set([
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

function normalizeArrayEntity(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s%.-]/g, "");
}

function parseArrayEntities(answer: unknown): string[] {
  if (answer === null || answer === undefined) return [];
  const values = Array.isArray(answer) ? answer : [answer];
  const entities = new Set<string>();
  for (const value of values) {
    const raw = String(value);
    for (const part of raw.split(/[;,]/g)) {
      const normalized = normalizeArrayEntity(part);
      if (normalized) entities.add(normalized);
    }
  }
  return Array.from(entities).sort();
}

function isGenericArrayEntity(value: string) {
  if (!value) return true;
  if (GENERIC_ARRAY_TERMS.has(value)) return true;
  if (value.includes("machine learning")) return true;
  if (value.includes("deep learning")) return true;
  if (value.includes("neural network")) return true;
  if (value.includes("transformer architecture")) return true;
  return false;
}

function getEffectiveConfidence(confidence: unknown, citationStatus: string | undefined) {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return 0;
  const multiplier = EFFECTIVE_CONFIDENCE_MULTIPLIER[citationStatus || "grounded"] ?? 1;
  return confidence * multiplier;
}

function buildArrayProfileSignature(entities: string[]) {
  const nonGeneric = entities.filter((entity) => !isGenericArrayEntity(entity));
  const selected = (nonGeneric.length > 0 ? nonGeneric : entities).slice(0, 3).sort();
  if (selected.length === 0) return null;
  return selected.join(" | ");
}

/**
 * Internal query to inspect citation extraction results for papers in a job.
 *
 * Access: Internal only (internalQuery) -- not exposed to clients.
 */
export const debugJobCitations = internalQuery({
  args: {
    jobId: v.id("extractionJobs"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();
    const questionByKey = new Map(questions.map((question) => [question.key, question.question]));
    const questionTypeByKey = new Map(questions.map((question) => [question.key, question.type]));

    const papers = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();

    const completed = papers.filter(
      (paper) => paper.processable !== false && paper.status === "completed"
    );
    const limit = args.limit ?? 6;

    const sampledResults: Array<{
      paperId: string;
      title: string;
      ragEntryId?: string;
      questionKey?: string;
      citationStatus?: string;
      citationCount?: number;
      validatedCitationCount?: number;
      denseCandidates?: number;
      lexicalCandidates?: number;
      fusedCandidates?: number;
      strictNull?: boolean;
      selectedEvidenceIds?: string[];
      sampleCitationQuote?: string;
    }> = [];

    let totalCitationCount = 0;
    let totalValidatedCitationCount = 0;
    let zeroRangeCitationCount = 0;
    let totalCitationRangeLength = 0;
    let insufficientEvidenceCount = 0;
    let bestEffortCount = 0;
    let totalAnswers = 0;
    let nullAnswerCount = 0;
    let nullAnswersDueToInsufficientEvidence = 0;
    let denseCandidatesTotal = 0;
    let lexicalCandidatesTotal = 0;
    let fusedCandidatesTotal = 0;
    let sampleSizeQuestionCount = 0;
    let sampleSizeQuestionHitCount = 0;
    let effectiveConfidenceSum = 0;
    let effectiveConfidenceCount = 0;
    let arrayEntityCount = 0;
    let genericArrayEntityCount = 0;
    let totalArrayClusters = 0;
    let totalArraySingletonClusters = 0;
    let suppressedSingletonCount = 0;
    const arrayProfileByQuestion = new Map<string, Map<string, number>>();

    for (const paper of completed.slice(0, limit)) {
      const paperResults = await ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .collect();

      for (const result of paperResults) {
        totalAnswers++;
        const citationStatus = result.citationStatus;
        const questionType = questionTypeByKey.get(result.questionKey);
        const citations = result.citations;
        const diagnostics = result.retrievalDiagnostics;

        if (result.answer === null) {
          nullAnswerCount++;
        }

        if (typeof result.confidence === "number" && Number.isFinite(result.confidence)) {
          effectiveConfidenceSum += getEffectiveConfidence(
            result.confidence,
            citationStatus
          );
          effectiveConfidenceCount++;
        }

        if (citationStatus === "insufficient_evidence") {
          insufficientEvidenceCount++;
          if (result.answer === null) {
            nullAnswersDueToInsufficientEvidence++;
          }
        }
        if (citationStatus === "best_effort") {
          bestEffortCount++;
        }

        const questionText = (questionByKey.get(result.questionKey) || "").toLowerCase();
        const isSampleSizeQuestion = /\b(sample size|how many|number of|participants?)\b/.test(
          questionText
        );
        if (isSampleSizeQuestion) {
          sampleSizeQuestionCount++;
          if (result.answer !== null && citations.length > 0) {
            sampleSizeQuestionHitCount++;
          }
        }

        if (questionType === "array") {
          const entities = parseArrayEntities(result.answer);
          if (entities.length > 0) {
            arrayEntityCount += entities.length;
            genericArrayEntityCount += entities.filter((entity) =>
              isGenericArrayEntity(entity)
            ).length;

            const signature = buildArrayProfileSignature(entities);
            if (signature) {
              const perQuestion =
                arrayProfileByQuestion.get(result.questionKey) || new Map<string, number>();
              perQuestion.set(signature, (perQuestion.get(signature) || 0) + 1);
              arrayProfileByQuestion.set(result.questionKey, perQuestion);
            }
          }
        }

        denseCandidatesTotal += diagnostics?.denseCandidates ?? 0;
        lexicalCandidatesTotal += diagnostics?.lexicalCandidates ?? 0;
        fusedCandidatesTotal += diagnostics?.fusedCandidates ?? 0;

        totalCitationCount += citations.length;
        for (const citation of citations) {
          if (citation?.validated === true) {
            totalValidatedCitationCount++;
          }
          if (Array.isArray(citation?.charRange) && citation.charRange.length >= 2) {
            const start = Number(citation.charRange[0]);
            const end = Number(citation.charRange[1]);
            if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
              totalCitationRangeLength += end - start;
              if (end <= start) {
                zeroRangeCitationCount++;
              }
            }
          }
        }
      }

      const withCitations = paperResults.find((result) => {
        return Array.isArray(result.citations) && result.citations.length > 0;
      });

      const citations = withCitations?.citations ?? [];
      const diagnostics = withCitations?.retrievalDiagnostics;
      const validatedCitationCount = citations.filter((c) => c?.validated === true).length;

      sampledResults.push({
        paperId: paper._id,
        title: paper.title,
        ragEntryId: paper.ragEntryId,
        questionKey: withCitations?.questionKey,
        citationStatus: withCitations?.citationStatus,
        citationCount: citations.length || undefined,
        validatedCitationCount:
          validatedCitationCount > 0 ? validatedCitationCount : undefined,
        denseCandidates: diagnostics?.denseCandidates,
        lexicalCandidates: diagnostics?.lexicalCandidates,
        fusedCandidates: diagnostics?.fusedCandidates,
        strictNull: diagnostics?.strictNull,
        selectedEvidenceIds: citations
          .slice(0, 3)
          .map((citation) => (typeof citation?.evidenceId === "string" ? citation.evidenceId : ""))
          .filter(Boolean),
        sampleCitationQuote:
          typeof citations[0]?.quote === "string"
            ? citations[0].quote.slice(0, 180)
            : undefined,
      });
    }

    for (const signatureCounts of arrayProfileByQuestion.values()) {
      const counts = Array.from(signatureCounts.values());
      if (counts.length === 0) continue;
      totalArrayClusters += counts.length;
      const singletonCount = counts.filter((count) => count === 1).length;
      totalArraySingletonClusters += singletonCount;
      const hasNonSingleton = counts.some((count) => count >= 2);
      if (hasNonSingleton) {
        suppressedSingletonCount += singletonCount;
      }
    }

    const citationValidationRate =
      totalCitationCount > 0 ? totalValidatedCitationCount / totalCitationCount : 0;
    const averageCitationRangeLength =
      totalCitationCount > 0 ? totalCitationRangeLength / totalCitationCount : 0;
    const zeroRangeCitationRate =
      totalCitationCount > 0 ? zeroRangeCitationCount / totalCitationCount : 0;
    const bestEffortRate = totalAnswers > 0 ? bestEffortCount / totalAnswers : 0;
    const sampleSizeQueryHitRate =
      sampleSizeQuestionCount > 0
        ? sampleSizeQuestionHitCount / sampleSizeQuestionCount
        : 0;
    const nullRate = totalAnswers > 0 ? nullAnswerCount / totalAnswers : 0;
    const avgEffectiveConfidence =
      effectiveConfidenceCount > 0 ? effectiveConfidenceSum / effectiveConfidenceCount : 0;
    const genericEntityShare =
      arrayEntityCount > 0 ? genericArrayEntityCount / arrayEntityCount : 0;
    const arraySingletonClusterRate =
      totalArrayClusters > 0 ? totalArraySingletonClusters / totalArrayClusters : 0;

    return {
      sampled: sampledResults.length,
      results: sampledResults,
      metrics: {
        citationValidationRate,
        averageCitationRangeLength,
        zeroRangeCitationRate,
        bestEffortRate,
        sampleSizeQueryHitRate,
        nullRate,
        nullAnswersDueToInsufficientEvidence,
        insufficientEvidenceCount,
        totalAnswers,
        denseCandidatesTotal,
        lexicalCandidatesTotal,
        fusedCandidatesTotal,
        avgEffectiveConfidence,
        genericEntityShare,
        arraySingletonClusterRate,
        suppressedSingletonCount,
      },
    };
  },
});
