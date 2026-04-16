---
phase: 100-backend-wiring-tierselector-fix
reviewed: 2026-04-16T10:05:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - components/extraction/extraction-dialog.tsx
  - convex/extraction/extract.test.ts
  - convex/extraction/extract.ts
  - convex/extraction/mutations.ts
  - convex/extraction/queries.ts
  - convex/extraction/workpoolActions.ts
  - convex/lib/errors.ts
  - convex/schema.ts
  - lib/toast/error-resolver.ts
  - convex/openalex/actions.ts
  - messages/en-US.json
  - messages/en-GB.json
  - messages/fr.json
  - messages/hi.json
  - messages/ja.json
  - messages/zh.json
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 100: Code Review Report

**Reviewed:** 2026-04-16T10:05:00Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Phase 100 threads the tier selector through the extraction pipeline: from the UI (`TierSelector` in the dialog) through the Convex mutation, schema, workflow, workpool action, and down into the `extractAnswers` cascade. The wiring is consistent and well-structured. The schema, mutations, queries, and internal queries all correctly handle the new `tier` field as `v.optional(v.union(...))` with a sensible `"auto"` default fallback. The `extract.ts` cascade correctly filters tiers based on the selection.

The extraction pipeline is solid. Error handling, idempotency guards, terminal-status checks, and auth/ownership isolation are all consistently applied. The critic pass, Levenshtein verification, and token aggregation logic are clean.

Three warnings and four informational items were found. No critical security or correctness issues were identified.

## Warnings

### WR-01: `anySucceeded` check uses wrong sentinel for `insufficient_evidence` answers

**File:** `convex/extraction/workpoolActions.ts:265`
**Issue:** The success check `extractionResults.some((r) => r.answer !== null)` will evaluate `insufficient_evidence` answers (which are the string `"insufficient_evidence"`, not `null`) as successful. When all questions return `insufficient_evidence` after exhausting all tiers, the paper is incorrectly marked as "succeeded" despite having no usable data extracted. This means `emitStageError` on line 267 never fires for all-insufficient papers, and the paper is reported as `success: true` to the workpool `onComplete` handler.
**Fix:** Check for both `null` and the `"insufficient_evidence"` sentinel:
```typescript
const anySucceeded = extractionResults.some(
  (r) => r.answer !== null && r.answer !== "insufficient_evidence"
);
```

### WR-02: Non-English locale files have untranslated `extraction.jobCreation` and `extraction.progress` sections

**File:** `messages/fr.json:1501-1546`, `messages/hi.json:1501-1546`, `messages/ja.json:1501-1546`, `messages/zh.json:1501-1546`
**Issue:** The `extraction.jobCreation` block (including the new Phase 100 tier-selector keys: `modelTierLabel`, `tierAuto`, `tierAutoDesc`, `tierCheap`, `tierCheapDesc`, `tierAccurate`, `tierAccurateDesc`) and the `extraction.progress` block are English-only placeholders in all four non-English locales (fr, hi, ja, zh). Users on those locales will see English text for the extraction dialog and progress UI. The earlier parts of `extraction.*` (e.g., `insufficientEvidence`, `confidenceHigh`) are properly translated in each locale, making the untranslated sections inconsistent.
**Fix:** Translate the `extraction.jobCreation.*` and `extraction.progress.*` keys in fr.json, hi.json, ja.json, and zh.json to match the level of translation already present in those files.

### WR-03: Variable shadowing of `tier` parameter inside `extractSingleAnswer`

**File:** `convex/extraction/extract.ts:244-246`
**Issue:** The function parameter `tier` (line 240, type `ModelTier`) is shadowed by the loop variable `const tier = tiers[i]` (line 245, type `CascadeTier`). While this does not cause a runtime bug because the parameter is only used once before the loop (line 241), it makes the code confusing to read and fragile to refactor. If future code inside the loop needs to reference the original tier selection (e.g., for logging which tier mode was requested), it would silently get the wrong value.
**Fix:** Rename the loop variable to avoid shadowing:
```typescript
for (let i = 0; i < tiers.length; i++) {
  const currentTier = tiers[i];
  // ... use currentTier.model, currentTier.name throughout
```

## Info

### IN-01: Unused variable `callsByQuestion` in test file

**File:** `convex/extraction/extract.test.ts:251`
**Issue:** The variable `callsByQuestion` is declared as `new Map<string, number>()` but never read or written to. It appears to be a leftover from an earlier test design that was refactored.
**Fix:** Remove the unused declaration:
```typescript
// Delete line 251: const callsByQuestion = new Map<string, number>();
```

### IN-02: Missing `tToast` in `handleSubmit` dependency array

**File:** `components/extraction/extraction-dialog.tsx:141`
**Issue:** The `handleSubmit` callback uses `tToast` (line 137) inside the catch block but does not list it in its `useCallback` dependency array. Since `tToast` is derived from `useTranslations("toast")` and is stable across renders in next-intl (the locale rarely changes mid-session), this is unlikely to cause a runtime bug. However, it violates the exhaustive-deps rule and could produce stale translations if the locale were changed while the dialog is open.
**Fix:** Add `tToast` to the dependency array:
```typescript
}, [papers, localQuestions, tier, createJob, onOpenChange, t, tToast]);
```

### IN-03: French locale `extraction.jobMetrics` strings lack accented characters

**File:** `messages/fr.json:1478-1497`
**Issue:** The French `extraction.jobMetrics` translations use ASCII-only text where accented characters are expected. For example: `"Metriques du job"` should be `"Metriques du job"` (though `"Metriques"` itself is missing the accent -- should be `"Metriques"` or more properly `"M\u00e9triques du job"`), `"Articles traites"` should be `"Articles trait\u00e9s"`, `"Cout estime"` should be `"Co\u00fbt estim\u00e9"`, `"Validite"` should be `"Validit\u00e9"`, etc. These read as incomplete translations to French users.
**Fix:** Add proper accented characters to the French extraction metrics translations.

### IN-04: `console.warn` statements in production extraction cascade

**File:** `convex/extraction/extract.ts:409-418`
**Issue:** The `console.warn` calls inside the cascade retry logic (lines 409 and 416) emit structured-ish log messages but use string interpolation rather than structured JSON logging. Other parts of the codebase (e.g., `workpoolActions.ts`) use `JSON.stringify({ event: ... })` for structured logs. These `console.warn` calls will work fine but are inconsistent with the project's structured logging pattern used elsewhere.
**Fix:** Adopt the same `JSON.stringify` structured logging pattern for consistency:
```typescript
console.warn(JSON.stringify({
  event: "tier_exhausted",
  tier: tier.name,
  questionKey: question.key,
  error: error instanceof Error ? error.message : String(error),
}));
```

---

_Reviewed: 2026-04-16T10:05:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
