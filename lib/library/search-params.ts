/**
 * Library URL Search Params Parsers
 *
 * Defines nuqs parsers for all library page URL state parameters.
 * These parsers handle serialization/deserialization of filter, sort,
 * search, and view mode state in the URL query string.
 */

import {
  parseAsString,
  parseAsInteger,
  parseAsStringLiteral,
} from "nuqs";

// Const arrays (used by parseAsStringLiteral and exported for downstream use)

export const librarySortValues = [
  "savedAt",
  "rating",
  "publicationYear",
  "citedByCount",
  "title",
] as const;
export const librarySortOrderValues = ["asc", "desc"] as const;
export const libraryViewModes = ["list", "grid"] as const;

// Type exports derived from const arrays

export type LibrarySortBy = (typeof librarySortValues)[number];
export type LibrarySortOrder = (typeof librarySortOrderValues)[number];
export type LibraryViewMode = (typeof libraryViewModes)[number];

/**
 * Parser map for all library URL state parameters.
 *
 * Short param names for compact URLs:
 * - q: search text
 * - sort: sort field
 * - order: sort direction
 * - rmin/rmax: rating range
 * - sf/st: saved-from / saved-to local dates (YYYY-MM-DD)
 * - yf/yt: year from/to
 * - view: view mode
 */
export const librarySearchParams = {
  q: parseAsString.withDefault(""),
  sort: parseAsStringLiteral(librarySortValues).withDefault("savedAt"),
  order: parseAsStringLiteral(librarySortOrderValues).withDefault("desc"),
  rmin: parseAsInteger,
  rmax: parseAsInteger,
  sf: parseAsString,
  st: parseAsString,
  yf: parseAsInteger,
  yt: parseAsInteger,
  view: parseAsStringLiteral(libraryViewModes).withDefault("list"),
  col: parseAsString, // Collection ID filter (null = all collections)
  p: parseAsInteger.withDefault(1), // Page number for pagination
};

/**
 * Serialize a Date into a local YYYY-MM-DD string for URL params.
 */
export function dateToParam(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parse a local YYYY-MM-DD date param into a Date.
 * Returns undefined for invalid or missing values.
 */
export function parseDateParam(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);

  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return undefined;
  }

  return new Date(year, month - 1, day);
}

/**
 * Convert a local YYYY-MM-DD date param into the inclusive start-of-day timestamp.
 */
export function startOfDayTimestampFromParam(
  value: string | null | undefined,
): number | undefined {
  const date = parseDateParam(value);
  if (!date) return undefined;
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0,
  ).getTime();
}

/**
 * Convert a local YYYY-MM-DD date param into the inclusive end-of-day timestamp.
 */
export function endOfDayTimestampFromParam(
  value: string | null | undefined,
): number | undefined {
  const date = parseDateParam(value);
  if (!date) return undefined;
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  ).getTime();
}
