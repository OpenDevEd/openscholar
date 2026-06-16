/**
 * Extraction module namespace marker.
 *
 * This file exists so Convex's bundler recognises the directory as a
 * module, but it deliberately re-exports nothing. The public surface is
 * whatever the per-file registrations provide:
 *
 *   - UI / public API:
 *       api.extraction.mutations.*   (convex/extraction/mutations.ts)
 *       api.extraction.queries.*     (convex/extraction/queries.ts)
 *       api.extraction.uploads.*     (convex/extraction/uploads.ts)
 *
 *   - Internal (queue / workpool contract):
 *       internal.extraction.actions.*
 *       internal.extraction.mutations.*  (the *internal* functions)
 *       internal.extraction.queries.*    (the *Internal functions)
 *       internal.extraction.workpoolActions.*
 *
 *   - Dev-only (gated by assertNonProd at each handler):
 *       internal.extraction.debug.*
 *       internal.extraction.debug_*.*
 *       internal.extraction.tests.fixtures.*
 *       internal.extraction.tests.runners.*
 *
 * Types live in per-file modules (e.g. `convex/extraction/types.ts`) and
 * are imported directly from there — no barrel re-export needed.
 */

export {};
