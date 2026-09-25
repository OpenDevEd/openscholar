import posthog from "posthog-js";
import type { SearchParams } from "@/lib/search/types";
import type { SearchResult } from "@/lib/types";
import { DEFAULT_SEARCH_PARAMS } from "@/lib/search-params/parsers";

export const SEARCH_EVENT_SCHEMA_VERSION = 2 as const;

export type SearchParamKey = keyof SearchParams;
export type SearchTrigger =
  | "initial_load"
  | "query_change"
  | "filter_change"
  | "pagination"
  | "unknown";

const SEARCH_PARAM_KEYS: SearchParamKey[] = [
  "q",
  "field",
  "sort",
  "page",
  "yf",
  "yt",
  "df",
  "dt",
  "ft",
  "rmin",
  "rmax",
  "rated",
  "reg",
  "focus",
  "cites",
  "citedBy",
  "rel",
  "review",
  "area",
  "sdg",
  "oa",
  "type",
  "lang",
];

export const SEARCH_FETCH_PARAM_KEYS: SearchParamKey[] = [
  "q",
  "field",
  "sort",
  "yf",
  "yt",
  "df",
  "dt",
  "ft",
  "reg",
  "focus",
  "cites",
  "citedBy",
  "rel",
  "review",
  "area",
  "sdg",
  "oa",
  "type",
];

function arraysEqualStable(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

function hasBooleanOperators(query: string): boolean {
  return /\b(AND|OR|NOT)\b/i.test(query);
}

function getActiveFilterKeys(params: SearchParams): string[] {
  const activeKeys: string[] = [];

  if (params.field !== DEFAULT_SEARCH_PARAMS.field) activeKeys.push("field");
  if (params.sort !== DEFAULT_SEARCH_PARAMS.sort) activeKeys.push("sort");
  if (params.yf !== null || params.yt !== null) activeKeys.push("year_range");
  if (params.df !== null || params.dt !== null) activeKeys.push("date_range");
  if (params.rmin !== DEFAULT_SEARCH_PARAMS.rmin || params.rmax !== DEFAULT_SEARCH_PARAMS.rmax) {
    activeKeys.push("rating_range");
  }
  if (params.rated) activeKeys.push("only_rated");
  if (params.reg.length > 0) activeKeys.push("regions");
  if (params.focus.length > 0) activeKeys.push("country_focus");
  if (params.cites) activeKeys.push("cites");
  if (params.citedBy) activeKeys.push("cited_by");
  if (params.rel) activeKeys.push("related_to");
  if (params.review) activeKeys.push("review_only");
  if (params.area.length > 0) activeKeys.push("research_areas");
  if (params.sdg.length > 0) activeKeys.push("sdgs");
  if (params.oa) activeKeys.push("open_access");
  if (params.type.length > 0) activeKeys.push("work_types");
  if (params.lang) activeKeys.push("language");

  return activeKeys;
}

export interface SearchFilterSnapshot {
  query: string;
  query_length: number;
  has_boolean_operators: boolean;
  research_question: string | null;
  research_question_count: number;
  screening_questions: string[];
  screening_question_count: number;
  language: string;
  field: string;
  sort: string;
  page: number;
  filter_type: string;
  year_from: number | null;
  year_to: number | null;
  date_from: string | null;
  date_to: string | null;
  rating_min: number;
  rating_max: number;
  only_rated: boolean;
  regions: string[];
  regions_count: number;
  country_focus: string[];
  country_focus_count: number;
  cites_item_id: string | null;
  cited_by_item_id: string | null;
  related_to_item_id: string | null;
  review_only: boolean;
  research_areas: string[];
  sdgs: string[];
  open_access_only: boolean;
  work_types: string[];
  active_filter_count: number;
  active_filter_keys: string[];
}

export interface SearchBaseEventPayload extends SearchFilterSnapshot {
  search_id: string;
  request_id: string;
  trigger: SearchTrigger;
  changed_param_keys: SearchParamKey[];
  changed_param_count: number;
  search_event_schema_version: typeof SEARCH_EVENT_SCHEMA_VERSION;
}

export interface SearchSucceededEventPayload extends SearchBaseEventPayload {
  duration_ms: number;
  results_count: number;
  validation_is_valid: boolean;
  validation_warning_count: number;
}

export interface SearchFailedEventPayload extends SearchBaseEventPayload {
  duration_ms: number;
  error_message: string;
  error_type: string;
}

export function createSearchRequestId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `search-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

interface SearchHistoryContext {
  research_question: string | null;
  research_question_count: number;
  screening_questions: string[];
  screening_question_count: number;
}

function buildSearchHistoryContext(
  searchResult: SearchResult | undefined,
  fallbackResearchQuestion: string
): SearchHistoryContext {
  const questionHistory = searchResult?.questionHistory || [];
  const screeningQuestions = searchResult?.screeningQuestions || [];

  const lastQuestion = questionHistory[questionHistory.length - 1]?.question?.trim() || "";
  const fallbackQuestion = fallbackResearchQuestion.trim();

  return {
    research_question: lastQuestion || fallbackQuestion || null,
    research_question_count: questionHistory.length,
    screening_questions: screeningQuestions.map((item) => item.question),
    screening_question_count: screeningQuestions.length,
  };
}

export function buildSearchFilterSnapshot(
  params: SearchParams,
  options?: {
    searchResult?: SearchResult;
    fallbackResearchQuestion?: string;
  }
): SearchFilterSnapshot {
  const activeFilterKeys = getActiveFilterKeys(params);
  const query = params.q || "";
  const historyContext = buildSearchHistoryContext(
    options?.searchResult,
    options?.fallbackResearchQuestion || ""
  );

  return {
    query,
    query_length: query.length,
    has_boolean_operators: hasBooleanOperators(query),
    ...historyContext,
    language: params.lang || "en",
    field: params.field,
    sort: params.sort,
    page: params.page,
    filter_type: params.ft,
    year_from: params.yf,
    year_to: params.yt,
    date_from: params.df,
    date_to: params.dt,
    rating_min: params.rmin,
    rating_max: params.rmax,
    only_rated: params.rated,
    regions: params.reg,
    regions_count: params.reg.length,
    country_focus: params.focus,
    country_focus_count: params.focus.length,
    cites_item_id: params.cites || null,
    cited_by_item_id: params.citedBy || null,
    related_to_item_id: params.rel || null,
    review_only: params.review,
    research_areas: params.area,
    sdgs: params.sdg,
    open_access_only: params.oa,
    work_types: params.type,
    active_filter_count: activeFilterKeys.length,
    active_filter_keys: activeFilterKeys,
  };
}

export function getChangedParamKeys(
  previous: SearchParams | null | undefined,
  current: SearchParams
): SearchParamKey[] {
  if (!previous) {
    return [...SEARCH_PARAM_KEYS];
  }

  const changed: SearchParamKey[] = [];
  for (const key of SEARCH_PARAM_KEYS) {
    if (key === "reg" || key === "focus" || key === "area" || key === "sdg" || key === "type") {
      if (!arraysEqualStable(previous[key], current[key])) {
        changed.push(key);
      }
      continue;
    }

    if (previous[key] !== current[key]) {
      changed.push(key);
    }
  }

  return changed;
}

export function deriveSearchTrigger(
  previous: SearchParams | null | undefined,
  _current: SearchParams,
  changedKeys: SearchParamKey[]
): SearchTrigger {
  if (!previous) return "initial_load";
  if (changedKeys.length === 0) return "unknown";
  if (changedKeys.every((key) => key === "page")) return "pagination";
  if (changedKeys.includes("q")) return "query_change";
  return "filter_change";
}

export function captureSearchExecuted(payload: SearchBaseEventPayload): void {
  posthog.capture("search_executed", payload);
}

export function captureSearchSucceeded(payload: SearchSucceededEventPayload): void {
  posthog.capture("search_succeeded", payload);
}

export function captureSearchFailed(payload: SearchFailedEventPayload): void {
  posthog.capture("search_failed", payload);
}
