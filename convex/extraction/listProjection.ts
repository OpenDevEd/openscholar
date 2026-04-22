import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const SEARCH_TEXT_MAX_CHARS = 6000;
const SEARCH_TEXT_DEFAULT_PART_MAX = 240;
const SEARCH_TEXT_ABSTRACT_MAX = 1200;
const QUESTION_ANSWER_TOKEN_DELIMITER = "::";

type ProjectionAnswer = Doc<"extractionResults">["answer"];

type ProjectionQuestionState = {
  questionKey: string;
  token?: string;
  searchPart?: string;
};

type ProjectionState = {
  resultCount: number;
  confidenceSum: number;
  questionStates: ProjectionQuestionState[];
  errorQuestionKeys: string[];
};

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

function buildSearchPart(answer: ProjectionAnswer): string | undefined {
  const normalized = normalizeProjectionText(answerTextForSearch(answer))
    .slice(0, SEARCH_TEXT_DEFAULT_PART_MAX)
    .trim();
  return normalized || undefined;
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
  questionStates: ProjectionQuestionState[];
}): string {
  const { paper, questionStates } = args;
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

  for (const state of [...questionStates].sort((a, b) =>
    a.questionKey.localeCompare(b.questionKey),
  )) {
    pushPart(state.searchPart, SEARCH_TEXT_DEFAULT_PART_MAX);
  }

  return parts.join(" ");
}

function sortQuestionStates(
  questionStates: ProjectionQuestionState[],
): ProjectionQuestionState[] {
  return [...questionStates].sort((a, b) => a.questionKey.localeCompare(b.questionKey));
}

function isErrorResult(
  result: Pick<
    Doc<"extractionResults">,
    "status" | "citationStatus" | "lastError"
  >,
): boolean {
  return (
    result.status === "failed" ||
    result.citationStatus === "extraction_error" ||
    result.lastError !== undefined
  );
}

function readProjectionState(paper: Doc<"extractionPapers">): ProjectionState {
  return {
    resultCount:
      typeof paper.projectionResultCount === "number" &&
      Number.isFinite(paper.projectionResultCount)
        ? paper.projectionResultCount
        : 0,
    confidenceSum:
      typeof paper.projectionConfidenceSum === "number" &&
      Number.isFinite(paper.projectionConfidenceSum)
        ? paper.projectionConfidenceSum
        : 0,
    questionStates: Array.isArray(paper.projectionQuestionStates)
      ? paper.projectionQuestionStates
      : [],
    errorQuestionKeys: Array.isArray(paper.projectionErrorQuestionKeys)
      ? paper.projectionErrorQuestionKeys
      : [],
  };
}

function buildProjectionPatch(args: {
  paper: Doc<"extractionPapers">;
  state: ProjectionState;
}): Partial<Doc<"extractionPapers">> {
  const { paper, state } = args;
  const questionStates = sortQuestionStates(state.questionStates);
  const questionAnswerTokens = questionStates.flatMap((entry) =>
    entry.token ? [entry.token] : [],
  );
  const avgConfidence =
    state.resultCount > 0 ? state.confidenceSum / state.resultCount : 0;

  const hasPaperError =
    paper.status === "download_failed" ||
    paper.status === "indexing_failed" ||
    paper.status === "failed" ||
    paper.lastError !== undefined;

  return {
    sortTitle: normalizeProjectionText(paper.title),
    avgConfidence,
    hasErrors: hasPaperError || state.errorQuestionKeys.length > 0,
    hasPdfSource: Boolean(
      paper.pdfUrl || paper.storageId || paper.ragEntryId || paper.isIndexed,
    ),
    questionAnswerTokens,
    searchText: buildSearchText({ paper, questionStates }),
    projectionResultCount: state.resultCount,
    projectionConfidenceSum: state.confidenceSum,
    projectionQuestionStates: questionStates,
    projectionErrorQuestionKeys: [...new Set(state.errorQuestionKeys)].sort(),
  };
}

function upsertQuestionState(
  questionStates: ProjectionQuestionState[],
  nextState: ProjectionQuestionState | null,
): ProjectionQuestionState[] {
  const withoutCurrent = questionStates.filter(
    (entry) => entry.questionKey !== nextState?.questionKey,
  );
  if (!nextState || (!nextState.token && !nextState.searchPart)) {
    return withoutCurrent;
  }
  return [...withoutCurrent, nextState];
}

function setErrorQuestion(
  errorQuestionKeys: string[],
  questionKey: string,
  hasError: boolean,
): string[] {
  const withoutCurrent = errorQuestionKeys.filter((key) => key !== questionKey);
  return hasError ? [...withoutCurrent, questionKey] : withoutCurrent;
}

function confidenceContribution(confidence: number | undefined): number {
  return typeof confidence === "number" && Number.isFinite(confidence)
    ? confidence
    : 0;
}

function toQuestionState(
  questionKey: string,
  answer: ProjectionAnswer,
): ProjectionQuestionState | null {
  const token = buildQuestionAnswerToken(questionKey, answer) ?? undefined;
  const searchPart = buildSearchPart(answer);
  if (!token && !searchPart) return null;
  return { questionKey, token, searchPart };
}

export async function refreshPaperListProjection(
  ctx: MutationCtx,
  paperId: Id<"extractionPapers">,
): Promise<void> {
  const paper = await ctx.db.get("extractionPapers", paperId);
  if (!paper) return;

  const state = readProjectionState(paper);
  await ctx.db.patch("extractionPapers", paperId, buildProjectionPatch({
    paper,
    state,
  }));
}

export async function applyResultProjectionWrite(
  ctx: MutationCtx,
  args: {
    paper: Doc<"extractionPapers">;
    paperId: Id<"extractionPapers">;
    questionKey: string;
    previousResult: Pick<
      Doc<"extractionResults">,
      "confidence" | "status" | "citationStatus" | "lastError" | "answer"
    > | null;
    nextResult: Pick<
      Doc<"extractionResults">,
      "confidence" | "status" | "citationStatus" | "lastError" | "answer"
    >;
    creditsUsedDelta?: number;
  },
): Promise<void> {
  const { paper, previousResult, nextResult } = args;
  const state = readProjectionState(paper);
  const hadPrevious = previousResult !== null;
  const previousContribution = hadPrevious
    ? confidenceContribution(previousResult.confidence)
    : 0;
  const nextContribution = confidenceContribution(nextResult.confidence);
  const nextState = toQuestionState(args.questionKey, nextResult.answer);

  const nextProjectionState: ProjectionState = {
    resultCount: hadPrevious ? Math.max(state.resultCount, 1) : state.resultCount + 1,
    confidenceSum:
      state.confidenceSum - previousContribution + nextContribution,
    questionStates: upsertQuestionState(state.questionStates, nextState),
    errorQuestionKeys: setErrorQuestion(
      state.errorQuestionKeys,
      args.questionKey,
      isErrorResult(nextResult),
    ),
  };

  const patch = buildProjectionPatch({
    paper,
    state: nextProjectionState,
  });

  if ((args.creditsUsedDelta ?? 0) > 0) {
    patch.creditsUsed = (paper.creditsUsed ?? 0) + (args.creditsUsedDelta ?? 0);
  }

  await ctx.db.patch("extractionPapers", args.paperId, patch);
}

export async function recomputePaperListProjection(
  ctx: MutationCtx,
  paperId: Id<"extractionPapers">,
): Promise<void> {
  const paper = await ctx.db.get("extractionPapers", paperId);
  if (!paper) return;

  const results = await ctx.db
    .query("extractionResults")
    .withIndex("by_paper", (q) => q.eq("paperId", paperId))
    .collect();

  const questionStates = results.flatMap((result) => {
    const state = toQuestionState(result.questionKey, result.answer);
    return state ? [state] : [];
  });
  const state: ProjectionState = {
    resultCount: results.length,
    confidenceSum: results.reduce(
      (sum, result) => sum + confidenceContribution(result.confidence),
      0,
    ),
    questionStates,
    errorQuestionKeys: results.flatMap((result) =>
      isErrorResult(result) ? [result.questionKey] : [],
    ),
  };

  await ctx.db.patch("extractionPapers", paperId, buildProjectionPatch({
    paper,
    state,
  }));
}
