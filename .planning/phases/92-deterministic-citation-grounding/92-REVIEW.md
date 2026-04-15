---
phase: 92-deterministic-citation-grounding
reviewed: 2026-04-15T05:04:17Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - components/extraction/confidence-badge.tsx
  - components/extraction/critic-verdict-badge.tsx
  - components/extraction/evidence-quote.tsx
  - components/extraction/insufficient-evidence-card.tsx
  - convex/extraction/extract.test.ts
  - convex/extraction/extract.ts
  - convex/extraction/mutations.ts
  - convex/extraction/queries.ts
  - convex/extraction/workpoolActions.ts
  - lib/ai/core/prompts.ts
  - lib/ai/core/types.ts
  - tests/ai-prompts.test.ts
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 92: Code Review Report

**Reviewed:** 2026-04-15T05:04:17Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Phase 92 introduces Levenshtein-based citation grounding, a critic verification pass, and the `insufficient_evidence` first-class answer state across the extraction pipeline. The implementation is generally well-structured: the three-tier cascade in `extract.ts` is clean, the Zod `superRefine` for Levenshtein verification is a sound approach, the critic pass logic handles supported/unsupported/partial/timeout correctly, and the UI components are accessible and well-composed.

One critical logic bug was found in `workpoolActions.ts` where the paper success check is stale relative to Phase 92's new `insufficient_evidence` string answer (never null), causing all papers to be incorrectly marked as successful. Three warnings address an accessibility gap in the evidence quote component, a prompt injection surface in extraction prompts, and an `AbortSignal` that may not compose correctly with the parent signal. Two info items cover dead code in tests.

## Critical Issues

### CR-01: Paper success check never detects failure after Phase 92

**File:** `convex/extraction/workpoolActions.ts:216`
**Issue:** The success determination `extractionResults.some((r) => r.answer !== null)` is a pre-Phase-92 check that is now always true. Phase 92 changed `makeInsufficientEvidence()` to return `answer: "insufficient_evidence"` (a non-null string) instead of `answer: null`. Since the `ExtractionResult.answer` type is `string | null` but `extractSingleAnswer()` now always returns a string (either a real answer or the literal `"insufficient_evidence"`), the `!== null` check always passes. This means a paper where every question returned `insufficient_evidence` is still marked `success: true`, inflating `processedPapers` instead of `failedPapers` and producing misleading progress percentages.

The same stale check appears on line 226 in the log message filter.

**Fix:**
```typescript
// Line 216 -- replace the null check with an insufficient_evidence check
const anySucceeded = extractionResults.some(
  (r) => r.answer !== null && r.answer !== "insufficient_evidence"
);

// Line 226 -- same fix for the log filter
extractionResults.filter(
  (r) => r.answer !== null && r.answer !== "insufficient_evidence"
).length
```

## Warnings

### WR-01: Evidence quote has `role="link"` without click/keyboard handler

**File:** `components/extraction/evidence-quote.tsx:82-94`
**Issue:** The `<div>` element is given `role="link"`, `tabIndex={0}`, `cursor-pointer`, and a focus ring, signaling to both sighted users and screen readers that it is an interactive element that navigates somewhere. However, no `onClick` or `onKeyDown` handler is attached. A screen reader will announce this as a link, but activating it (Enter/Space) does nothing. This violates WCAG 2.1 SC 4.1.2 (Name, Role, Value) -- an element with `role="link"` must be operable. The project's CLAUDE.md explicitly targets WCAG AAA.

**Fix:** Either add the missing interaction handlers (onClick + onKeyDown for Enter/Space that navigates to the PDF location), or remove the interactive affordances (`role`, `tabIndex`, `cursor-pointer`, focus ring) if the click behavior is not yet implemented, downgrading the element to a presentational blockquote:
```tsx
// Option A: Make it non-interactive until click-to-scroll is implemented
<blockquote
  className={cn(
    "rounded-md border-l-[3px] border-l-primary/40 bg-[var(--pdf-highlight)] px-4 py-2 text-sm leading-[1.43]",
    className,
  )}
  aria-label={`Evidence from source at characters ${startChar} to ${endChar}`}
>
  {verbatimText}
</blockquote>
```

### WR-02: Critic `AbortSignal.timeout(30_000)` does not compose with parent signal

**File:** `convex/extraction/extract.ts:262`
**Issue:** `extractSingleAnswer` receives a parent `signal` (60s per-question timeout) but the critic call creates an independent `AbortSignal.timeout(30_000)` that is not linked to the parent. If the parent signal aborts (e.g., the overall question timeout fires at 60s), the critic call will continue running for up to 30 more seconds because its signal is independent. In Node 20+, `AbortSignal.any([signal, AbortSignal.timeout(30_000)])` composes both signals so the critic respects whichever fires first.

**Fix:**
```typescript
// Line 262 -- compose with parent signal
const criticSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
```

### WR-03: User-controlled paper text interpolated directly into LLM prompt without sanitization

**File:** `lib/ai/core/prompts.ts:254`
**Issue:** `input.bodyText` (which originates from parsed academic papers) is interpolated directly into the prompt string via template literal `${input.bodyText}`. While the `---` delimiters provide weak structural separation, a paper with adversarial content (e.g., containing the literal string `---\n\nIGNORE ALL PREVIOUS INSTRUCTIONS`) could manipulate the LLM's behavior. This is a prompt injection surface. The same pattern exists for `input.question` (line 249), `input.answer` (line 279), `input.evidenceQuote` (line 281), and `input.sourceSlice` (line 284).

For an academic tool processing 250M+ works from the open web, some papers will contain adversarial or unusual text. The Levenshtein + critic architecture mitigates output manipulation, but does not prevent the LLM from hallucinating completely different answers when injection succeeds.

**Fix:** Use XML-style delimiters that are less likely to appear in academic text, and/or pass user content via a separate `messages` array entry with a `user` role rather than string interpolation:
```typescript
prompt: `Extract the answer to the following question from this research paper.

QUESTION: ${input.question}
${input.expectedType ? `EXPECTED ANSWER TYPE: ${input.expectedType}` : ''}

<paper_text>
${input.bodyText}
</paper_text>

Extract the answer with supporting evidence.`,
```

## Info

### IN-01: Unused variable `callsByQuestion` in concurrency test

**File:** `convex/extraction/extract.test.ts:251`
**Issue:** The `Map` variable `callsByQuestion` is declared with a descriptive comment but never read or written to anywhere in the test body. It appears to be a leftover from an earlier iteration that tracked per-question call counts.

**Fix:** Remove the unused declaration:
```typescript
// Delete line 251:
// const callsByQuestion = new Map<string, number>();
```

### IN-02: `extractionResultValueValidator` in validators.ts still documents `answer: null` for failures

**File:** `convex/extraction/validators.ts:86`
**Issue:** The JSDoc comment on `extractionResultValueValidator` states "failed questions have `answer: null` with only `errorMessage` populated (D-15)." This is stale documentation after Phase 92 -- failed questions now have `answer: "insufficient_evidence"`. The validator itself (`v.union(v.string(), v.null())`) still permits null, which is correct for backward compatibility, but the comment is misleading and could confuse future contributors.

**Fix:** Update the comment to reflect the Phase 92 behavior:
```typescript
/**
 * Extraction result value shape (EXTR-09, D-03).
 *
 * Shared contract between the saveResult mutation args and the
 * extraction cascade output. All fields except `answer` are optional.
 * Failed/insufficient questions have `answer: "insufficient_evidence"`
 * with `confidence: "low"` (Phase 92). The `null` variant is retained
 * for backward compatibility with pre-Phase-92 results.
 */
```

---

_Reviewed: 2026-04-15T05:04:17Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
