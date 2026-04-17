/**
 * Deterministic, filter-only hash for an OpenAlex search shape.
 *
 * Two entries that would produce the same OpenAlex Works request must
 * hash identically — the hash drives the SWR cache key for
 * `useHistoryCount`, so hash collisions between "same query, different
 * history entry" are the whole point (toggle one row, no refetch needed
 * for the neighbour with the same filters).
 *
 * Only fields that feed the wire request are read. Identifiers,
 * timestamps, stored counts, screening state, and query history are
 * deliberately excluded — they must never split the cache.
 *
 * Array-valued inputs where order has no semantic meaning (regions,
 * country focus) are sorted before hashing; empty arrays are equivalent
 * to absent values. Dates are normalised to `YYYY-MM-DD` strings.
 */

export type HashableSearchInput = Partial<{
  query: string;
  field: string;
  sortBy: string;
  filterType: string;
  isYearRangeEnabled: boolean;
  yearRange: readonly [number, number] | number[];
  dateRange: {
    from?: Date | string | null;
    to?: Date | string | null;
  } | null;
  selectedRegions: readonly string[];
  selectedCountryFocus: readonly string[];
  ratingRange: readonly [number, number] | number[];
  onlyRatedPapers: boolean;
  citesItemId: string;
  citedByItemId: string;
  relatedToItemId: string;
  reviewFilter: boolean;
  language: string;
}>;

const ALLOW = [
  "query",
  "field",
  "sortBy",
  "filterType",
  "isYearRangeEnabled",
  "yearRange",
  "dateRange",
  "selectedRegions",
  "selectedCountryFocus",
  "ratingRange",
  "onlyRatedPapers",
  "citesItemId",
  "citedByItemId",
  "relatedToItemId",
  "reviewFilter",
  "language",
] as const;

type AllowKey = (typeof ALLOW)[number];

function isoDate(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().split("T")[0];
  if (typeof value === "string") {
    return value.includes("T") ? value.split("T")[0] : value;
  }
  return null;
}

function canonicalise(input: HashableSearchInput): Record<string, unknown> {
  const raw = input as Record<AllowKey, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ALLOW) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value === "") continue;

    if (key === "selectedRegions" || key === "selectedCountryFocus") {
      const list = value as readonly string[];
      if (list.length === 0) continue;
      out[key] = [...list].sort();
      continue;
    }

    if (key === "dateRange") {
      const dr = value as {
        from?: Date | string | null;
        to?: Date | string | null;
      };
      const from = isoDate(dr.from);
      const to = isoDate(dr.to);
      if (!from && !to) continue;
      out[key] = { from, to };
      continue;
    }

    out[key] = value;
  }
  return out;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
      .join(",") +
    "}"
  );
}

// cyrb53 — Bryc's 53-bit non-cryptographic hash. Drop-in good-enough
// cache key generator; collision probability at our scale is negligible.
// https://stackoverflow.com/a/52171480
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function hashSearchFilters(input: HashableSearchInput): string {
  const canon = canonicalise(input);
  const json = stableStringify(canon);
  return cyrb53(json).toString(16);
}
