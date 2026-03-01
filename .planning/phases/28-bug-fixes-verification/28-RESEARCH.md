# Phase 28: Bug Fixes & Verification - Research

**Researched:** 2026-03-01
**Domain:** Integration bug fix, verification gap closure, traceability correction
**Confidence:** HIGH

## Summary

Phase 28 addresses three discrete issues identified by the v2.1 milestone audit (`v2.1-MILESTONE-AUDIT.md`): (1) a focus-mode rating removal integration bug where clearing a star rating via desktop keyboard shortcuts or star-click does not call `removeFromLibraryByOpenalexId`, leaving a stale Convex library item; (2) a missing Phase 24 VERIFICATION.md that leaves FILT-04 (nuqs URL state persistence) formally unverified; and (3) REQUIREMENTS.md traceability table not reflecting Phase 27's contribution to FILT-01, FILT-02, and FILT-05.

All three issues are well-scoped with clear evidence in the existing codebase and audit artifacts. No new libraries, architecture patterns, or infrastructure are needed. The fixes are surgical edits to existing files and creation of one verification document.

**Primary recommendation:** Fix the focus-mode `handleRatingChange` to mirror the `removeFromLibraryByOpenalexId` pattern already proven in `rating-selector.tsx`, run the Phase 24 verification pass using the existing gsd-verifier workflow, and update REQUIREMENTS.md traceability.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LIB-01 (integration fix) | Rating a paper (signed-in user) saves/upserts it to the user's Convex-backed library with slim normalized metadata | Bug fix: focus-mode desktop `handleRatingChange` must call `removeFromLibraryByOpenalexId` when clearing a rating, mirroring `rating-selector.tsx` bidirectional sync |
| FILT-04 (verification) | All filter and sort state is persisted in the URL via nuqs (bookmarkable views) | Phase 24 has no VERIFICATION.md despite implementation being complete; needs formal verification pass |
</phase_requirements>

## Standard Stack

### Core

No new libraries required. All fixes use existing project dependencies:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| convex | existing | Convex mutations (`removeFromLibraryByOpenalexId`) | Already wired in `rating-selector.tsx`; same pattern needed in `focus-mode.tsx` |
| nuqs | existing | URL state persistence for library filters/sort/search | Already integrated in Phase 24; verification confirms it works |
| next-intl | existing | i18n (no new strings needed) | Existing in all 6 locales |

### Supporting

None needed.

### Alternatives Considered

None -- this phase uses only existing patterns and libraries.

**Installation:**
```bash
# No new dependencies
```

## Architecture Patterns

### Pattern 1: Bidirectional Rating-Library Sync (Bug Fix Target)

**What:** When a user clears a star rating (sets to "no-rating"), the Convex library item must also be removed. When a user removes from library, the Zustand star rating must also be cleared. This was established as a decision in Phase 23 (`[23-02] Bidirectional rating-library sync`).

**Current state of the pattern in RatingSelector (correct):**
```typescript
// components/rating-selector.tsx lines 68-83
if (phase === "authenticated") {
  if (newRating !== null && paperResult) {
    const trimmed = trimPaperData(paperResult);
    saveToLibrary({ ...trimmed, rating: newRating }).catch(...);
  } else if (newRating === null) {
    removeFromLibrary({ openalexId: paperId }).catch(...);
  }
}
```

**Current state of the pattern in FocusMode (broken):**
```typescript
// components/ui/focus-mode.tsx lines 544-571
// Only handles save path (newRating !== null), does NOT handle removal path
if (phase === "authenticated" && newRating !== null) {
  const paper = papers.find((p: any) => p.id === paperId);
  if (paper) {
    const trimmed = trimPaperData(paper);
    saveToLibraryMutation({ ...trimmed, rating: newRating }).catch(...);
  }
}
// MISSING: else if (newRating === null) { removeFromLibrary... }
```

**Fix pattern:**
```typescript
// Add removeFromLibraryByOpenalexId mutation hook
const removeFromLibraryMutation = useMutation(api.library.mutations.removeFromLibraryByOpenalexId);

// In handleRatingChange, after the save block:
if (phase === "authenticated" && newRating !== null) {
  // ... existing save logic
} else if (phase === "authenticated" && newRating === null) {
  removeFromLibraryMutation({ openalexId: paperId }).catch((error) => {
    console.error("[Library] Failed to remove from library:", error);
  });
}
```

Add `removeFromLibraryMutation` to the `useCallback` dependency array.

### Pattern 2: Phase Verification (Gap Closure)

**What:** Running gsd-verifier against Phase 24 to produce a formal 24-VERIFICATION.md that cross-checks all must-have truths and artifacts from both 24-01-PLAN.md and 24-02-PLAN.md against the actual codebase.

**Verification targets for Phase 24:**
- Plan 01 truths (5): URL state restoration on refresh, shareable library URLs, Convex query filter args, date preset to timestamp conversion, year range filtering
- Plan 02 truths (5): Date saved preset UI, year range input UI, view mode toggle, grid card component, 6-locale i18n
- Plan 01 artifacts (3): `lib/library/search-params.ts`, `convex/library/queries.ts`, `components/library/library-page-client.tsx`
- Plan 02 artifacts (4): `components/library/library-filters.tsx`, `components/library/library-item-card.tsx`, `components/library/library-page-client.tsx`, `messages/en-US.json`
- Plan 01 key links (3): librarySearchParams import, filter arg passing, nuqs parser imports
- Plan 02 key links (3): filter prop passing, LibraryItemCard rendering, i18n translations

### Pattern 3: REQUIREMENTS.md Traceability Update

**What:** The traceability table in REQUIREMENTS.md needs to reflect Phase 27's contribution to FILT-01, FILT-02, and FILT-05.

**Current state:**
```markdown
| FILT-01 | Phase 24, 27 | Complete |
| FILT-02 | Phase 24, 27 | Complete |
| FILT-05 | Phase 24, 27 | Complete |
```

Wait -- checking the actual file, it already shows "Phase 24, 27" for these entries. Let me verify what the audit actually flagged.

The audit (`v2.1-MILESTONE-AUDIT.md`) states: "REQUIREMENTS.md traceability table does not reflect Phase 27 as contributor to FILT-01, FILT-02, FILT-05." However, examining the current REQUIREMENTS.md, these entries already list "Phase 24, 27". This means the traceability correction was already applied (likely during or after the audit). The planner should verify this is still correct and mark this sub-task as no-op if already resolved.

### Anti-Patterns to Avoid

- **Partial pattern mirroring:** When replicating the rating removal pattern from `rating-selector.tsx` to `focus-mode.tsx`, include ALL aspects: the mutation hook declaration, the auth guard, the `newRating === null` condition, the fire-and-forget `.catch()`, AND the dependency array update. Missing any one of these creates a subtle bug.
- **Incorrect dependency array:** The `useCallback` in FocusMode must include the new `removeFromLibraryMutation` in its dependency array alongside the existing `setRating`, `phase`, `papers`, and `saveToLibraryMutation`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Library removal by openalexId | New mutation | Existing `removeFromLibraryByOpenalexId` | Already handles cascade-delete of junction rows, auth check, index lookup |
| Phase verification | Manual checklist | gsd-verifier workflow | Produces standardized VERIFICATION.md with cross-referencing |

**Key insight:** All three fixes in this phase use existing infrastructure. The bug fix uses an existing mutation. The verification uses an existing workflow. The traceability fix is a documentation update.

## Common Pitfalls

### Pitfall 1: Forgetting the useCallback dependency array

**What goes wrong:** Adding `removeFromLibraryMutation` to the `handleRatingChange` callback body but not its dependency array creates a stale closure where the mutation reference never updates.
**Why it happens:** The existing callback has 4 dependencies; easy to forget the 5th.
**How to avoid:** After editing the callback body, immediately update the dependency array to include all referenced values from outer scope.
**Warning signs:** Rating removal works on first render but fails after re-renders or hot module replacement.

### Pitfall 2: Mobile vs Desktop rating paths in FocusMode

**What goes wrong:** FocusMode has TWO rating paths: (1) desktop keyboard shortcuts via `handleRatingChange` callback and (2) mobile `<RatingSelector>` component. The mobile path already works correctly because it delegates to RatingSelector which has the removal logic. The desktop path is the one that's broken.
**Why it happens:** The two paths were created independently in Phase 22, and only RatingSelector was updated in Phase 23.
**How to avoid:** Fix only the `handleRatingChange` callback. Do NOT modify the mobile `<RatingSelector>` JSX -- it already works via delegation.
**Warning signs:** If you accidentally break the mobile path while fixing desktop, mobile rating removal will double-fire (once from RatingSelector, once from FocusMode).

### Pitfall 3: Phase 24 verification scope

**What goes wrong:** Running verification only against Plan 01 truths and missing Plan 02.
**Why it happens:** Phase 24 has two plans with different scopes -- Plan 01 is the URL state backbone, Plan 02 is the filter UI. Both must be verified.
**How to avoid:** Check both 24-01-PLAN.md and 24-02-PLAN.md must_haves sections when running verification.
**Warning signs:** VERIFICATION.md only references 3 artifacts instead of 7+.

## Code Examples

### Fix: FocusMode handleRatingChange (verified pattern from rating-selector.tsx)

The fix adds `removeFromLibraryByOpenalexId` mutation support to the existing `handleRatingChange` callback in `components/ui/focus-mode.tsx`.

**What to add at hook level (alongside existing hooks):**
```typescript
const removeFromLibraryMutation = useMutation(api.library.mutations.removeFromLibraryByOpenalexId);
```

**What to add in handleRatingChange callback (after the existing save block):**
```typescript
else if (phase === "authenticated" && newRating === null) {
  removeFromLibraryMutation({ openalexId: paperId }).catch((error) => {
    console.error("[Library] Failed to remove from library:", error);
  });
}
```

**Updated dependency array:**
```typescript
[setRating, phase, papers, saveToLibraryMutation, removeFromLibraryMutation]
```

### Files Modified Summary

| File | Change | Lines Affected |
|------|--------|----------------|
| `components/ui/focus-mode.tsx` | Add `removeFromLibraryMutation` hook + else-if removal block in `handleRatingChange` + update deps array | ~4-6 lines added |
| `.planning/phases/24-advanced-filtering-url-state/24-VERIFICATION.md` | New file (verification report) | New file |
| `.planning/REQUIREMENTS.md` | Verify/update traceability for FILT-01, FILT-02, FILT-05 | May be no-op |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 22: Rating removal does NOT call mutation | Phase 23: Bidirectional sync -- rating removal calls `removeFromLibraryByOpenalexId` | Phase 23 (commit a00247b) | RatingSelector was updated; FocusMode was missed |

**Context:** The original Phase 22 plan explicitly stated "Rating removal (no-rating) does NOT call the mutation -- library deletion is Phase 23 (LIB-07)." Phase 23 then introduced bidirectional sync which changed this behavior in `rating-selector.tsx` but did not update `focus-mode.tsx`'s parallel `handleRatingChange` callback. This is the root cause of the integration gap.

## Open Questions

1. **REQUIREMENTS.md traceability already updated?**
   - What we know: The current REQUIREMENTS.md shows "Phase 24, 27" for FILT-01, FILT-02, FILT-05
   - What's unclear: Whether this was always there or was updated after the audit
   - Recommendation: The planner should verify the current state and skip the update if already correct. Include a verification step either way.

## Sources

### Primary (HIGH confidence)
- `components/ui/focus-mode.tsx` lines 544-571 -- confirmed missing removal path
- `components/rating-selector.tsx` lines 68-83 -- confirmed working removal path (reference implementation)
- `convex/library/mutations.ts` lines 57-84 -- `removeFromLibraryByOpenalexId` mutation exists and handles cascade delete
- `.planning/v2.1-MILESTONE-AUDIT.md` -- formal audit identifying all three gaps
- `.planning/phases/22-schema-rating-bridge/22-VERIFICATION.md` -- Phase 22 verification confirming original "no removal on clear" behavior
- `.planning/phases/23-core-library-page/23-02-SUMMARY.md` -- Phase 23 summary documenting bidirectional sync addition
- `.planning/phases/24-advanced-filtering-url-state/24-01-PLAN.md` -- Plan 01 must-haves for verification
- `.planning/phases/24-advanced-filtering-url-state/24-02-PLAN.md` -- Plan 02 must-haves for verification
- `.planning/phases/27-library-ui-redesign/27-VERIFICATION.md` -- Phase 27 verification noting traceability advisory

### Secondary (MEDIUM confidence)
- None needed -- all findings come from direct codebase inspection

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, all existing patterns
- Architecture: HIGH - fix mirrors existing proven pattern in rating-selector.tsx
- Pitfalls: HIGH - all pitfalls identified from actual code analysis of the specific files

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (stable -- no external dependency changes expected)
