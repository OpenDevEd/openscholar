# Phase 92: Deterministic Citation Grounding - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Given extraction results from Phase 91's cascade, enforce deterministic citation grounding: reject any answer whose `evidence_quote` fails 85% Levenshtein similarity against the source span via Zod `.superRefine()`, run a critic pass at T=0 that must return `supported`, emit `insufficient_evidence` as a first-class answer state with capped confidence, and ensure the UI always renders `bodyText.slice(evidenceStartChar, evidenceEndChar)` — never the LLM's `evidence_quote` field. This phase modifies `extract.ts` to add verification + critic, updates the result schema/validators for critic verdict tracking, and adds a UI component for verbatim quote rendering.

</domain>

<decisions>
## Implementation Decisions

### Levenshtein Verification (EXTR-03)
- **D-01:** Install `fastest-levenshtein` as a dependency. Use its `distance()` function to compute edit distance, then derive similarity as `1 - (distance / max(a.length, b.length))`. Threshold: ≥0.85.
- **D-02:** Add a Zod `.superRefine()` refinement to the `extractionOutputSchema` in `convex/extraction/extract.ts`. The refinement receives `bodyText` via closure (not as a schema field). It checks that `bodyText.slice(evidence_start_char, evidence_end_char)` matches `evidence_quote` at ≥85% Levenshtein similarity. On failure, it adds a Zod issue with code `custom` and message describing the mismatch.
- **D-03:** The `superRefine` validation runs inline during `Output.object({ schema })` parsing — the AI SDK's structured output pipeline handles this automatically. When the refinement fails, the tier catches the Zod error and either retries or escalates per D-04.
- **D-04:** On Levenshtein failure: retry once on the same tier with `retryCount=1` (the prompt builder already has retry-aware messaging — "Previous extraction attempt failed validation. Ensure your evidence_quote is an exact verbatim substring..."). If the retry also fails, escalate to the next cascade tier. If all tiers exhaust, mark the answer as `insufficient_evidence`.

### Critic Pass (EXTR-05)
- **D-05:** After a successful extraction (Levenshtein-verified), run a critic pass using the SAME model/tier that produced the extraction. Temperature: 0. The critic prompt asks: "Does this quote appear verbatim in the source text, and does it support this answer?" with structured output: `{ verdict: "supported" | "unsupported" | "partial", reason: string }`.
- **D-06:** The critic schema is a small separate Zod object (`criticOutputSchema`) defined in `extract.ts` — not part of the extraction schema. Critic calls use `Output.object({ schema: criticOutputSchema })`.
- **D-07:** Critic verdict handling: `supported` → answer passes through. `unsupported` → answer flipped to `insufficient_evidence` with confidence capped at `low`. `partial` → answer kept but confidence downgraded by one level (high→medium, medium→low, low stays low).
- **D-08:** `criticVerdict` is stored on the `extractionResults` row using the existing `v.optional(v.string())` field in the schema. Values: `"supported"`, `"unsupported"`, `"partial"`. Null/undefined means critic did not run (legacy or error).
- **D-09:** The critic pass has its own `AbortSignal.timeout(30_000)` — 30 seconds. If the critic times out, the answer is kept with `criticVerdict: "timeout"` (lenient — don't kill a good answer because the critic was slow).
- **D-10:** A new `buildCriticPrompt` function is added to `lib/ai/core/prompts.ts`, following the existing prompt builder pattern (`{ system, prompt }` return shape).

### Insufficient Evidence State (EXTR-08)
- **D-11:** `insufficient_evidence` is represented as `answer: "insufficient_evidence"` (string literal, not null). Null answers indicate extraction failure/error. `insufficient_evidence` indicates the extraction ran but evidence was not trustworthy.
- **D-12:** When `insufficient_evidence` is set: `confidence` is capped at `"low"`, `reasoning` explains why (e.g., "Evidence quote failed Levenshtein verification" or "Critic returned unsupported"), `criticVerdict` stores the raw verdict, `evidenceQuote`/`evidenceStartChar`/`evidenceEndChar` are cleared (no misleading evidence shown).
- **D-13:** The extraction result validator (`extractionResultValueValidator`) does NOT need schema changes — `answer` already accepts `v.union(v.string(), v.null())` which covers the `"insufficient_evidence"` string. `criticVerdict` already exists in the schema as `v.optional(v.string())`.

### UI Verbatim Rendering (EXTR-04)
- **D-14:** The extraction result card UI renders evidence by reading `evidenceStartChar` and `evidenceEndChar` from the result, fetching `bodyText` from the associated paper row, and displaying `bodyText.slice(evidenceStartChar, evidenceEndChar)`. The `evidenceQuote` field is NEVER rendered to the user.
- **D-15:** A new `EvidenceQuote` React component handles the verbatim slice rendering. It takes `paperId`, `startChar`, `endChar` as props, fetches the paper's `bodyText` via a Convex query, and renders the slice with a clickable highlight. Loading/error states handled inline.
- **D-16:** When `answer === "insufficient_evidence"`, the UI shows a distinct state: a muted card with an info icon, the reasoning text, and no evidence block. This is NOT an error — it's a valid extraction outcome.
- **D-17:** The `evidenceQuote` field remains on the schema for traceability (debugging, Levenshtein verification audit trail) but is not exposed in any user-facing UI component.

### Integration with Extract Module
- **D-18:** The `extractSingleAnswer` function in `extract.ts` is modified to:
  1. Build the `extractionOutputSchema` with a `superRefine` closure over `bodyText` (Levenshtein check)
  2. After successful extraction, call the critic pass
  3. Based on critic verdict, either pass through, downgrade, or flip to `insufficient_evidence`
  4. Return the enriched `ExtractionResult` with `criticVerdict` populated
- **D-19:** The `ExtractionResult` interface gains a `criticVerdict?: string` field.
- **D-20:** Credit billing: the critic pass is an additional LLM call. It's billed together with the extraction call — both are part of the same per-question credit charge. Token usage from the critic is added to the result's `tokensIn`/`tokensOut`.

### Claude's Discretion
- Exact critic prompt wording — follow the tone of existing prompts in `lib/ai/core/prompts.ts`.
- Whether the `superRefine` closure needs special handling for edge cases (empty bodyText, out-of-bounds char offsets) — add defensive guards as needed.
- Test fixture design: whether to use real paper snippets or synthetic text for Levenshtein/critic tests.
- Whether the `EvidenceQuote` component uses a dedicated query or piggybacks on an existing paper-detail query.
- The exact visual treatment of the `insufficient_evidence` card (muted opacity, info icon, border style) — follow the Clean/Friendly/Approachable design personality.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Schema & Tables
- `convex/schema.ts` §471-497 — `extractionResults` table with `criticVerdict` field already present, `evidenceQuote`, `evidenceStartChar`, `evidenceEndChar` fields.
- `convex/extraction/validators.ts` — `extractionResultValueValidator` and `extractionConfidenceValidator`. No schema changes needed for Phase 92.

### Extraction Module (Phase 91 output)
- `convex/extraction/extract.ts` — `extractSingleAnswer` function, `extractionOutputSchema` Zod schema, `ExtractionResult` interface. Phase 92 modifies this to add `superRefine` + critic pass.
- `convex/extraction/workpoolActions.ts` — `processExtractionPaper` action that calls `extractAnswers` and saves results. Phase 92 does NOT modify this — changes are internal to `extract.ts`.
- `convex/extraction/mutations.ts` — `saveResult` mutation. Already accepts `criticVerdict`. No changes needed.

### Prompt Builders
- `lib/ai/core/prompts.ts` — 6 existing prompt builders including `buildExtractionPrompts`. New `buildCriticPrompt` follows this pattern.

### Dependencies
- `fastest-levenshtein` — New dependency for Levenshtein distance. Install via `pnpm add fastest-levenshtein`.
- `ai` (v6.0.62) — AI SDK core. `generateText`, `Output.object` for critic call.
- `@openrouter/ai-sdk-provider` — Already installed. Critic uses the same model instance as extraction.

### Requirements
- `.planning/REQUIREMENTS.md` — EXTR-03, EXTR-04, EXTR-05, EXTR-08 define exact scope.
- `convex/_generated/ai/guidelines.md` — Convex API patterns and conventions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `convex/extraction/extract.ts` — Cascade module ready for Levenshtein/critic additions.
- `convex/extraction/extract.test.ts` — Existing extraction tests. Phase 92 adds Levenshtein and critic-specific tests.
- `lib/ai/core/prompts.ts:buildExtractionPrompts` — Pattern for new `buildCriticPrompt`.
- `convex/schema.ts` — `criticVerdict: v.optional(v.string())` already in `extractionResults`.
- `convex/extraction/mutations.ts:saveResult` — Already accepts `criticVerdict` in args.

### Established Patterns
- Zod `.meta({ propertyOrdering })` for field ordering — used in `extractionOutputSchema`.
- `Output.object({ schema })` for structured LLM output — used in cascade tiers.
- `AbortSignal.timeout()` for per-call timeouts — used in `extractSingleAnswer`.
- Prompt builders return `{ system, prompt }` — pattern in `lib/ai/core/prompts.ts`.

### Integration Points
- `convex/extraction/extract.ts` — Primary modification target. Levenshtein + critic added here.
- `lib/ai/core/prompts.ts` — New `buildCriticPrompt` function.
- `package.json` — `fastest-levenshtein` dependency added.
- UI components (future) — New `EvidenceQuote` component for verbatim slice rendering.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — the REQUIREMENTS.md EXTR-03, EXTR-04, EXTR-05, EXTR-08 are precise. The 85% Levenshtein threshold, critic pass with `supported`/`unsupported` verdicts, `insufficient_evidence` answer state, and verbatim `slice()` rendering are all locked in requirements.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 92-deterministic-citation-grounding*
*Context gathered: 2026-04-15*
