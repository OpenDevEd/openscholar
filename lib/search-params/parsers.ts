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
  parseAsArrayOf,
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
 * - area: research areas (catalog ids such as subfields/3304)
 * - sdg: sustainable development goals (1-17)
 * - oa: open access only
 * - type: OpenAlex work types
 * - wlang: languages the works are written in
 * - itype: types of the authors' institutions
 * - funder: OpenAlex funder ids
 * - mincite: minimum number of citations
 * - abs: only works with an abstract
 * - retracted: include retracted works, which are left out by default
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
  area: parseAsArrayOf(parseAsString).withDefault([]),
  sdg: parseAsArrayOf(parseAsString).withDefault([]),
  oa: parseAsBoolean.withDefault(false),
  type: parseAsArrayOf(parseAsString).withDefault([]),
  wlang: parseAsArrayOf(parseAsString).withDefault([]),
  itype: parseAsArrayOf(parseAsString).withDefault([]),
  funder: parseAsArrayOf(parseAsString).withDefault([]),
  mincite: parseAsInteger,
  abs: parseAsBoolean.withDefault(false),
  retracted: parseAsBoolean.withDefault(false),
  
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
  area: string[];
  sdg: string[];
  oa: boolean;
  type: string[];
  wlang: string[];
  itype: string[];
  funder: string[];
  mincite: number | null;
  abs: boolean;
  retracted: boolean;
  lang: string | null;
};

/** A comma-separated list param, as nuqs writes it. */
function parseListParam(searchParams: URLSearchParams, key: string): string[] {
  return searchParams.get(key)?.split(',').filter(Boolean) ?? [];
}

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
    area: parseListParam(searchParams, 'area'),
    sdg: parseListParam(searchParams, 'sdg'),
    oa: searchParams.get('oa') === 'true',
    type: parseListParam(searchParams, 'type'),
    wlang: parseListParam(searchParams, 'wlang'),
    itype: parseListParam(searchParams, 'itype'),
    funder: parseListParam(searchParams, 'funder'),
    mincite: parseIntegerParam(searchParams, 'mincite', null),
    abs: searchParams.get('abs') === 'true',
    retracted: searchParams.get('retracted') === 'true',
    lang: searchParams.get('lang') ?? null,
  };
}

/**
 * Create URL serializer for building shareable / canonical URLs.
 *
 * clearOnDefault: true omits any param equal to its default, so an empty search
 * yields a bare /results/[id] and only non-default filters appear in the URL.
 * This is safe because SearchInitializer detects params via
 * `searchParams.toString() !== ''` (not by assuming `q` is always present) and
 * creates a new entry for a missing/unknown id — see resolveSearchInit. It also
 * matches nuqs v2's default clearOnDefault used by the live provider, so
 * initializer-built URLs and live filter updates stay consistent.
 */
export const serializeSearchParams = createSerializer(searchParamsParsers, {
  clearOnDefault: true,
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
  area: [],
  sdg: [],
  oa: false,
  type: [],
  wlang: [],
  itype: [],
  funder: [],
  mincite: null,
  abs: false,
  retracted: false,
  lang: null,
};
