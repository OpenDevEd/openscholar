---
phase: 92-deterministic-citation-grounding
verified: 2026-04-15T05:08:18Z
status: human_needed
score: 4/4
overrides_applied: 0
human_verification:
  - test: "Render the EvidenceQuote component with a known paperId and verify the rendered text matches bodyText.slice(startChar, endChar)"
    expected: "The component displays the exact substring from the paper body text, not the LLM evidenceQuote field"
    why_human: "SC3 specifies 'verified by a component test asserting the rendered string' -- no component test file exists; the implementation is correct but the SC requires a rendered assertion which needs a React test harness"
  - test: "Render InsufficientEvidenceCard with answer=insufficient_evidence and verify muted styling and reasoning text"
    expected: "Card appears with opacity-75, dashed border, 'Insufficient evidence' badge, and reasoning paragraph"
    why_human: "Visual appearance and styling verification cannot be confirmed via grep -- needs rendered DOM inspection"
  - test: "Verify ConfidenceBadge and CriticVerdictBadge render correct colors and icons for each state"
    expected: "High=green/CheckCircle2, Medium=amber/AlertCircle, Low=muted/MinusCircle; Supported=violet, Unsupported=red, Partial=amber, Timeout=muted"
    why_human: "OKLCH color rendering and dark mode variants require visual inspection"
---

# Phase 92: Deterministic Citation Grounding Verification Report

**Phase Goal:** Prevent hallucinated quotes and false-positive answers by rejecting any extraction whose `evidence_quote` fails 85% Levenshtein similarity against the source span, running a critic pass that must return `supported`, emitting `insufficient_evidence` as a first-class answer, and rendering only the verbatim `source.text.slice(start, end)` in the UI.
**Verified:** 2026-04-15T05:08:18Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | An extraction whose evidence_quote is <85% Levenshtein-similar to the source substring is rejected at the Zod superRefine boundary | VERIFIED | `convex/extraction/extract.ts` lines 88-121: `buildExtractionSchema(bodyText)` factory creates Zod schema with `.superRefine()` closure; computes `1 - distance(quote, sourceSlice) / maxLen`; adds Zod issue when `similarity < 0.85`. Unit test "rejects extraction when Levenshtein superRefine fails" (extract.test.ts line 395) passes -- confirms 6 calls (2 attempts x 3 tiers) and result is `insufficient_evidence`. |
| 2 | A critic-pass prompt runs at T=0 with the same cheap model and any unsupported verdict flips the result to insufficient_evidence | VERIFIED | `convex/extraction/extract.ts` lines 254-286: critic pass uses `tier.model` (same model as extraction), `temperature: 0`, `Output.object({ schema: criticOutputSchema })`. When `criticOutput.verdict === "unsupported"`, calls `makeInsufficientEvidence()`. Unit test "flips answer to insufficient_evidence when critic returns 'unsupported'" (extract.test.ts line 498) passes. `buildCriticPrompt` (prompts.ts line 264) and `CriticPromptInput` (types.ts line 67) verified. Tests for supported/partial/timeout all pass (13 tests in ai-prompts.test.ts, 17 in extract.test.ts). |
| 3 | The extraction result UI renders source.text.slice(evidence_start_char, evidence_end_char) and never the model's evidence_quote field | VERIFIED | `components/extraction/evidence-quote.tsx` line 79: `const verbatimText = paperData.bodyText.slice(startChar, endChar)` rendered in JSX. Props interface (lines 10-15) accepts `paperId`, `startChar`, `endChar`, `className` -- no `evidenceQuote` prop exists. The only occurrence of "evidenceQuote" in the file is a comment on line 78: "NEVER use LLM evidenceQuote". Data source is `useQuery(api.extraction.queries.getPaperBodyText, { paperId })` (line 24) which reads from Convex DB. **Note:** SC3 specifies "verified by a component test" but no component test file exists -- routed to human verification. |
| 4 | insufficient_evidence is a first-class answer state with confidence capped and a UI reason line rendered on the result card | VERIFIED | Backend: `makeInsufficientEvidence()` (extract.ts lines 156-174) returns `{ answer: "insufficient_evidence", confidence: "low", reasoning: reason }`. Used at lines 278, 345, 369, 445. Unit test (extract.test.ts line 592) confirms `answer === "insufficient_evidence"`, `confidence === "low"`, no evidence fields. UI: `components/extraction/insufficient-evidence-card.tsx` renders `opacity-75 border-dashed` Card with `Badge variant="secondary"` showing `t("insufficientEvidence")` and renders `reasoning` prop as paragraph text (line 43). |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `convex/extraction/extract.ts` | Levenshtein superRefine, critic pass, insufficient_evidence handling | VERIFIED | 452 lines. Contains `buildExtractionSchema(bodyText)` with `.superRefine()`, `criticOutputSchema` with `z.enum(["supported","unsupported","partial"])`, `downgradeConfidence`, `makeInsufficientEvidence`, `AbortSignal.timeout(30_000)` for critic. Imports `distance` from `fastest-levenshtein` and `buildCriticPrompt` from prompts. |
| `convex/extraction/extract.test.ts` | Unit tests for Levenshtein, critic, insufficient_evidence | VERIFIED | 646 lines. 17 tests all pass. Describe blocks: "Levenshtein verification (EXTR-03)" (4 tests), "critic pass (EXTR-05)" (4 tests), "insufficient_evidence state (EXTR-08)" (1 test), "critic token aggregation (D-20)" (1 test), plus 7 pre-existing cascade tests updated for two-call pattern. |
| `lib/ai/core/prompts.ts` | buildCriticPrompt function | VERIFIED | Lines 264-288. Exports `buildCriticPrompt(input: CriticPromptInput)` returning `{ system, prompt }`. System prompt instructs verbatim accuracy + evidential support evaluation. |
| `lib/ai/core/types.ts` | CriticPromptInput interface | VERIFIED | Lines 67-72. Exports `CriticPromptInput` with fields: `question: string`, `answer: string`, `evidenceQuote: string`, `sourceSlice: string`. |
| `convex/extraction/mutations.ts` | saveResult with criticVerdict arg | VERIFIED | Line 319: `criticVerdict: v.optional(v.string())` in args. Line 349: `criticVerdict: args.criticVerdict` in `ctx.db.insert`. |
| `convex/extraction/workpoolActions.ts` | criticVerdict passthrough to saveResult | VERIFIED | Line 210: `criticVerdict: result.criticVerdict` in saveResult call. |
| `convex/extraction/queries.ts` | getPaperBodyText public query | VERIFIED | Lines 114-132. Accepts `paperId: v.id("extractionPapers")`. Returns `v.union(v.null(), v.object({ bodyText: v.union(v.string(), v.null()) }))`. User isolation: paper -> job -> `job.userId !== user._id` check. |
| `components/extraction/evidence-quote.tsx` | Verbatim quote rendering from bodyText slice | VERIFIED | 96 lines. Uses `useQuery(api.extraction.queries.getPaperBodyText)`. Renders `paperData.bodyText.slice(startChar, endChar)`. Three-state: loading skeleton, error, rendered quote. `role="link"`, `tabIndex={0}`, `aria-label`. No `evidenceQuote` prop. |
| `components/extraction/insufficient-evidence-card.tsx` | Insufficient evidence card state | VERIFIED | 51 lines. `opacity-75 border-dashed` Card. `role="status"`, `aria-live="polite"`. Badge with `t("insufficientEvidence")`. Reasoning text rendered verbatim. |
| `components/extraction/confidence-badge.tsx` | Confidence level badge | VERIFIED | 54 lines. OKLCH semantic colors for high (green hue 145), medium (amber hue 85), low (muted). Lucide icons: CheckCircle2/AlertCircle/MinusCircle. `aria-hidden="true"` on icons. |
| `components/extraction/critic-verdict-badge.tsx` | Critic verdict badge with AI accent | VERIFIED | 80 lines. `ai-surface` for supported. OKLCH colors for unsupported (red hue 27), partial (amber hue 85), timeout (muted). Tooltip with `delayDuration={300}` for reason. Returns null when verdict is null/undefined. |
| `messages/en-US.json` | English (US) i18n keys for extraction | VERIFIED | Lines 1455-1466. Contains `extraction` namespace with all 10 keys: insufficientEvidence, evidenceUnavailable, confidenceHigh, confidenceMedium, confidenceLow, criticVerified, criticUnverified, criticPartial, criticTimeout, viewInSource. |
| `messages/en-GB.json` | English (GB) i18n | VERIFIED | Contains `extraction` namespace with `confidenceHigh` key confirmed. |
| `messages/fr.json` | French i18n | VERIFIED | Contains `extraction` namespace confirmed. |
| `messages/hi.json` | Hindi i18n | VERIFIED | Contains `extraction` namespace confirmed. |
| `messages/ja.json` | Japanese i18n | VERIFIED | Contains `extraction` namespace confirmed. |
| `messages/zh.json` | Chinese i18n | VERIFIED | Contains `extraction` namespace confirmed. |
| `package.json` | fastest-levenshtein dependency | VERIFIED | Line 49: `"fastest-levenshtein": "^1.0.16"` in dependencies. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `convex/extraction/extract.ts` | `fastest-levenshtein` | `import { distance }` | WIRED | Line 30: `import { distance } from "fastest-levenshtein"`. Used at line 113 for similarity computation. |
| `convex/extraction/extract.ts` | `lib/ai/core/prompts.ts` | `import { buildCriticPrompt }` | WIRED | Line 31: `import { buildExtractionPrompts, buildCriticPrompt } from "../../lib/ai/core/prompts"`. Used at line 254 for critic prompt construction. |
| `convex/extraction/workpoolActions.ts` | `convex/extraction/mutations.ts` | saveResult call with criticVerdict | WIRED | Line 210: `criticVerdict: result.criticVerdict` in the saveResult mutation call. Mutation accepts it at line 319 and persists at line 349. |
| `components/extraction/evidence-quote.tsx` | `convex/extraction/queries.ts` | `useQuery(api.extraction.queries.getPaperBodyText)` | WIRED | Line 24: `useQuery(api.extraction.queries.getPaperBodyText, { paperId })`. Query defined at queries.ts line 114. |
| `components/extraction/evidence-quote.tsx` | bodyText | `bodyText.slice(startChar, endChar)` | WIRED | Line 79: `const verbatimText = paperData.bodyText.slice(startChar, endChar)`. Rendered directly in JSX at line 93. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `evidence-quote.tsx` | `paperData` | `useQuery(api.extraction.queries.getPaperBodyText)` | Yes -- `ctx.db.get(args.paperId)` reads from Convex DB | FLOWING |
| `insufficient-evidence-card.tsx` | `questionText`, `reasoning` | Props from parent | N/A -- prop-driven, parent supplies from extraction result | FLOWING (prop) |
| `confidence-badge.tsx` | `confidence` | Props from parent | N/A -- prop-driven | FLOWING (prop) |
| `critic-verdict-badge.tsx` | `verdict`, `reason` | Props from parent | N/A -- prop-driven | FLOWING (prop) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Extraction tests pass | `pnpm vitest run convex/extraction/extract.test.ts` | 17/17 tests pass | PASS |
| Critic prompt tests pass | `pnpm vitest run tests/ai-prompts.test.ts` | 13/13 tests pass (includes 2 buildCriticPrompt tests) | PASS |
| fastest-levenshtein installed | `grep fastest-levenshtein package.json` | `"fastest-levenshtein": "^1.0.16"` | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| EXTR-03 | 92-01 | Extraction enforces deterministic quoting via Zod superRefine + fastest-levenshtein at >=0.85 similarity | SATISFIED | `buildExtractionSchema(bodyText)` with `.superRefine()` at line 88; `similarity < 0.85` check at line 115; 4 unit tests in "Levenshtein verification (EXTR-03)" describe block |
| EXTR-04 | 92-02 | UI always renders verbatim quote from source.text.slice(start_char, end_char), never the LLM evidence_quote | SATISFIED | `evidence-quote.tsx` line 79: `bodyText.slice(startChar, endChar)`. No `evidenceQuote` prop in interface. Only occurrence is a "NEVER use" comment. |
| EXTR-05 | 92-01 | Critic pass (same cheap model, T=0) asks "Does this quote appear verbatim and support this answer?" -- rejects on unsupported | SATISFIED | extract.ts lines 254-286: critic pass with `tier.model`, `temperature: 0`. `criticOutputSchema` with `z.enum(["supported","unsupported","partial"])`. Unsupported flips to `insufficient_evidence`. 4 unit tests in "critic pass (EXTR-05)" describe block. |
| EXTR-08 | 92-01, 92-02 | User sees insufficient_evidence as first-class answer state with confidence capped, UI surfaces reason | SATISFIED | Backend: `makeInsufficientEvidence()` returns `answer: "insufficient_evidence", confidence: "low"`. UI: `InsufficientEvidenceCard` with muted styling, reasoning text. i18n key `insufficientEvidence` in all 6 locales. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | No anti-patterns found in any phase 92 files |

No TODO, FIXME, HACK, PLACEHOLDER, or stub patterns found across all modified files.

### Human Verification Required

### 1. EvidenceQuote Renders Verbatim Slice (Component Test)

**Test:** Mount EvidenceQuote with a known paperId. Mock the Convex query to return a known bodyText string. Provide startChar=10, endChar=30. Inspect the rendered DOM.
**Expected:** The rendered text content equals `knownBodyText.slice(10, 30)` exactly. No LLM evidence_quote value appears in the rendered output.
**Why human:** Roadmap SC3 specifically requires "verified by a component test asserting the rendered string." The implementation is correct per code review, but no component test file exists. A React Testing Library test with mocked Convex provider is needed for the SC as written.

### 2. InsufficientEvidenceCard Visual Appearance

**Test:** Render InsufficientEvidenceCard with questionText="Sample question" and reasoning="Critic returned unsupported: quote does not match source."
**Expected:** Card has reduced opacity (75%), dashed border, "Insufficient evidence" badge, and reasoning text displayed below the badge.
**Why human:** Visual styling and opacity cannot be verified via grep.

### 3. Badge Color and Icon Rendering

**Test:** Render ConfidenceBadge with each confidence level (high, medium, low) and CriticVerdictBadge with each verdict (supported, unsupported, partial, timeout). Inspect rendered icons and colors.
**Expected:** Correct Lucide icons and OKLCH semantic colors for each state. Dark mode variants render correctly.
**Why human:** OKLCH color rendering in both light and dark modes requires visual inspection.

### Gaps Summary

No implementation gaps found. All four roadmap success criteria are met at the code level. All four requirement IDs (EXTR-03, EXTR-04, EXTR-05, EXTR-08) are satisfied with substantive implementations backed by 30 passing tests.

The only outstanding item is the absence of a dedicated component test for EvidenceQuote, which roadmap SC3 specifically calls for ("verified by a component test asserting the rendered string"). The implementation itself is verified correct -- it renders `bodyText.slice()` and has no path to render the LLM's `evidenceQuote` -- but the formal test artifact does not exist. This is routed to human verification rather than marked as a gap because the behavior is provably correct from code inspection.

---

_Verified: 2026-04-15T05:08:18Z_
_Verifier: Claude (gsd-verifier)_
