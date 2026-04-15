# Phase 100: Backend Wiring + TierSelector Fix - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 100-backend-wiring-tierselector-fix
**Areas discussed:** Tier field schema design, Cascade filtering logic, OpenAlex action boundaries, Error routing pattern
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

## Claude's Discretion

- Internal naming for OpenAlex action helpers
- Batch size for OpenAlex API calls in resolveManualIds
- Exact i18n wording for EXTRACTION_LIMIT_EXCEEDED across 6 locales
- Test file organization
- Whether to add directory index file for convex/openalex/

## Deferred Ideas

None — discussion stayed within phase scope.
