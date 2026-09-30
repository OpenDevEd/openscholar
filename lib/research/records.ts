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

export const searchFields = {
  id: v.string(),
  query: v.string(),
  field: fieldValidator,
  count: v.number(),
  queryHistory: v.array(v.object({ query: v.string(), timestamp: v.string(), field: v.optional(fieldValidator) })),
  questionHistory: v.array(v.object({ question: v.string(), timestamp: v.string() })),
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
/** Who set a screening answer. `unrecorded` is for answers saved before this was recorded. */
export const answerSourceValidator = v.union(v.literal("model"), v.literal("person"), v.literal("assistant"), v.literal("unrecorded"));
export type SavedSearch = Infer<typeof searchValidator>;
const { id: _id, createdAt: _createdAt, ...editableFields } = searchFields;
export const editValidator = v.union(
  v.object({ kind: v.literal("patch"), fields: v.object(partial(editableFields)), clear: strings }),
  v.object({ kind: v.literal("query"), query: v.string(), field: fieldValidator }),
  v.object({ kind: v.literal("question"), question: v.string() }),
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
  return {
    field, queryHistory: [{ query, field, timestamp: now }], questionHistory: [],
    screeningQuestions: [], screeningResponses: {}, createdAt: now, updatedAt: now,
    ...known, id, query, count: Number(row.count ?? 0),
  } as SearchResult;
}

export function serializeSearch(search: SearchResult): SavedSearch {
  // Dates in older localStorage exports are already strings.
  const known = Object.fromEntries(Object.entries(search).filter(([key]) => key in searchFields));
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

function withoutQuestion(responses: SavedSearch["screeningResponses"], question: string) {
  return responses.map(row => ({ ...row, responses: row.responses.filter(value => value.question !== question) }));
}

/** Shared by the transaction and the optimistic browser view. */
export function applySearchEdit(search: SavedSearch, edit: SearchEdit, now: string): SavedSearch {
  let changes: Partial<SavedSearch>;
  switch (edit.kind) {
    case "patch": {
      const next = { ...search, ...edit.fields };
      for (const key of edit.clear) {
        if (!(key in editableFields) || editableFields[key as keyof typeof editableFields].isOptional !== "optional") {
          throw new Error(`Cannot clear search field ${key}`);
        }
        delete next[key as keyof SavedSearch];
      }
      return { ...next, updatedAt: now };
    }
    case "query":
      changes = { query: edit.query, field: edit.field, queryHistory: [...search.queryHistory, { query: edit.query, field: edit.field, timestamp: now }] };
      break;
    case "question":
      changes = { questionHistory: [...search.questionHistory, { question: edit.question, timestamp: now }] };
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
  v.object({ kind: v.literal("createSearch"), search: searchValidator }),
  v.object({ kind: v.literal("editSearch"), id: v.string(), edit: editValidator }),
  v.object({ kind: v.literal("deleteSearch"), id: v.string() }),
  v.object({ kind: v.literal("shortcut"), shorthand: v.string(), value: v.union(v.object({ expansion: v.string(), createdAt: v.number() }), v.null()) }),
  v.object({ kind: v.literal("rating"), paperId: v.string(), rating: v.union(v.number(), v.null()) }),
);
export type ResearchCommand = Infer<typeof commandValidator>;
