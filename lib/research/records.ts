import { v, type Infer } from "convex/values";
import { partial } from "convex-helpers/validators";
import type { SearchResult } from "../types/search.types";

const strings = v.array(v.string());
const numbers = v.array(v.number());
const answer = v.union(v.boolean(), v.null());
const answers = v.array(v.object({ question: v.string(), response: answer }));
export const fieldValidator = v.union(...[
  "title_and_abstract", "title", "abstract", "fulltext", "display_name", "oql",
].map((field) => v.literal(field as SearchResult["field"])));

export const queryHistoryEntryValidator = v.object({ query: v.string(), timestamp: v.string(), field: v.optional(fieldValidator) });
export const questionHistoryEntryValidator = v.object({ question: v.string(), timestamp: v.string() });
/** A search's earlier queries and questions, as saved before they had their own rows (#354). */
export const historyArrays = { queryHistory: v.array(queryHistoryEntryValidator), questionHistory: v.array(questionHistoryEntryValidator) };

/** The most of a search's past questions kept on the search itself, for filtering the history page by them. */
export const QUESTION_TEXT_MAX = 4_000;

export const searchFields = {
  id: v.string(),
  query: v.string(),
  field: fieldValidator,
  count: v.number(),
  // The search's history lives in its own rows (convex/research/records.ts: searchHistory);
  // the search keeps only what lists show of it.
  queryHistoryCount: v.number(),
  questionCount: v.number(),
  latestQuestion: v.optional(v.string()),
  questionText: v.string(),
  screeningQuestions: v.array(v.object({ question: v.string() })),
  screeningResponses: v.array(v.object({ paperId: v.string(), responses: answers })),
  dateRange: v.optional(v.object({ from: v.optional(v.string()), to: v.optional(v.string()) })),
  yearRange: v.optional(numbers),
  filterType: v.optional(v.union(v.literal("date"), v.literal("year"))),
  isYearRangeEnabled: v.optional(v.boolean()),
  sortBy: v.optional(v.string()),
  selectedRegions: v.optional(strings),
  selectedCountryFocus: v.optional(strings),
  ratingRange: v.optional(numbers),
  onlyRatedPapers: v.optional(v.boolean()),
  citesItemId: v.optional(v.string()),
  citedByItemId: v.optional(v.string()),
  relatedToItemId: v.optional(v.string()),
  reviewFilter: v.optional(v.boolean()),
  researchAreas: v.optional(strings),
  sdgs: v.optional(strings),
  openAccessOnly: v.optional(v.boolean()),
  workTypes: v.optional(strings),
  workLanguages: v.optional(strings),
  institutionTypes: v.optional(strings),
  funders: v.optional(strings),
  minCitations: v.optional(v.number()),
  hasAbstract: v.optional(v.boolean()),
  includeRetracted: v.optional(v.boolean()),
  language: v.optional(v.string()),
  page: v.optional(v.number()),
  chatJobIdsByAccountId: v.optional(v.record(v.string(), v.string())),
  createdAt: v.string(),
  updatedAt: v.string(),
};
export const searchValidator = v.object(searchFields);

/**
 * A search as stored. One saved before its history had its own rows (#354) still holds the
 * history arrays and no summary, until migrations/moveSearchHistory moves it.
 */
export const storedSearchValidator = v.object({
  ...searchFields,
  queryHistoryCount: v.optional(v.number()),
  questionCount: v.optional(v.number()),
  questionText: v.optional(v.string()),
  queryHistory: v.optional(historyArrays.queryHistory),
  questionHistory: v.optional(historyArrays.questionHistory),
});
export type StoredSearch = Infer<typeof storedSearchValidator>;

/** A stored search as the app reads it: its history summarised, never the arrays. */
export function currentSearch(stored: StoredSearch): SavedSearch {
  const { queryHistory, questionHistory, ...rest } = stored;
  if (!queryHistory && !questionHistory && rest.queryHistoryCount !== undefined) return rest as SavedSearch;
  return { ...rest, ...historySummary(queryHistory ?? [], questionHistory ?? []) };
}
/** Who set a screening answer. `unrecorded` is for answers saved before this was recorded. */
export const answerSourceValidator = v.union(v.literal("model"), v.literal("person"), v.literal("assistant"), v.literal("unrecorded"));
/** One paper's screening answers, each with who set it and when. */
export const paperAnswersValidator = v.array(v.object({ question: v.string(), answer: v.union(v.boolean(), v.null()), setBy: answerSourceValidator, updatedAt: v.number() }));
export type SavedSearch = Infer<typeof searchValidator>;
// A search's history summary changes only with its history, never by a patch.
const { id: _id, createdAt: _createdAt, queryHistoryCount: _queries, questionCount: _questions, latestQuestion: _latest, questionText: _text, ...editableFields } = searchFields;
const summaryValidator = v.object({ queryHistoryCount: v.number(), questionCount: v.number(), latestQuestion: v.optional(v.string()), questionText: v.string() });
export const editValidator = v.union(
  v.object({ kind: v.literal("patch"), fields: v.object(partial(editableFields)), clear: strings }),
  v.object({ kind: v.literal("query"), query: v.string(), field: fieldValidator }),
  v.object({ kind: v.literal("question"), question: v.string() }),
  v.object({ kind: v.literal("removeQueryHistoryEntry"), query: v.string(), field: v.optional(fieldValidator), timestamp: v.string() }),
  // Gives the search another search's parameters (`fields`, `clear`) and history at once, as
  // that search was at `fromUpdatedAt`. `summary` is its history's, for the page to show at once.
  v.object({ kind: v.literal("copySearch"), from: v.string(), fromUpdatedAt: v.string(), fields: v.object(partial(editableFields)), clear: strings, summary: summaryValidator }),
  v.object({ kind: v.literal("addScreeningQuestion"), question: v.string() }),
  v.object({ kind: v.literal("replaceScreeningQuestion"), question: v.string(), replacement: v.union(v.string(), v.null()) }),
  v.object({ kind: v.literal("clearScreeningQuestions") }),
  // `by` says whether the model or the person gave these answers, so each is recorded with who set it.
  v.object({ kind: v.literal("responses"), paperId: v.string(), responses: answers, by: v.optional(v.union(v.literal("model"), v.literal("person"))) }),
  v.object({ kind: v.literal("clearResponses"), paperId: v.optional(v.string()) }),
  v.object({ kind: v.literal("removeQuestionResponses"), question: v.string() }),
);
export type SearchEdit = Infer<typeof editValidator>;

/** Accept the native JSON export and the History CSV column names. */
export function importSearchRecord(row: Record<string, unknown>, id = crypto.randomUUID()): SearchResult {
  const now = new Date().toISOString();
  const query = String(row.search_query ?? row.query ?? "");
  const field = (row.field ?? "title_and_abstract") as SearchResult["field"];
  const known = Object.fromEntries(Object.entries(row).filter(([key]) => key in searchFields));
  const queryHistory = Array.isArray(row.queryHistory) && row.queryHistory.length ? row.queryHistory as SearchResult["queryHistory"] & object : [{ query, field, timestamp: now }];
  const questionHistory = Array.isArray(row.questionHistory) ? row.questionHistory as SearchResult["questionHistory"] & object : [];
  return {
    field, screeningQuestions: [], screeningResponses: {}, createdAt: now, updatedAt: now,
    ...known, ...historySummary(queryHistory, questionHistory), queryHistory, questionHistory, id, query, count: Number(row.count ?? 0),
  } as SearchResult;
}

export function serializeSearch(search: SearchResult): SavedSearch {
  // Dates in older localStorage exports are already strings. A search held in this browser
  // carries its whole history, which its summary is taken from.
  const summary = search.queryHistory ? historySummary(search.queryHistory, search.questionHistory ?? []) : {};
  const known = Object.fromEntries(Object.entries({ ...search, ...summary }).filter(([key]) => key in searchFields));
  return JSON.parse(JSON.stringify({ ...known, screeningResponses: Object.entries(search.screeningResponses ?? {}).map(([paperId, responses]) => ({ paperId, responses: serializeResponses(responses) })) })) as SavedSearch;
}

export function serializeResponses(responses: Record<string, boolean | null>) {
  return Object.entries(responses).map(([question, response]) => ({ question, response }));
}

export function serializeSearchPatch(updates: Partial<Omit<SearchResult, "id" | "createdAt">>): Extract<SearchEdit, { kind: "patch" }> {
  const fields = JSON.parse(JSON.stringify(updates)) as Extract<SearchEdit, { kind: "patch" }>["fields"];
  if (updates.screeningResponses !== undefined) fields.screeningResponses = Object.entries(updates.screeningResponses).map(([paperId, responses]) => ({ paperId, responses: serializeResponses(responses) }));
  return { kind: "patch", fields, clear: Object.keys(updates).filter(key => updates[key as keyof typeof updates] === undefined) };
}

export function restoreSearch(search: SavedSearch): SearchResult {
  const dateRange = search.dateRange && {
    from: search.dateRange.from ? new Date(search.dateRange.from) : undefined,
    to: search.dateRange.to ? new Date(search.dateRange.to) : undefined,
  };
  return {
    ...search, dateRange,
    screeningResponses: Object.fromEntries(search.screeningResponses.map(({ paperId, responses }) => [paperId, Object.fromEntries(responses.map(({ question, response }) => [question, response]))])),
    yearRange: search.yearRange as [number, number] | undefined,
    ratingRange: search.ratingRange as [number, number] | undefined,
  };
}

/** What a search keeps of its questions once `question` is added. */
export function withQuestion(search: Pick<SavedSearch, "questionCount" | "questionText">, question: string) {
  const known = search.questionText.split("\n").includes(question);
  const text = known ? search.questionText : search.questionText ? `${search.questionText}\n${question}` : question;
  // The newest questions are kept when the text passes the limit.
  return { questionCount: search.questionCount + 1, latestQuestion: question, questionText: text.length > QUESTION_TEXT_MAX ? text.slice(-QUESTION_TEXT_MAX) : text };
}

/** The summary a search keeps of a full history. */
export function historySummary(queries: readonly unknown[], questions: ReadonlyArray<{ question: string }>) {
  let summary = { queryHistoryCount: queries.length, questionCount: 0, latestQuestion: undefined as string | undefined, questionText: "" };
  for (const { question } of questions) summary = { ...summary, ...withQuestion(summary, question) };
  return summary;
}

function withoutQuestion(responses: SavedSearch["screeningResponses"], question: string) {
  return responses.map(row => ({ ...row, responses: row.responses.filter(value => value.question !== question) }));
}

function patched(search: SavedSearch, fields: Extract<SearchEdit, { kind: "patch" }>["fields"], clear: string[]) {
  const next = { ...search, ...fields };
  for (const key of clear) {
    if (!(key in editableFields) || editableFields[key as keyof typeof editableFields].isOptional !== "optional") {
      throw new Error(`Cannot clear search field ${key}`);
    }
    delete next[key as keyof SavedSearch];
  }
  return next;
}

/** Shared by the transaction and the optimistic browser view. */
export function applySearchEdit(search: SavedSearch, edit: SearchEdit, now: string): SavedSearch {
  let changes: Partial<SavedSearch>;
  switch (edit.kind) {
    case "patch":
      return { ...patched(search, edit.fields, edit.clear), updatedAt: now };
    case "copySearch":
      return { ...patched(search, edit.fields, edit.clear), ...edit.summary, latestQuestion: edit.summary.latestQuestion, updatedAt: now };
    case "query":
      changes = { query: edit.query, field: edit.field, queryHistoryCount: search.queryHistoryCount + 1 };
      break;
    case "question":
      changes = withQuestion(search, edit.question);
      break;
    case "removeQueryHistoryEntry":
      changes = { queryHistoryCount: Math.max(0, search.queryHistoryCount - 1) };
      break;
    case "addScreeningQuestion":
      changes = { screeningQuestions: [...search.screeningQuestions, { question: edit.question }] };
      break;
    case "replaceScreeningQuestion":
      changes = {
        screeningQuestions: search.screeningQuestions.flatMap((entry) => entry.question !== edit.question ? [entry] : edit.replacement === null ? [] : [{ question: edit.replacement }]),
        screeningResponses: withoutQuestion(search.screeningResponses, edit.question),
      };
      break;
    case "clearScreeningQuestions":
      changes = { screeningQuestions: [], screeningResponses: [] };
      break;
    case "responses": {
      const existing = search.screeningResponses.find(row => row.paperId === edit.paperId);
      const merged = new Map((existing?.responses ?? []).map(value => [value.question, value.response]));
      for (const value of edit.responses) merged.set(value.question, value.response);
      const row = { paperId: edit.paperId, responses: Array.from(merged, ([question, response]) => ({ question, response })) };
      changes = { screeningResponses: existing ? search.screeningResponses.map(value => value.paperId === edit.paperId ? row : value) : [...search.screeningResponses, row] };
      break;
    }
    case "clearResponses":
      changes = { screeningResponses: edit.paperId ? search.screeningResponses.filter(row => row.paperId !== edit.paperId) : [] };
      break;
    case "removeQuestionResponses":
      changes = { screeningResponses: withoutQuestion(search.screeningResponses, edit.question) };
  }
  return { ...search, ...changes, updatedAt: now };
}

export const shortcutValidator = v.object({ shorthand: v.string(), expansion: v.string(), createdAt: v.number() });
export const ratingValidator = v.object({ paperId: v.string(), rating: v.number() });
export const commandValidator = v.union(
  // `history`: the earlier queries and questions of a search brought from this browser or a file.
  v.object({ kind: v.literal("createSearch"), search: searchValidator, history: v.optional(v.object(historyArrays)) }),
  v.object({ kind: v.literal("editSearch"), id: v.string(), edit: editValidator }),
  v.object({ kind: v.literal("deleteSearch"), id: v.string() }),
  v.object({ kind: v.literal("shortcut"), shorthand: v.string(), value: v.union(v.object({ expansion: v.string(), createdAt: v.number() }), v.null()) }),
  v.object({ kind: v.literal("rating"), paperId: v.string(), rating: v.union(v.number(), v.null()) }),
);
export type ResearchCommand = Infer<typeof commandValidator>;
