# Phase 100: Backend Wiring + TierSelector Fix - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 100-backend-wiring-tierselector-fix
**Areas discussed:** Tier field schema design, Cascade filtering logic, OpenAlex action boundaries, Error routing pattern, OpenAlex batch strategy, Tier field nullability semantics, Error data payload shape, Action timeout & retry
**Mode:** --auto (all decisions auto-selected with recommended defaults)

---

## Tier Field Schema Design

| Option | Description | Selected |
|--------|-------------|----------|
| Optional field, null-coalesces to "auto" | Add `tier: v.optional(v.union(...))` to schema, no migration, existing rows coalesce to "auto" | ✓ |
| Required field with migration | Add required `tier` field, migrate all existing rows to "auto" | |
| Separate tier table | Store tier preferences in a separate table linked to jobs | |

**User's choice:** [auto] Optional field, null-coalesces to "auto" (recommended default)
**Notes:** Roadmap explicitly states "new rows only; legacy rows null-coalesce to auto" and "Anti-feature to NOT ship: migration of existing v6.0 extraction jobs to the new tier field". This is the only correct choice.

---

## Cascade Filtering Logic

| Option | Description | Selected |
|--------|-------------|----------|
| Accept tier param, filter in-place | Modify `createCascadeTiers(tier?)` to return filtered array based on tier value | ✓ |
| Separate function per tier | Create `createAccurateTier()`, `createCheapTier()`, `createAutoTiers()` | |
| Config-driven tier mapping | External config object mapping tier names to model lists | |

**User's choice:** [auto] Accept tier param, filter in-place (recommended default)
**Notes:** Simplest change — one parameter addition to an existing function. Matches TIER-02 requirement exactly: "auto = all 3 tiers, accurate = top tier only, cheap = bottom tier only".

---

## OpenAlex Action Boundaries

| Option | Description | Selected |
|--------|-------------|----------|
| Separate actions in convex/openalex/actions.ts | Two distinct Convex actions: `resolveManualIds` (batch) and `resolveByDoi` (single) | ✓ |
| Combined resolve action | Single `resolveOpenAlexIds` action that handles both DOIs and OpenAlex IDs | |
| Client-side resolution | Resolve IDs on the client and pass normalized results to the backend | |

**User's choice:** [auto] Separate actions (recommended default)
**Notes:** Different call patterns (batch array vs single DOI), different consumers (Manual tab SEL-05 vs Zotero tab ZOT-03), different error modes. Keeping them separate follows single-responsibility principle.

---

## Error Routing Pattern

| Option | Description | Selected |
|--------|-------------|----------|
| Add error code + map in error-resolver.ts | Standard pattern: ErrorCode union + MESSAGE_KEY_BY_CODE mapping + i18n keys | ✓ |
| Inline error handling in dialog | Match error strings directly in the dialog catch block (existing anti-pattern) | |
| Custom error boundary | React error boundary that catches extraction-specific ConvexErrors | |

**User's choice:** [auto] Add error code + map in error-resolver.ts (recommended default)
**Notes:** Follows the established `convex/lib/errors.ts` + `lib/toast/error-resolver.ts` pattern. Also includes cleanup of the existing inline string-matching for `EXTRACTION_JOB_ALREADY_ACTIVE` in the dialog.

---

## OpenAlex Batch Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Batch of 50 IDs per request | Pipe-delimited filter syntax, stays under URL length limits | ✓ |
| Batch of 25 IDs per request | More conservative, more round-trips | |
| Single ID per request | Simplest but slowest, 1000 requests for max batch | |

**User's choice:** [auto] Batch of 50 IDs per request with pipe-delimited filter (recommended default)
**Notes:** Keeps URLs well under ~4000 char limit. Failed batches collected in unresolvable array — action does not throw on partial failures.

---

## Tier Field Nullability Semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Null-coalesce to "auto" at read time | No migration, existing behavior preserved, workpool reads `job.tier ?? "auto"` | ✓ |
| Write default on insert | Backfill existing rows via migration | |
| Required field with migration | Breaking change, requires two-deploy migration | |

**User's choice:** [auto] Null-coalesce to "auto" at read time in workpool action (recommended default)
**Notes:** Schema field stays `v.optional(...)` permanently. Write-path always sets `tier` explicitly from Phase 100 onward.

---

## Error Data Payload Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Include limit, attempted, and excess | Toast shows user-specific limit from getExtractionLimitForUser | ✓ |
| Include only message string | Simpler but no dynamic data for i18n interpolation | |
| Include limit only | Missing context about how many the user tried to submit | |

**User's choice:** [auto] Include limit, attempted, and excess in error data object (recommended default)
**Notes:** The `limit` value comes from `getExtractionLimitForUser(ctx)`, not hardcoded. Enables toast: "You can extract up to {limit} papers per job. Remove {excess} papers to continue."

---

## Action Timeout & Retry

| Option | Description | Selected |
|--------|-------------|----------|
| 8-second AbortController, no retry | Leaves 2s buffer for Convex overhead, meets ZOT-03 10s requirement | ✓ |
| 5-second timeout with 1 retry | Faster fail but retry adds latency budget | |
| No explicit timeout (Convex default) | Relies on Convex 30s action timeout, may exceed ZOT-03 | |

**User's choice:** [auto] AbortController with 8-second timeout on fetch, no retry (recommended default)
**Notes:** `resolveByDoi` returns `null` on timeout — UI shows failure state. `resolveManualIds` uses per-batch 8s timeouts within the 30s Convex action budget.

---

## Claude's Discretion

- Internal naming for OpenAlex action helpers
- Batch size for OpenAlex API calls in resolveManualIds (decided: 50 per batch)
- Exact i18n wording for EXTRACTION_LIMIT_EXCEEDED across 6 locales
- Test file organization
- Whether to add directory index file for convex/openalex/

## Deferred Ideas

None — discussion stayed within phase scope.
