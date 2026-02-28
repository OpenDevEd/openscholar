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
import { subWeeks, subMonths, subYears } from "date-fns";

// Const arrays (used by parseAsStringLiteral and exported for downstream use)

export const librarySortValues = ["savedAt", "rating", "publicationYear"] as const;
export const librarySortOrderValues = ["asc", "desc"] as const;
export const librarySavedPresets = ["week", "month", "year"] as const;
export const libraryViewModes = ["list", "grid"] as const;

// Type exports derived from const arrays

export type LibrarySortBy = (typeof librarySortValues)[number];
export type LibrarySortOrder = (typeof librarySortOrderValues)[number];
export type LibrarySavedPreset = (typeof librarySavedPresets)[number];
export type LibraryViewMode = (typeof libraryViewModes)[number];

/**
 * Parser map for all library URL state parameters.
 *
 * Short param names for compact URLs:
 * - q: search text
 * - sort: sort field
 * - order: sort direction
 * - rating: minimum rating filter
 * - saved: date saved preset
 * - yf/yt: year from/to
 * - view: view mode
 */
export const librarySearchParams = {
  q: parseAsString.withDefault(""),
  sort: parseAsStringLiteral(librarySortValues).withDefault("savedAt"),
  order: parseAsStringLiteral(librarySortOrderValues).withDefault("desc"),
  rating: parseAsInteger,
  saved: parseAsStringLiteral(librarySavedPresets),
  yf: parseAsInteger,
  yt: parseAsInteger,
  view: parseAsStringLiteral(libraryViewModes).withDefault("list"),
};

/**
 * Convert a saved-date preset string to a Unix timestamp threshold.
 * Returns undefined if preset is null or unrecognized.
 */
export function savedPresetToTimestamp(
  preset: string | null,
): number | undefined {
  if (!preset) return undefined;
  const now = new Date();
  switch (preset) {
    case "week":
      return subWeeks(now, 1).getTime();
    case "month":
      return subMonths(now, 1).getTime();
    case "year":
      return subYears(now, 1).getTime();
    default:
      return undefined;
  }
}
