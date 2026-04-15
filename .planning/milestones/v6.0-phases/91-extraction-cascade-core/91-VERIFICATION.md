---
phase: 91-extraction-cascade-core
verified: 2026-04-15T04:45:00Z
status: gaps_found
score: 4/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "OpenRouter calls set provider.order with allow_fallbacks, verified by inspecting the built request payload in tests"
    status: partial
    reason: "Code sets allowFallbacks: true but does NOT set provider.order (a supported option in @openrouter/ai-sdk-provider). No test inspects the built request payload for temperature, provider.order, or allowFallbacks as SC-3 requires."
    artifacts:
      - path: "convex/extraction/extract.ts"
        issue: "Missing provider.order in createCascadeTiers() -- allowFallbacks is set but order is not"
      - path: "convex/extraction/extract.test.ts"
        issue: "No test inspects the request payload for temperature: 0, provider.order, or allowFallbacks"
    missing:
      - "Add order property to provider config in each tier (e.g. provider: { allowFallbacks: true, order: ['Google'] } for Gemini tiers)"
      - "Add a test that inspects the mockGenerateText call args to verify temperature: 0, Output.object usage, and provider config"
deferred:
  - truth: "critic_verdict field in result shape is populated"
    addressed_in: "Phase 92"
    evidence: "Phase 92 goal: 'running a critic pass that must return supported' and EXTR-05: 'runs a critic pass... asking Does this quote appear verbatim'"
human_verification:
  - test: "Run a live extraction against OpenRouter with a known paper"
    expected: "Three-tier cascade returns populated ExtractionResult with answer, confidence, evidence fields, and accurate character offsets"
    why_human: "Cannot verify LLM output quality or evidence accuracy without an actual API call and manual inspection of results"
  - test: "Verify Gemini automatic caching activates for repeated extractions on the same paper"
    expected: "Second extraction on same paper shows reduced latency or cached token counts in OpenRouter dashboard"
    why_human: "Caching is a provider-side optimization that cannot be verified statically"
---

# Phase 91: Extraction Cascade Core Verification Report

**Phase Goal:** Given parsed source text, send the whole paper (no chunking, no RAG, no vector DB) through the three-tier OpenRouter cascade -- Gemini 2.5 Flash Lite pre-screen, Gemini 3 Flash default, Claude Haiku 4.5 escalation -- using a flat 7-field Zod schema with propertyOrdering forcing reasoning before answer, parallelized per-question with concurrency cap 5, and returning the documented result shape to the UI.
**Verified:** 2026-04-15T04:45:00Z
**Status:** gaps_found
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | An extraction call sends the full parsed source text (no slicing, no embedding, no retrieval) and the committed schema file defines a single 7-field Zod object with propertyOrdering enforcing reasoning before answer | VERIFIED | extract.ts:244 `extractAnswers(bodyText, questions)` sends full text. extractionOutputSchema (lines 55-89) defines 7 fields with `.meta({ propertyOrdering: [...] })` with reasoning first. Test at extract.test.ts:72-114 verifies propertyOrdering and 7 required properties. |
| 2 | The cascade escalates from Gemini 2.5 Flash Lite to Gemini 3 Flash to Claude Haiku 4.5 through @openrouter/ai-sdk-provider with response-healing plugin, verified by a mocked-provider test | VERIFIED | extract.ts:100-126 defines three tiers in order (gemini-2.5-flash-lite, gemini-3-flash-preview, claude-haiku-4.5) each with `plugins: [{ id: "response-healing" }]`. extract.test.ts:142-184 tests cascade escalation on schema failure and all-tiers-fail scenarios with mocked generateText. |
| 3 | OpenRouter calls pin temperature: 0, set provider.order with allow_fallbacks, and rely on Gemini automatic caching -- verified by inspecting the built request payload in tests | PARTIAL | extract.ts:149 sets `temperature: 0`. extract.ts:108,115,122 set `provider: { allowFallbacks: true }`. However, `provider.order` is NOT set (it is a valid option per @openrouter/ai-sdk-provider types). No test inspects the built request payload. |
| 4 | 10 questions on one paper run via Promise.allSettled with concurrency cap 5 and per-question AbortSignal.timeout(60000), and a failure in one question does not abort the other nine -- verified by a test | VERIFIED | extract.ts:202-238 implements withConcurrencyLimit. extract.ts:249-250 sets CONCURRENCY_CAP=5 and PER_QUESTION_TIMEOUT_MS=60000. extract.ts:254 uses AbortSignal.timeout. extract.test.ts:192-252 tests 8 questions with concurrency cap and isolates one question failure from siblings. |
| 5 | Returned results match the documented shape (answer, confidence, evidence, reasoning, model_used, critic_verdict, parsing_source) enforced by the Convex result validator | VERIFIED | validators.ts:88-100 defines extractionResultValueValidator with answer, confidence, evidenceQuote, evidenceSourceId, evidenceStartChar, evidenceEndChar, reasoning, modelUsed, tokensIn, tokensOut, errorMessage. schema.ts:471-497 includes all these plus criticVerdict and parsingSource. saveResult mutation (mutations.ts:301-351) persists all fields including parsingSource from workpoolActions.ts:206. criticVerdict is defined in schema but intentionally populated by Phase 92. |

**Score:** 4/5 truths verified (1 partial)

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | critic_verdict field populated in results | Phase 92 | Phase 92 goal: "running a critic pass that must return supported"; EXTR-05 mapped to Phase 92 |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `convex/extraction/extract.ts` | Cascade module with extractAnswers function | VERIFIED | 274 lines. Exports extractAnswers, ExtractionResult, QuestionInput. Three-tier cascade with concurrency limiter. |
| `convex/extraction/validators.ts` | extractionResultValueValidator and extractionConfidenceValidator | VERIFIED | 100 lines. Both validators exported. extractionResultValueValidator has 11 fields. |
| `convex/extraction/mutations.ts` | Extended saveResult accepting full result payload | VERIFIED | saveResult at line 301 accepts all value fields, inserts idempotently via by_paper_question index. |
| `convex/schema.ts` | Extended extractionResults table with all value fields | VERIFIED | Lines 471-497: 14 fields total (3 original + 10 value + criticVerdict) with 3 indexes. |
| `lib/ai/core/prompts.ts` | buildExtractionPrompts function | VERIFIED | Lines 227-262. Returns { system, prompt }. System enforces 7-field output with verbatim quoting rules. |
| `lib/ai/core/types.ts` | ExtractionPromptInput type | VERIFIED | Lines 61-65. Interface with bodyText, question, expectedType fields. extractAnswer added to AIOperationType. |
| `convex/extraction/extract.test.ts` | Unit tests for cascade, concurrency, schema | VERIFIED | 277 lines. 7 tests all passing. Covers propertyOrdering, 7-field schema, cascade escalation, total failure, concurrency cap, question isolation, token capture. |
| `convex/extraction/mutations.test.ts` | Tests for saveResult with value fields | VERIFIED | Contains "saves result with all value fields (EXTR-09)" and "saves failed question result with null answer and errorMessage" tests. (convex-test infra issue prevents running, but test code is structurally correct.) |
| `convex/extraction/workpoolActions.ts` | Extended workpool action with extraction after parsing | VERIFIED | Imports extractAnswers, calls it after parsing, wraps in withUserCreditsBatch, saves results via saveResult. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| extract.ts | @openrouter/ai-sdk-provider | import createOpenRouter | WIRED | Line 20: `import { createOpenRouter } from "@openrouter/ai-sdk-provider"`. Used at line 101. |
| extract.ts | ai | import generateText, Output | WIRED | Lines 21-22: `import { generateText, Output } from "ai"`. Used at lines 146-148. |
| extract.ts | lib/ai/core/prompts.ts | import buildExtractionPrompts | WIRED | Line 24: `import { buildExtractionPrompts } from "../../lib/ai/core/prompts"`. Used at line 138. |
| workpoolActions.ts | extract.ts | import extractAnswers | WIRED | Line 18: `import { extractAnswers } from "./extract"`. Used at line 153. |
| workpoolActions.ts | ai/helpers.ts | import withUserCreditsBatch | WIRED | Line 20: `import { withUserCreditsBatch } from "../ai/helpers"`. Used at line 148. |
| workpoolActions.ts | mutations.ts | internal.extraction.mutations.saveResult | WIRED | Line 193: `await ctx.runMutation(internal.extraction.mutations.saveResult, ...)`. Passes all fields. |
| mutations.ts | validators.ts | import extractionConfidenceValidator | WIRED | saveResult args use extractionConfidenceValidator at line 308. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| extract.ts | ExtractionResult | generateText via OpenRouter LLM call | Yes (at runtime with API key) | FLOWING (runtime-dependent) |
| workpoolActions.ts | extractionResults | extractAnswers(bodyText, questions) | Yes, from LLM cascade then saved via saveResult | FLOWING |
| mutations.ts saveResult | DB insert | args from workpoolActions | Yes, all fields passed through to ctx.db.insert | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| extract.test.ts passes | `npx vitest run convex/extraction/extract.test.ts` | 7 tests passed in 278ms | PASS |
| TypeScript compiles (Phase 91 files) | `npx tsc --noEmit` (filtered) | No errors in extract.ts, validators.ts, prompts.ts, types.ts, schema.ts, workpoolActions.ts, extract.test.ts | PASS |
| extractAnswers is exported | grep export extractAnswers extract.ts | Found at line 244 | PASS |
| buildExtractionPrompts is exported | grep export buildExtractionPrompts prompts.ts | Found at line 227 | PASS |
| Commit hashes valid | git log --oneline | All 6 commits present: 5353fdb, ef86926, 0045a3e, 1e54b3d, 921a4ea, ee2f6c4 | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| EXTR-01 | 91-02 | Sends whole-paper text to Gemini 3 Flash via OpenRouter -- no RAG, no vector DB | SATISFIED | extract.ts sends full bodyText to cascade starting with Flash Lite, escalating to Flash and Haiku |
| EXTR-02 | 91-01 | Flat 7-field Zod schema with propertyOrdering forcing reasoning before answer | SATISFIED | extractionOutputSchema in extract.ts has 7 fields with .meta({ propertyOrdering }) verified by test |
| EXTR-06 | 91-02 | Three-tier OpenRouter cascade with response-healing plugin | SATISFIED | extract.ts defines three tiers with plugins: [{ id: "response-healing" }] and failure-driven escalation |
| EXTR-07 | 91-02 | Cost minimized via caching, provider.order + allow_fallbacks, temperature: 0 | PARTIAL | temperature: 0 and allowFallbacks: true are set. provider.order is NOT set. Caching relies on Gemini automatic behavior (no code needed). |
| EXTR-09 | 91-01 | Result shape includes answer, confidence, evidence, reasoning, model_used, critic_verdict, parsing_source | SATISFIED | All fields defined in schema and validator. critic_verdict schema field exists, populated by Phase 92. |
| EXTR-10 | 91-02 | Per-question parallelism via Promise.allSettled with concurrency cap 5 and 60s timeout | SATISFIED | withConcurrencyLimit in extract.ts, CONCURRENCY_CAP=5, AbortSignal.timeout(60000), tested |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | No anti-patterns found in any Phase 91 file |

### Human Verification Required

### 1. Live extraction with real API

**Test:** Run a live extraction against OpenRouter with a known paper and 2-3 questions
**Expected:** Three-tier cascade returns populated ExtractionResult with answer, confidence, evidence fields, and character offsets that match actual paper text
**Why human:** Cannot verify LLM output quality or evidence accuracy without actual API call

### 2. Gemini automatic caching behavior

**Test:** Run extraction twice on the same paper via OpenRouter
**Expected:** Second run shows reduced latency or cached tokens in OpenRouter dashboard
**Why human:** Caching is provider-side; cannot verify statically

### Gaps Summary

One gap found: **SC-3 partial compliance.** The code sets `temperature: 0` and `allowFallbacks: true` correctly, but does NOT set `provider.order` -- a supported option in the `@openrouter/ai-sdk-provider` SDK (`order?: string[]` in provider config). The roadmap SC-3 also requires "verified by inspecting the built request payload in tests" but no such test exists. This is a narrow gap -- adding `order` to the provider config and a test that inspects generateText call args would close it.

The `critic_verdict` field in the result shape (EXTR-09) is defined in the schema but not populated -- this is intentionally deferred to Phase 92 (Deterministic Citation Grounding) which implements the critic pass.

---

_Verified: 2026-04-15T04:45:00Z_
_Verifier: Claude (gsd-verifier)_
