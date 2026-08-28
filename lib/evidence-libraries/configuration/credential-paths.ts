import { jsonPointerPatternMatches } from "./json-pointer";
import { WRITE_ONLY_POINTER_PATTERNS } from "./section-registry";

/**
 * Where credentials live. Kept apart from the Convex functions that use them
 * so the page can name a credential row without pulling the backend into the
 * browser bundle.
 */

/** The write-only pattern a concrete pointer belongs to, or null. */
export function writeOnlyPatternFor(concretePath: string): string | null {
  return (
    WRITE_ONLY_POINTER_PATTERNS.find((pattern) =>
      jsonPointerPatternMatches(pattern, concretePath),
    ) ?? null
  );
}

/**
 * The key of the credential row: the write-only pattern, and the instance it
 * belongs to when one pattern covers several rows (a Zotero group, an AI
 * provider).
 */
export function credentialKeyFor(
  pathPattern: string,
  instanceKey?: string,
): string {
  return instanceKey ? `${pathPattern}:${instanceKey}` : pathPattern;
}
