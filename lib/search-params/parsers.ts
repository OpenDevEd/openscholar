/**
 * URL Search Params Parsers
 * 
 * Defines nuqs parsers for all search parameters.
 * These parsers handle serialization/deserialization of URL query params.
 */

import {
  parseAsString,
  parseAsInteger,
  parseAsBoolean,
  createParser,
  createSerializer,
} from 'nuqs';
import { encodeRegions, decodeRegions } from './regions';

/**
 * Custom parser for region arrays with smart encoding
 */
export const parseAsRegions = createParser({
  parse: (value: string) => {
    if (!value) return [];
    return decodeRegions(value);
  },
  serialize: (value: string[]) => {
    if (!value || value.length === 0) return '';
    return encodeRegions(value);
  },
});

/**
 * All search parameter parsers
 * 
 * Short param names for compact URLs:
 * - q: query
 * - field: search field
 * - sort: sort order
 * - page: pagination
 * - yf/yt: year from/to
 * - df/dt: date from/to (ISO strings)
 * - ft: filter type (year|date)
 * - rmin/rmax: rating min/max
 * - rated: only show rated papers
 * - reg: regions (smart encoded)
 * - focus: country focus (smart encoded)
 * - cites/citedBy/rel: reference filters
 * - review: review articles only
 * - lang: language filter
 */
export const searchParamsParsers = {
  // Core search
  q: parseAsString.withDefault(''),
  field: parseAsString.withDefault('title_and_abstract'),
  sort: parseAsString.withDefault('relevance_score:desc'),
  
  // Pagination
  page: parseAsInteger.withDefault(1),
  
  // Year filter
  yf: parseAsInteger, // yearFrom
  yt: parseAsInteger, // yearTo
  
  // Date filter (ISO strings)
  df: parseAsString, // dateFrom
  dt: parseAsString, // dateTo
  ft: parseAsString.withDefault('year'), // filterType: 'year' | 'date'
  
  // Rating filter (client-side)
  rmin: parseAsInteger.withDefault(0),
  rmax: parseAsInteger.withDefault(5),
  rated: parseAsBoolean.withDefault(false),
  
  // Geographic filters (smart encoded)
  reg: parseAsRegions.withDefault([]),
  focus: parseAsRegions.withDefault([]),
  
  // Reference filters
  cites: parseAsString.withDefault(''),
  citedBy: parseAsString.withDefault(''),
  rel: parseAsString.withDefault(''), // relatedTo
  
  // Content filters
  review: parseAsBoolean.withDefault(false),
  
  // Language
  lang: parseAsString,
};

/**
 * Type for parsed search params
 */
export type ParsedSearchParams = {
  q: string;
  field: string;
  sort: string;
  page: number;
  yf: number | null;
  yt: number | null;
  df: string | null;
  dt: string | null;
  ft: string;
  rmin: number;
  rmax: number;
  rated: boolean;
  reg: string[];
  focus: string[];
  cites: string;
  citedBy: string;
  rel: string;
  review: boolean;
  lang: string | null;
};

/**
 * NaN-safe integer read from a URLSearchParams. A malformed value (e.g.
 * `page=abc`) falls back to `fallback` instead of producing `NaN`.
 */
function parseIntegerParam(
  searchParams: URLSearchParams,
  key: string,
  fallback: number | null
): number | null {
  const raw = searchParams.get(key);
  if (raw === null) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Parse URLSearchParams into ParsedSearchParams using the module defaults.
 * Unknown query params are ignored, and malformed numeric params fall back to
 * their defaults rather than becoming NaN.
 */
export function parseSearchParamsFromUrl(
  searchParams: URLSearchParams
): ParsedSearchParams {
  return {
    q: searchParams.get('q') ?? DEFAULT_SEARCH_PARAMS.q,
    field: searchParams.get('field') ?? DEFAULT_SEARCH_PARAMS.field,
    sort: searchParams.get('sort') ?? DEFAULT_SEARCH_PARAMS.sort,
    page:
      parseIntegerParam(searchParams, 'page', DEFAULT_SEARCH_PARAMS.page) ??
      DEFAULT_SEARCH_PARAMS.page,
    yf: parseIntegerParam(searchParams, 'yf', null),
    yt: parseIntegerParam(searchParams, 'yt', null),
    df: searchParams.get('df') ?? null,
    dt: searchParams.get('dt') ?? null,
    ft: searchParams.get('ft') ?? DEFAULT_SEARCH_PARAMS.ft,
    rmin:
      parseIntegerParam(searchParams, 'rmin', DEFAULT_SEARCH_PARAMS.rmin) ??
      DEFAULT_SEARCH_PARAMS.rmin,
    rmax:
      parseIntegerParam(searchParams, 'rmax', DEFAULT_SEARCH_PARAMS.rmax) ??
      DEFAULT_SEARCH_PARAMS.rmax,
    rated: searchParams.get('rated') === 'true',
    reg: searchParams.has('reg') ? decodeRegions(searchParams.get('reg') || '') : [],
    focus: searchParams.has('focus') ? decodeRegions(searchParams.get('focus') || '') : [],
    cites: searchParams.get('cites') ?? DEFAULT_SEARCH_PARAMS.cites,
    citedBy: searchParams.get('citedBy') ?? DEFAULT_SEARCH_PARAMS.citedBy,
    rel: searchParams.get('rel') ?? DEFAULT_SEARCH_PARAMS.rel,
    review: searchParams.get('review') === 'true',
    lang: searchParams.get('lang') ?? null,
  };
}

/**
 * Create URL serializer for building shareable URLs
 * clearOnDefault: false ensures empty searches still produce valid query strings
 */
export const serializeSearchParams = createSerializer(searchParamsParsers, {
  clearOnDefault: false
});

/**
 * Default values matching the parsers
 */
export const DEFAULT_SEARCH_PARAMS: ParsedSearchParams = {
  q: '',
  field: 'title_and_abstract',
  sort: 'relevance_score:desc',
  page: 1,
  yf: null,
  yt: null,
  df: null,
  dt: null,
  ft: 'year',
  rmin: 0,
  rmax: 5,
  rated: false,
  reg: [],
  focus: [],
  cites: '',
  citedBy: '',
  rel: '',
  review: false,
  lang: null,
};
