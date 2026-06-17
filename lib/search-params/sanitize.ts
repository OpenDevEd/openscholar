/**
 * Clean a multi-select selection (region / country codes) before it is synced
 * to the URL or persisted to history: trim surrounding whitespace and drop
 * empty / whitespace-only entries. This keeps stray `"  "`/`""` values out of
 * search state and out of query strings.
 *
 * Sanitize only — it does NOT dedup or validate against an allowlist, so order
 * and repeats are preserved.
 */
export function sanitizeSelection(values?: string[]): string[] {
  if (!values || values.length === 0) {
    return [];
  }
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
