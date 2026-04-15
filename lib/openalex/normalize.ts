/**
 * Normalize an OpenAlex work ID to its canonical W\d+ form.
 *
 * Handles:
 *   - Bare ID: "W123456789"
 *   - Full URL: "https://openalex.org/W123456789" (with optional query params/fragments)
 *   - Prefixed: "openalex:W123456789"
 *
 * Pure function -- works in both client and server contexts.
 *
 * @param input - Raw OpenAlex ID string in any supported format
 * @returns Canonical "W\d+" string, or null if input is not a valid OpenAlex work ID
 */
export function normalizeOpenAlexId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Match W followed by digits, preceded by optional URL or prefix
  const match = trimmed.match(
    /^(?:https?:\/\/openalex\.org\/)?(?:openalex:)?(W\d+)/i,
  );
  if (!match) return null;

  // Uppercase W for canonical form
  return match[1].toUpperCase();
}
