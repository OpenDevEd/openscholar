import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const SEARCH_TEXT_MAX_CHARS = 6000;
const SEARCH_TEXT_DEFAULT_PART_MAX = 240;
const SEARCH_TEXT_ABSTRACT_MAX = 1200;
const QUESTION_ANSWER_TOKEN_DELIMITER = "::";

type ProjectionAnswer =
  | Doc<"extractionResults">["answer"]
  | Doc<"extractionResultReviews">["correctedAnswer"];

export function normalizeProjectionText(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\s%.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function answerTextForSearch(answer: ProjectionAnswer): string {
  if (answer === null || answer === undefined) return "";
  if (typeof answer === "boolean") return answer ? "yes" : "no";
  if (typeof answer === "number") return String(Number(answer));
  if (Array.isArray(answer)) return answer.join(" ");
  return String(answer);
}

function normalizeAnswerForQuestionFilter(answer: ProjectionAnswer): string | null {
  if (answer === null || answer === undefined) return null;
  if (typeof answer === "boolean") return answer ? "yes" : "no";
  if (typeof answer === "number") return String(Number(answer));
  if (Array.isArray(answer)) {
    const normalized = Array.from(
      new Set(
        answer
          .map((item) => normalizeProjectionText(String(item)))
          .filter(Boolean),
      ),
    )
      .sort()
      .join(" | ");
    return normalized || null;
  }
  const normalized = normalizeProjectionText(String(answer));
  return normalized || null;
}

export function buildQuestionAnswerToken(
  questionKey: string,
  answer: ProjectionAnswer,
): string | null {
  const normalized = normalizeAnswerForQuestionFilter(answer);
  if (!normalized) return null;
  return `${questionKey}${QUESTION_ANSWER_TOKEN_DELIMITER}${normalized}`;
}

function buildSearchText(args: {
  paper: Doc<"extractionPapers">;
  results: Doc<"extractionResults">[];
  reviewByResultId: Map<Id<"extractionResults">, Doc<"extractionResultReviews">>;
}): string {
  const { paper, results, reviewByResultId } = args;
  const seen = new Set<string>();
  const parts: string[] = [];
  let totalChars = 0;

  const pushPart = (
    value: string | null | undefined,
    maxPartLength = SEARCH_TEXT_DEFAULT_PART_MAX,
  ) => {
    const normalized = normalizeProjectionText(value).slice(0, maxPartLength).trim();
    if (!normalized || seen.has(normalized)) return;

    const separatorLength = parts.length > 0 ? 1 : 0;
    const nextTotal = totalChars + separatorLength + normalized.length;
    if (nextTotal > SEARCH_TEXT_MAX_CHARS) {
      const remaining = SEARCH_TEXT_MAX_CHARS - totalChars - separatorLength;
      if (remaining <= 0) return;
      const clipped = normalized.slice(0, remaining).trim();
      if (!clipped || seen.has(clipped)) return;
      parts.push(clipped);
      totalChars += separatorLength + clipped.length;
      seen.add(clipped);
      return;
    }

    parts.push(normalized);
    totalChars = nextTotal;
    seen.add(normalized);
  };

  pushPart(paper.title, 400);
  pushPart(paper.doi);
  pushPart(paper.openalexId);
  for (const author of paper.authors ?? []) {
    pushPart(author, 120);
  }
  pushPart(paper.abstract, SEARCH_TEXT_ABSTRACT_MAX);

  for (const result of [...results].sort((a, b) =>
    a.questionKey.localeCompare(b.questionKey),
  )) {
    const review = reviewByResultId.get(result._id);
    pushPart(answerTextForSearch(review?.correctedAnswer ?? result.answer));
  }

  return parts.join(" ");
}

function buildProjection(args: {
  paper: Doc<"extractionPapers">;
  results: Doc<"extractionResults">[];
  reviews: Doc<"extractionResultReviews">[];
}): Partial<Doc<"extractionPapers">> {
  const { paper, results, reviews } = args;
  const reviewByResultId = new Map<Id<"extractionResults">, Doc<"extractionResultReviews">>();
  for (const review of reviews) {
    reviewByResultId.set(review.resultId, review);
  }

  const questionAnswerTokens = [...results]
    .sort((a, b) => a.questionKey.localeCompare(b.questionKey))
    .flatMap((result) => {
      const review = reviewByResultId.get(result._id);
      const token = buildQuestionAnswerToken(
        result.questionKey,
        review?.correctedAnswer ?? result.answer,
      );
      return token ? [token] : [];
    });

  const reviewedCount = reviews.filter(
    (review) =>
      review.state === "accepted" ||
      review.state === "rejected" ||
      review.state === "needs_followup",
  ).length;
  const needsFollowupCount = reviews.filter(
    (review) => review.state === "needs_followup",
  ).length;
  const avgConfidence =
    results.length > 0
      ? results.reduce((sum, result) => {
          const confidence =
            typeof result.confidence === "number" && Number.isFinite(result.confidence)
              ? result.confidence
              : 0;
          return sum + confidence;
        }, 0) / results.length
      : 0;

  const hasPaperError =
    paper.status === "download_failed" ||
    paper.status === "indexing_failed" ||
    paper.status === "failed" ||
    paper.lastError !== undefined;
  const hasResultError = results.some(
    (result) =>
      result.status === "failed" ||
      result.citationStatus === "extraction_error" ||
      result.lastError !== undefined,
  );

  return {
    sortTitle: normalizeProjectionText(paper.title),
    avgConfidence,
    reviewedCount,
    needsFollowupCount,
    hasErrors: hasPaperError || hasResultError,
    hasPdfSource: Boolean(
      paper.pdfUrl || paper.storageId || paper.ragEntryId || paper.isIndexed,
    ),
    questionAnswerTokens,
    searchText: buildSearchText({ paper, results, reviewByResultId }),
  };
}

export async function recomputePaperListProjection(
  ctx: MutationCtx,
  paperId: Id<"extractionPapers">,
): Promise<void> {
  const paper = await ctx.db.get("extractionPapers", paperId);
  if (!paper) return;

  const [results, reviews] = await Promise.all([
    ctx.db
      .query("extractionResults")
      .withIndex("by_paper", (q) => q.eq("paperId", paperId))
      .collect(),
    ctx.db
      .query("extractionResultReviews")
      .withIndex("by_paper", (q) => q.eq("paperId", paperId))
      .collect(),
  ]);

  await ctx.db.patch("extractionPapers", paperId, buildProjection({
    paper,
    results,
    reviews,
  }));
}
