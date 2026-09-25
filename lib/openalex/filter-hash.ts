/**
 * Deterministic, filter-only hash for an OpenAlex search shape.
 *
 * Two entries that would produce the same OpenAlex Works request must
 * hash identically — the hash drives the SWR cache key for
 * `useHistoryCount`, so hash collisions between "same query, different
 * history entry" are the whole point (toggle one row, no refetch needed
 * for the neighbour with the same filters).
 *
 * Everything is hashed except bookkeeping that never changes the request
 * (identifiers, timestamps, stored counts, screening state, query
 * history), so a new filter can never be left out of the key.
 *
 * String arrays (regions, research areas, languages…) are sorted before
 * hashing, as their order has no meaning; empty values are equivalent to
 * absent ones. Dates are normalised to `YYYY-MM-DD` strings.
 */

/** History entry fields that never change which works a search returns. */
const IGNORE = new Set([
  "id",
  "count",
  "createdAt",
  "updatedAt",
  "page",
  "queryHistory",
  "questionHistory",
  "screeningQuestions",
  "screeningResponses",
  "chatJobIdsByAccountId",
]);

function isoDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().split("T")[0];
  if (typeof value === "string") {
    return value.includes("T") ? value.split("T")[0] : value;
  }
  return null;
}

function canonicalise(input: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (IGNORE.has(key) || value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      out[key] = value.every((item) => typeof item === "string") ? [...value].sort() : value;
      continue;
    }
    if (key === "dateRange") {
      const range = value as { from?: unknown; to?: unknown };
      const from = isoDate(range.from);
      const to = isoDate(range.to);
      if (from || to) out[key] = { from, to };
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

export function hashSearchFilters(input: object): string {
  const canon = canonicalise(input);
  const json = stableStringify(canon);
  return cyrb53(json).toString(16);
}
