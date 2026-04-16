# Phase 100: Backend Wiring + TierSelector Fix - Context

**Gathered:** 2026-04-15
**Updated:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship all the Convex actions and server-side hard rejects that Phases 102, 103, and 104 will consume — including the 5-edit fix that finally threads `TierSelector` through `createExtractionJob` -> workpool -> `createCascadeTiers(tier)`. Also create the `convex/openalex/actions.ts` module with `resolveManualIds` and `resolveByDoi` actions.

Requirements: SEL-05 (resolveManualIds), LIM-07 (server-side hard reject), TIER-01 (tier persisted on job row), TIER-02 (workpool reads tier and filters cascade), TIER-03 (unit test for cascade filtering), ZOT-03 (resolveByDoi action).

</domain>

<decisions>
## Implementation Decisions

### Tier Field Schema Design
- **D-01:** Add an optional `tier` field to the `extractionJobs` table in `convex/schema.ts`: `tier: v.optional(v.union(v.literal("auto"), v.literal("cheap"), v.literal("accurate")))`. No migration — existing rows remain `undefined` and null-coalesce to `"auto"` at read time. The `ModelTier` type from `components/extraction/tier-selector.tsx` is reused as the canonical type.
- **D-02:** The `createExtractionJob` mutation in `convex/extraction/mutations.ts` accepts a new optional `tier` arg (defaults to `"auto"` if omitted) and persists it on the job row. The ExtractionDialog passes its existing `tier` state to the mutation call.

### Cascade Filtering Logic
- **D-03:** Modify `createCascadeTiers()` in `convex/extraction/extract.ts` to accept an optional `tier?: ModelTier` parameter. Behavior: `"auto"` (or undefined) returns all 3 tiers unchanged; `"accurate"` returns only the top tier (last element — highest-quality model); `"cheap"` returns only the bottom tier (first element — cheapest model). The function signature changes from `createCascadeTiers()` to `createCascadeTiers(tier?: ModelTier)`.
- **D-04:** The workpool action (`extractSingleAnswer` or its caller) reads `tier` from the job row via the existing job lookup and passes it to `createCascadeTiers(tier)`. This is the threading path: ExtractionDialog -> mutation (persists tier) -> workpool (reads tier from job) -> `createCascadeTiers(tier)` (filters cascade).

### Tier Field Nullability Semantics
- **D-05:** Existing extraction jobs without a `tier` field (pre-Phase-100 rows) null-coalesce to `"auto"` at read time in the workpool action — `const tier = job.tier ?? "auto"`. No migration, no backfill. The schema field is `v.optional(...)` permanently; write-path always sets `tier` explicitly from Phase 100 onward.

### OpenAlex Action Boundaries
- **D-06:** Create a new `convex/openalex/actions.ts` module with two separate Convex actions:
  - `resolveManualIds` — Accepts an array of raw user-pasted strings (one per line), normalizes each via the same `W\d+` pattern as `normalizeOpenAlexId`, validates they exist by calling the OpenAlex API in batch (`https://api.openalex.org/works?filter=openalex_id:{id1}|{id2}|...`), and returns an array of resolved paper metadata (title, DOI, OpenAlex ID) plus an array of unresolvable IDs. This is consumed by the Manual IDs tab (SEL-05).
  - `resolveByDoi` — Accepts a single DOI string, calls the OpenAlex API (`https://api.openalex.org/works?filter=doi:{doi}`), and returns the resolved OpenAlex ID + paper metadata or null if not found. This is consumed by the Zotero tab (ZOT-03) for lazy DOI-to-OpenAlex resolution.
- **D-07:** Both actions use Convex `action` (not `mutation`) since they call external HTTP APIs. They use the existing `OPENALEX_CONTACT_EMAIL` env var for the polite pool User-Agent header. Rate limiting follows OpenAlex's documented 10 req/s polite pool allowance.

### OpenAlex Batch Strategy
- **D-08:** `resolveManualIds` batches IDs in groups of 50 per request using the pipe-delimited filter syntax (`openalex_id:W123|W456|...`). This keeps URLs well under the ~4000 character limit. Each batch is a separate `fetch()` call within the same Convex action. Failed batches are collected and returned in the `unresolvable` array — the action does not throw on partial failures.

### Action Timeout & Retry
- **D-09:** `resolveByDoi` uses an `AbortController` with an 8-second timeout on the fetch call, leaving 2 seconds of buffer for Convex action overhead to meet the ZOT-03 10-second requirement. No retry on timeout — return `null` and let the UI show the failure state. `resolveManualIds` uses a 30-second total action timeout (Convex default) with per-batch 8-second timeouts.

### Error Routing Pattern
- **D-10:** Add `EXTRACTION_LIMIT_EXCEEDED` to the `ErrorCode` union in `convex/lib/errors.ts`. The `createExtractionJob` mutation throws `createError("EXTRACTION_LIMIT_EXCEEDED", ...)` with a message that includes the user's limit and the attempted count.
- **D-11:** The `EXTRACTION_LIMIT_EXCEEDED` error data payload includes `{ limit: number, attempted: number, excess: number }` so the toast can display "You can extract up to {limit} papers per job. Remove {excess} papers to continue." The `limit` comes from `getExtractionLimitForUser(ctx)` (Phase 98 output), not a hardcoded value.
- **D-12:** Map `EXTRACTION_LIMIT_EXCEEDED` in `lib/toast/error-resolver.ts`'s `MESSAGE_KEY_BY_CODE` to a new `ToastErrorMessageKey`. Add corresponding i18n keys in all 6 locale files with a user-friendly message.
- **D-13:** Fix the existing inline string-matching for `EXTRACTION_JOB_ALREADY_ACTIVE` in `extraction-dialog.tsx` (line ~137-147) to route through the standard `resolveToastError` resolver instead — aligns the whole extraction error surface with a single pattern.

### Claude's Discretion
- Internal naming for helper functions within the OpenAlex actions module
- Exact error message wording for `EXTRACTION_LIMIT_EXCEEDED` across 6 locales
- Whether to add a `convex/openalex/` directory index file or keep it flat
- Test file organization for the new actions and cascade filtering

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### TierSelector & ExtractionDialog
- `components/extraction/tier-selector.tsx` — `ModelTier` type export (line 12) and `TierSelector` component; value/onChange controlled pattern
- `components/extraction/extraction-dialog.tsx` — Lines 58 (tier state), 125 (createJob call missing tier), 131 (PostHog captures tier), 216 (TierSelector render). The 5-edit fix threads tier from here to the backend.

### Extraction Mutations & Workpool
- `convex/extraction/mutations.ts` — `createExtractionJob` at line 32; args validator, paper count validation, job row insert. Must add `tier` to args and insert.
- `convex/extraction/extract.ts` — `createCascadeTiers()` at line 187-213 (hardcoded 3-tier array); `extractSingleAnswer` at line 227 (calls createCascadeTiers). Must accept tier param and filter.

### Schema
- `convex/schema.ts` — `extractionJobs` table definition at line 410. Must add optional `tier` field.

### Error System
- `convex/lib/errors.ts` — `createError` factory, `ErrorCode` union (line 3). Must add `EXTRACTION_LIMIT_EXCEEDED`.
- `lib/toast/error-resolver.ts` — `MESSAGE_KEY_BY_CODE` mapping (line 63), `resolveToastError` function (line 216). Must map new error code.

### Limit System (Phase 98 output)
- `convex/lib/queryBounds.ts` — `EXTRACTION_LIMITS_BY_TIER` (line 24), `MAX_EXTRACTION_PAPERS_PER_JOB` (line 35), `getExtractionLimitForUser`

### OpenAlex API
- `lib/openalex.ts` — Existing OpenAlex SDK client; `OPENALEX_CONTACT_EMAIL` env var usage pattern
- `lib/openalex/normalize.ts` — `normalizeOpenAlexId` utility (Phase 99 output) for ID normalization

### Convex Guidelines
- `convex/_generated/ai/guidelines.md` — Convex API patterns and conventions (MUST read before writing any Convex code)

### Prior Phase Context
- `.planning/phases/98-pre-flight-hard-limit-foundation/98-CONTEXT.md` — Limit constant architecture decisions
- `.planning/phases/99-selection-basket-core/99-CONTEXT.md` — Basket store and normalizeOpenAlexId decisions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `components/extraction/tier-selector.tsx` — `ModelTier` type already defined (line 12); reuse as the canonical tier type across frontend and backend
- `convex/lib/errors.ts` — `createError` factory for typed ConvexErrors; extend with `EXTRACTION_LIMIT_EXCEEDED`
- `lib/toast/error-resolver.ts` — `resolveToastError` + `MESSAGE_KEY_BY_CODE` pattern; extend for new error code
- `lib/openalex.ts` — OpenAlex API client with polite pool User-Agent; reuse for `resolveByDoi` and `resolveManualIds`
- `convex/lib/queryBounds.ts` — `getExtractionLimitForUser(ctx)` helper from Phase 98; used in `createExtractionJob` for the hard-reject check
- `lib/openalex/normalize.ts` — `normalizeOpenAlexId` utility from Phase 99; reuse server-side in `resolveManualIds`

### Established Patterns
- Convex actions use `"use node"` directive for external HTTP calls
- Error codes are members of a discriminated `ErrorCode` union in `convex/lib/errors.ts`
- Toast error routing: backend throws typed `ConvexError` -> client catches in `resolveToastError` -> maps code to i18n key -> renders localized toast
- ExtractionDialog currently catches errors inline with string matching (line ~137-147) — this should be migrated to `resolveToastError`
- OpenAlex API calls use `OPENALEX_CONTACT_EMAIL` env var in User-Agent header for polite pool access

### Integration Points
- `extraction-dialog.tsx` line 125 — The `createJob` call must pass `tier` to the mutation
- `extract.ts` line 227 — `extractSingleAnswer` must read tier from the job row and pass to `createCascadeTiers`
- `convex/extraction/mutations.ts` workpool enqueue — Must include tier in the job row so the workpool can read it
- Phase 102 will mount `<AddToExtractionButton>` that calls `resolveManualIds` for the Manual tab
- Phase 104 will use `resolveByDoi` for Zotero DOI-to-OpenAlex resolution

</code_context>

<specifics>
## Specific Ideas

- The "5-edit TierSelector fix" path is: (1) add `tier` to schema, (2) add `tier` to mutation args, (3) persist `tier` on job insert, (4) read `tier` in workpool and pass to `createCascadeTiers`, (5) filter cascade array based on tier. This is the smallest possible change set.
- `resolveManualIds` must handle mixed-format input gracefully — users may paste URLs, bare IDs, or prefixed IDs in the same batch. Normalize all inputs before the batch API call.
- `resolveByDoi` must return within 10 seconds (ZOT-03 requirement) — 8-second AbortController timeout on fetch with 2-second buffer for Convex overhead.
- The `EXTRACTION_LIMIT_EXCEEDED` error must include the user's specific limit (from `getExtractionLimitForUser`) in the error data so the toast can show "up to {limit} papers" — not a hardcoded "1000".
- The inline error handling in `extraction-dialog.tsx` (string matching for `EXTRACTION_JOB_ALREADY_ACTIVE`) should be cleaned up to use `resolveToastError` — this is a small hygiene fix that aligns all extraction errors with the standard pattern.
- OpenAlex batch calls use pipe-delimited filter syntax with 50 IDs per batch to stay within URL length limits.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 100-backend-wiring-tierselector-fix*
*Context gathered: 2026-04-15*
*Context updated: 2026-04-16 (auto-mode refresh with codebase verification)*
