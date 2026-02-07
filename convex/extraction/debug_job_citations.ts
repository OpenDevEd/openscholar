import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

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

    for (const paper of completed.slice(0, limit)) {
      const paperResults = await ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paper._id))
        .collect();

      for (const result of paperResults) {
        totalAnswers++;
        const citationStatus = (result as any).citationStatus as
          | "grounded"
          | "best_effort"
          | "insufficient_evidence"
          | "extraction_error"
          | undefined;
        const citations = Array.isArray((result as any).citations)
          ? ((result as any).citations as Array<any>)
          : [];
        const diagnostics = (result as any).retrievalDiagnostics as
          | {
              denseCandidates?: number;
              lexicalCandidates?: number;
              fusedCandidates?: number;
              strictNull?: boolean;
            }
          | undefined;

        if (result.answer === null) {
          nullAnswerCount++;
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
        const citations = (result as any).citations;
        return Array.isArray(citations) && citations.length > 0;
      });

      const citations = Array.isArray((withCitations as any)?.citations)
        ? (((withCitations as any).citations as Array<any>) ?? [])
        : [];
      const diagnostics = (withCitations as any)?.retrievalDiagnostics as
        | {
            denseCandidates?: number;
            lexicalCandidates?: number;
            fusedCandidates?: number;
            strictNull?: boolean;
          }
        | undefined;
      const validatedCitationCount = citations.filter((c) => c?.validated === true).length;

      sampledResults.push({
        paperId: paper._id,
        title: paper.title,
        ragEntryId: paper.ragEntryId,
        questionKey: withCitations?.questionKey,
        citationStatus: (withCitations as any)?.citationStatus,
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
      },
    };
  },
});
