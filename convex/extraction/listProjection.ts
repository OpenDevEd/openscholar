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

export function normalizeProjectionText(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
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

/**
 * Tier C: the denormalized search/list fields on extractionPapers are
 * rebuilt from the per-question extractionResults rows. Per-question
 * writes (recordOneAnswer / recordOneAnswerFailure) no longer patch the
 * paper row — they just write their own results row. The Q-way OCC
 * contention point that the old applyResultProjectionWrite created is
 * gone.
 *
 * This function is the single source of truth for projection state and
 * is invoked at:
 *   - paper insert (createPaperRecords) — initialises denorm fields
 *   - paper non-terminal status / processable / storage / index updates
 *   - markPaperTerminalTx (per paper, once, after finalize)
 *   - admin rebuild (rebuildJobListProjection)
 *
 * O(Q) read per call (collect results by_paper). Far cheaper than the
 * P×Q OCC retry storms the per-question write path used to produce.
 */
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
  questionStates.sort((a, b) => a.questionKey.localeCompare(b.questionKey));

  const confidenceSum = results.reduce(
    (sum, result) => sum + confidenceContribution(result.confidence),
    0,
  );
  const errorQuestionKeys = Array.from(
    new Set(results.flatMap((r) => (isErrorResult(r) ? [r.questionKey] : []))),
  ).sort();

  const resultCount = results.length;
  const avgConfidence = resultCount > 0 ? confidenceSum / resultCount : 0;
  const questionAnswerTokens = questionStates.flatMap((s) =>
    s.token ? [s.token] : [],
  );

  const hasPaperError =
    paper.status === "download_failed" ||
    paper.status === "indexing_failed" ||
    paper.status === "failed" ||
    paper.lastError !== undefined;

  await ctx.db.patch("extractionPapers", paperId, {
    sortTitle: normalizeProjectionText(paper.title),
    avgConfidence,
    hasErrors: hasPaperError || errorQuestionKeys.length > 0,
    hasPdfSource: Boolean(
      paper.pdfUrl || paper.storageId || paper.ragEntryId || paper.isIndexed,
    ),
    questionAnswerTokens,
    searchText: buildSearchText({ paper, questionStates }),
  });
}
