import { v, type Infer } from "convex/values";
import { format, parseISO } from "date-fns";
import { partial } from "convex-helpers/validators";
import type { SearchResult } from "../types/search.types";
import { MAX_FILTER_VALUES, MAX_LEGACY_ENTRIES, MAX_LINKED_ACCOUNTS, MAX_QUESTIONS, RANGE_ENDS, capped } from "../../convex/lib/listCaps";

const strings = v.array(v.string());
// Each stored list gets its own validator: a cap sticks to the one it's set on, and
// v.optional copies the validator it's given (convex/lib/listCaps.ts).
const filterValues = () => capped(v.optional(v.array(v.string())), MAX_FILTER_VALUES);
const range = () => capped(v.optional(v.array(v.number())), RANGE_ENDS);
const answer = v.union(v.boolean(), v.null());
const answers = capped(v.array(v.object({ question: v.string(), response: answer })), MAX_QUESTIONS);
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
  screeningQuestions: capped(v.array(v.object({ question: v.string() })), MAX_QUESTIONS),
  // The answers a new search comes with, from an import or the assistant. A saved search's
  // answers live in its screening's rows and are read by paper (research/records:answersOf).
  screeningResponses: v.array(v.object({ paperId: v.string(), responses: answers })),
  dateRange: v.optional(v.object({ from: v.optional(v.string()), to: v.optional(v.string()) })),
  yearRange: range(),
  filterType: v.optional(v.union(v.literal("date"), v.literal("year"))),
  isYearRangeEnabled: v.optional(v.boolean()),
  sortBy: v.optional(v.string()),
  selectedRegions: filterValues(),
  selectedCountryFocus: filterValues(),
  ratingRange: range(),
  onlyRatedPapers: v.optional(v.boolean()),
  citesItemId: v.optional(v.string()),
  citedByItemId: v.optional(v.string()),
  relatedToItemId: v.optional(v.string()),
  reviewFilter: v.optional(v.boolean()),
  researchAreas: filterValues(),
  sdgs: filterValues(),
  openAccessOnly: v.optional(v.boolean()),
  workTypes: filterValues(),
  workLanguages: filterValues(),
  institutionTypes: filterValues(),
  funders: filterValues(),
  minCitations: v.optional(v.number()),
  hasAbstract: v.optional(v.boolean()),
  includeRetracted: v.optional(v.boolean()),
  language: v.optional(v.string()),
  page: v.optional(v.number()),
  chatJobIdsByAccountId: capped(v.optional(v.record(v.string(), v.string())), MAX_LINKED_ACCOUNTS),
  createdAt: v.string(),
  updatedAt: v.string(),
};
export const searchValidator = v.object(searchFields);
/** A search as lists show it: everything but its screening answers, which only its page reads. */
const { screeningResponses: _responses, ...listedFields } = searchFields;
export const listedSearchValidator = v.object(listedFields);
export type ListedSearch = Infer<typeof listedSearchValidator>;
export const listedSortValidator = v.union(v.literal("recent"), v.literal("oldest"), v.literal("most"), v.literal("least"));
export type ListedSort = Infer<typeof listedSortValidator>;

/**
 * A search as stored. One saved before its history had its own rows (#354) still holds the
 * history arrays and no summary, until migrations/moveSearchHistory moves it.
 */
export const storedSearchValidator = v.object({
  ...searchFields,
  queryHistoryCount: v.optional(v.number()),
  questionCount: v.optional(v.number()),
  questionText: v.optional(v.string()),
  // Answers moved to the search's screening (#334); old stored searches may still hold some.
  screeningResponses: capped(v.array(v.object({ paperId: v.string(), responses: answers })), MAX_LEGACY_ENTRIES),
  queryHistory: capped(v.optional(v.array(queryHistoryEntryValidator)), MAX_LEGACY_ENTRIES),
  questionHistory: capped(v.optional(v.array(questionHistoryEntryValidator)), MAX_LEGACY_ENTRIES),
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
/**
 * One paper's screening answers, each with who set it and when. `model` is the model's own
 * answer and its confidence in it, kept when a person or the assistant changes the answer;
 * the answer was reviewed when someone else set it after the model.
 */
export const paperAnswersValidator = capped(v.array(v.object({
  question: v.string(), answer: v.union(v.boolean(), v.null()), setBy: answerSourceValidator, updatedAt: v.number(),
  model: v.optional(v.object({ answer: v.union(v.boolean(), v.null()), confidence: v.optional(v.number()), at: v.number() })),
})), MAX_QUESTIONS);
export type SavedSearch = Infer<typeof searchValidator>;
// A search's history summary changes only with its history, and its answers only through the
// answer edits, never by a patch.
const { id: _id, createdAt: _createdAt, queryHistoryCount: _queries, questionCount: _questions, latestQuestion: _latest, questionText: _text, screeningResponses: _answers, ...editableFields } = searchFields;
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
  // `by` says whether the model or the person gave these answers, so each is recorded with who
  // set it. The model's answers carry its confidence in each when it reported one.
  v.object({
    kind: v.literal("responses"), paperId: v.string(), by: v.optional(v.union(v.literal("model"), v.literal("person"))),
    responses: v.array(v.object({ question: v.string(), response: answer, confidence: v.optional(v.number()) })),
  }),
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A picked calendar day as `YYYY-MM-DD`, the same day wherever the search is read. A date
 * from the picker is the browser's local midnight, so its local day. A day saved before
 * 2026-10-02 as that midnight's instant is the nearest UTC midnight's day, which recovers
 * the picked day in every timezone from UTC-11 to UTC+11.
 */
export function calendarDay(value: Date | string): string {
  if (value instanceof Date) return format(value, "yyyy-MM-dd");
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(Math.round(Date.parse(value) / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}

/** A date range's days as calendar days. */
function dateRangeDays(range: { from?: Date | string; to?: Date | string } | undefined) {
  return range && { ...(range.from ? { from: calendarDay(range.from) } : {}), ...(range.to ? { to: calendarDay(range.to) } : {}) };
}

export function serializeSearch(search: SearchResult): SavedSearch {
  // Dates in older localStorage exports are already strings. A search held in this browser
  // carries its whole history, which its summary is taken from.
  const summary = search.queryHistory ? historySummary(search.queryHistory, search.questionHistory ?? []) : {};
  const known = Object.fromEntries(Object.entries({ ...search, ...summary }).filter(([key]) => key in searchFields));
  return JSON.parse(JSON.stringify({ ...known, ...(search.dateRange ? { dateRange: dateRangeDays(search.dateRange) } : {}), screeningResponses: Object.entries(search.screeningResponses ?? {}).map(([paperId, responses]) => ({ paperId, responses: serializeResponses(responses) })) })) as SavedSearch;
}

export function serializeResponses(responses: Record<string, boolean | null>) {
  return Object.entries(responses).map(([question, response]) => ({ question, response }));
}

export function serializeSearchPatch(updates: Partial<Omit<SearchResult, "id" | "createdAt">>): Extract<SearchEdit, { kind: "patch" }> {
  const fields = JSON.parse(JSON.stringify({ ...updates, ...(updates.dateRange ? { dateRange: dateRangeDays(updates.dateRange) } : {}) })) as Extract<SearchEdit, { kind: "patch" }>["fields"];
  // Answers change through their own edits; a patch never carries them.
  delete (fields as { screeningResponses?: unknown }).screeningResponses;
  return { kind: "patch", fields, clear: Object.keys(updates).filter(key => updates[key as keyof typeof updates] === undefined) };
}

/** Answers as the pages hold them: by paper, then by question. */
export function restoreResponses(responses: SavedSearch["screeningResponses"]): SearchResult["screeningResponses"] {
  return Object.fromEntries(responses.map(({ paperId, responses }) => [paperId, Object.fromEntries(responses.map(({ question, response }) => [question, response]))]));
}

export function restoreSearch(search: SavedSearch): SearchResult {
  // A calendar day reads as that day's local midnight, wherever it's read.
  const dateRange = search.dateRange && {
    from: search.dateRange.from ? parseISO(calendarDay(search.dateRange.from)) : undefined,
    to: search.dateRange.to ? parseISO(calendarDay(search.dateRange.to)) : undefined,
  };
  return {
    ...search, dateRange,
    screeningResponses: restoreResponses(search.screeningResponses),
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

/** A search's answers after `edit`: changed by the edits that set or remove answers, the same otherwise. */
export function editedResponses(responses: SavedSearch["screeningResponses"], edit: SearchEdit): SavedSearch["screeningResponses"] {
  switch (edit.kind) {
    case "replaceScreeningQuestion":
    case "removeQuestionResponses":
      return withoutQuestion(responses, edit.question);
    case "clearScreeningQuestions":
      return [];
    case "responses": {
      const existing = responses.find(row => row.paperId === edit.paperId);
      const merged = new Map((existing?.responses ?? []).map(value => [value.question, value.response]));
      for (const value of edit.responses) merged.set(value.question, value.response);
      const row = { paperId: edit.paperId, responses: Array.from(merged, ([question, response]) => ({ question, response })) };
      return existing ? responses.map(value => value.paperId === edit.paperId ? row : value) : [...responses, row];
    }
    case "clearResponses":
      return edit.paperId ? responses.filter(row => row.paperId !== edit.paperId) : [];
    default:
      return responses;
  }
}

/**
 * Shared by the transaction and the optimistic browser view. The transaction passes a search
 * with no answers, since they live in their own rows; the browser, the answers it has read.
 */
export function applySearchEdit(search: SavedSearch, edit: SearchEdit, now: string): SavedSearch {
  let changes: Partial<SavedSearch> = {};
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
      changes = { screeningQuestions: search.screeningQuestions.flatMap((entry) => entry.question !== edit.question ? [entry] : edit.replacement === null ? [] : [{ question: edit.replacement }]) };
      break;
    case "clearScreeningQuestions":
      changes = { screeningQuestions: [] };
  }
  return { ...search, ...changes, screeningResponses: editedResponses(search.screeningResponses, edit), updatedAt: now };
}

export const shortcutValidator = v.object({ shorthand: v.string(), expansion: v.string(), createdAt: v.number() });
/** How the Bookmarks page orders shortcuts: newest or oldest first, or by name. */
export const shortcutSortValidator = v.union(v.literal("recent"), v.literal("oldest"), v.literal("alpha"), v.literal("alpha-desc"));
/** Shortcut names one read takes: a shortcut is at most 1 MiB, so a read stays within a transaction's 16 MiB. */
export const SHORTCUT_NAMES_MAX = 15;
export const ratingValidator = v.object({ paperId: v.string(), rating: v.number() });
/** Papers one read of ratings takes: as many as a results page shows. */
export const RATED_PAPERS_MAX = 200;
/** One paper's screening answers, as a search's page reads them. */
export const paperResponsesValidator = v.object({ paperId: v.string(), responses: answers });
/** Papers one read of screening answers takes: as many as a results page shows. */
export const ANSWERED_PAPERS_MAX = 200;
export const commandValidator = v.union(
  // `history`: the earlier queries and questions of a search brought from this browser or a file.
  v.object({ kind: v.literal("createSearch"), search: searchValidator, history: v.optional(v.object(historyArrays)) }),
  v.object({ kind: v.literal("editSearch"), id: v.string(), edit: editValidator }),
  v.object({ kind: v.literal("deleteSearch"), id: v.string() }),
  v.object({ kind: v.literal("shortcut"), shorthand: v.string(), value: v.union(v.object({ expansion: v.string(), createdAt: v.number() }), v.null()) }),
  v.object({ kind: v.literal("rating"), paperId: v.string(), rating: v.union(v.number(), v.null()) }),
  // Every saved search, or every shortcut, the person has when it's applied: in order with
  // the saves around it, so one made before goes and one made after stays.
  v.object({ kind: v.literal("clearSearches") }),
  v.object({ kind: v.literal("clearShortcuts") }),
);
export type ResearchCommand = Infer<typeof commandValidator>;
