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
import { isValid, parseISO } from 'date-fns';
import { MIN_YEAR } from '../constants';
import { SEARCH_FIELDS } from '../types/search.types';
import { encodeRegions, decodeRegions } from './regions';
import { authorFilterValue } from '../openalex/author-filter';
import { institutionId, sourceId, workId } from '../openalex/ids';
import { sortOptions } from '../constants';

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
 * - author: OpenAlex author ids, or author names OpenAlex has no record for
 * - journal: OpenAlex source ids, the paper's main venue
 * - inst: OpenAlex institution ids, child institutions included
 * - design: study designs
 * - top10: only papers in the top 10% of their field by citations
 * - venue: only papers in a journal, conference or book series
 * - mincite: minimum number of citations
 * - abs: only works with an abstract
 * - retracted: include retracted works, which are left out by default
 * - lang: language filter
 */
const searchDate = (value: string) => (isValid(parseISO(value)) ? value : null);
const parseAsSearchDate = createParser({ parse: searchDate, serialize: String });
const parseAsAuthor = createParser({ parse: authorFilterValue, serialize: String });
const parseAsSource = createParser({ parse: (value) => sourceId(value) ?? null, serialize: String });
const parseAsInstitution = createParser({ parse: (value) => institutionId(value) ?? null, serialize: String });
const parseAsWork = createParser({ parse: (value) => workId(value) ?? null, serialize: String });
// Not dropped when it isn't an ID: leaving it out would turn a similar search into a search of everything, so the search says it can't read it.
const similarSeed = (value: string) => workId(value) ?? value.trim().slice(0, 100);
const parseAsSeed = createParser({ parse: (value) => similarSeed(value) || null, serialize: String });

export const searchParamsParsers = {
  // Core search
  q: parseAsString.withDefault(''),
  field: parseAsString.withDefault('title_and_abstract'),
  // Papers a search finds the closest to by meaning, on our index.
  like: parseAsArrayOf(parseAsSeed).withDefault([]),
  // An order the page doesn't offer, from a hand-typed address, reads as the default instead of failing the search.
  sort: createParser({ parse: (value: string) => (sortOptions.some((option) => option.value === value) ? value : null), serialize: String }).withDefault('relevance_score:desc'),
  
  // Pagination
  page: parseAsInteger.withDefault(1),
  
  // Year filter
  yf: parseAsInteger, // yearFrom
  yt: parseAsInteger, // yearTo
  
  // Date filter (ISO strings)
  df: parseAsSearchDate, // dateFrom
  dt: parseAsSearchDate, // dateTo
  ft: parseAsString.withDefault('year'), // filterType: 'year' | 'date'
  
  // Rating filter (client-side)
  rmin: parseAsInteger.withDefault(0),
  rmax: parseAsInteger.withDefault(5),
  rated: parseAsBoolean.withDefault(false),
  
  // Geographic filters (smart encoded)
  reg: parseAsRegions.withDefault([]),
  focus: parseAsRegions.withDefault([]),
  
  // Reference filters
  cites: parseAsWork.withDefault(''),
  citedBy: parseAsWork.withDefault(''),
  rel: parseAsWork.withDefault(''), // relatedTo
  
  // Content filters
  review: parseAsBoolean.withDefault(false),
  area: parseAsArrayOf(parseAsString).withDefault([]),
  sdg: parseAsArrayOf(parseAsString).withDefault([]),
  oa: parseAsBoolean.withDefault(false),
  type: parseAsArrayOf(parseAsString).withDefault([]),
  wlang: parseAsArrayOf(parseAsString).withDefault([]),
  itype: parseAsArrayOf(parseAsString).withDefault([]),
  funder: parseAsArrayOf(parseAsString).withDefault([]),
  author: parseAsArrayOf(parseAsAuthor).withDefault([]),
  journal: parseAsArrayOf(parseAsSource).withDefault([]),
  inst: parseAsArrayOf(parseAsInstitution).withDefault([]),
  design: parseAsArrayOf(parseAsString).withDefault([]),
  top10: parseAsBoolean.withDefault(false),
  venue: parseAsBoolean.withDefault(false),
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
  like: string[];
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
  author: string[];
  journal: string[];
  inst: string[];
  design: string[];
  top10: boolean;
  venue: boolean;
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

/** The two ends of a range, lowest first. */
function inOrder<T extends number | null>(from: T, to: T): [T, T] {
  return from !== null && to !== null && from > to ? [to, from] : [from, to];
}

/** A year as the year picker takes it: within the years a search can name. */
function parseYearParam(searchParams: URLSearchParams, key: string): number | null {
  const year = parseIntegerParam(searchParams, key, null);
  return year === null ? null : Math.min(new Date().getFullYear(), Math.max(MIN_YEAR, year));
}

/**
 * Parse URLSearchParams into ParsedSearchParams using the module defaults.
 * Unknown query params are ignored, and malformed numeric params fall back to
 * their defaults rather than becoming NaN.
 *
 * An address is anyone's to type, and the server refuses a search it can't hold, so a value
 * no search can have becomes the nearest one that can, or is dropped.
 */
export function parseSearchParamsFromUrl(
  searchParams: URLSearchParams
): ParsedSearchParams {
  const field = searchParams.get('field');
  const [yf, yt] = inOrder(parseYearParam(searchParams, 'yf'), parseYearParam(searchParams, 'yt'));
  const [rmin, rmax] = inOrder(
    parseIntegerParam(searchParams, 'rmin', DEFAULT_SEARCH_PARAMS.rmin) ?? DEFAULT_SEARCH_PARAMS.rmin,
    parseIntegerParam(searchParams, 'rmax', DEFAULT_SEARCH_PARAMS.rmax) ?? DEFAULT_SEARCH_PARAMS.rmax,
  );
  return {
    q: searchParams.get('q') ?? DEFAULT_SEARCH_PARAMS.q,
    field: field !== null && SEARCH_FIELDS.some(({ value }) => value === field) ? field : DEFAULT_SEARCH_PARAMS.field,
    like: parseListParam(searchParams, 'like').map(similarSeed).filter(Boolean),
    sort: sortOptions.find(({ value }) => value === searchParams.get('sort'))?.value ?? DEFAULT_SEARCH_PARAMS.sort,
    page:
      parseIntegerParam(searchParams, 'page', DEFAULT_SEARCH_PARAMS.page) ??
      DEFAULT_SEARCH_PARAMS.page,
    yf,
    yt,
    df: searchDate(searchParams.get('df') ?? ''),
    dt: searchDate(searchParams.get('dt') ?? ''),
    ft: searchParams.get('ft') === 'date' ? 'date' : DEFAULT_SEARCH_PARAMS.ft,
    rmin,
    rmax,
    rated: searchParams.get('rated') === 'true',
    reg: searchParams.has('reg') ? decodeRegions(searchParams.get('reg') || '') : [],
    focus: searchParams.has('focus') ? decodeRegions(searchParams.get('focus') || '') : [],
    cites: workId(searchParams.get('cites') ?? '') ?? DEFAULT_SEARCH_PARAMS.cites,
    citedBy: workId(searchParams.get('citedBy') ?? '') ?? DEFAULT_SEARCH_PARAMS.citedBy,
    rel: workId(searchParams.get('rel') ?? '') ?? DEFAULT_SEARCH_PARAMS.rel,
    review: searchParams.get('review') === 'true',
    area: parseListParam(searchParams, 'area'),
    sdg: parseListParam(searchParams, 'sdg'),
    oa: searchParams.get('oa') === 'true',
    type: parseListParam(searchParams, 'type'),
    wlang: parseListParam(searchParams, 'wlang'),
    itype: parseListParam(searchParams, 'itype'),
    funder: parseListParam(searchParams, 'funder'),
    author: parseListParam(searchParams, 'author').map(authorFilterValue).filter((author) => author !== null),
    journal: parseListParam(searchParams, 'journal').map(sourceId).filter((id) => id !== undefined),
    inst: parseListParam(searchParams, 'inst').map(institutionId).filter((id) => id !== undefined),
    design: parseListParam(searchParams, 'design'),
    top10: searchParams.get('top10') === 'true',
    venue: searchParams.get('venue') === 'true',
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
  like: [],
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
  author: [],
  journal: [],
  inst: [],
  design: [],
  top10: false,
  venue: false,
  mincite: null,
  abs: false,
  retracted: false,
  lang: null,
};
