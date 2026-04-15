---
phase: 91-extraction-cascade-core
plan: 02
subsystem: ai, extraction
tags: [openrouter, cascade, concurrency, extraction, ai-sdk, credit-billing]

# Dependency graph
requires:
  - phase: 91-extraction-cascade-core
    plan: 01
    provides: extractionResultValueValidator, saveResult mutation, buildExtractionPrompts, ExtractionPromptInput
  - phase: 90-free-first-parsing-waterfall
    provides: parseFullText in workpoolActions, bodyText/parsingSource on extractionPapers
provides:
  - extractAnswers function for three-tier LLM extraction cascade
  - ExtractionResult and QuestionInput exported types
  - Credit-billed extraction wired into workpool action pipeline
  - Per-question parallelism with concurrency cap 5 and 60s timeouts
affects: [92 critic-pass, 95 observability, 97 UI polish, extraction queries]

# Tech tracking
tech-stack:
  added: []
  patterns: [three-tier cascade with failure-driven escalation, inline concurrency limiter, Zod propertyOrdering for reasoning-before-answer, withUserCreditsBatch credit billing for background jobs]

key-files:
  created:
    - convex/extraction/extract.ts
    - convex/extraction/extract.test.ts
  modified:
    - convex/extraction/workpoolActions.ts

key-decisions:
  - "AI SDK v6 LanguageModelUsage uses inputTokens/outputTokens only (no promptTokens/completionTokens fallback needed)"
  - "Outer try/catch wraps entire pipeline (parsing + extraction) for consistent error logging and workpool retry"
  - "Test mocks identify questions by prompt content rather than call order to handle concurrent execution correctly"

patterns-established:
  - "Three-tier cascade pattern: sequential try/catch with failure-driven escalation, not confidence-based"
  - "Inline concurrency limiter: counter + resolve queue, no external dependency (p-limit)"
  - "Credit billing wraps extraction via withUserCreditsBatch with aggregated token usage"

requirements-completed: [EXTR-01, EXTR-06, EXTR-07, EXTR-10]

# Metrics
duration: 7min
completed: 2026-04-15
---

# Phase 91 Plan 02: Extraction Cascade Module Summary

**Three-tier OpenRouter cascade (Flash Lite -> Flash Preview -> Haiku) with Zod schema, concurrency cap 5, credit billing, and 7 unit tests**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-15T03:25:30Z
- **Completed:** 2026-04-15T03:33:00Z
- **Tasks:** 3/3
- **Files created:** 2
- **Files modified:** 1

## Accomplishments

- Created `convex/extraction/extract.ts` -- pure async cascade module with three-tier model progression (Gemini 2.5 Flash Lite, Gemini 3 Flash Preview, Claude Haiku 4.5)
- Zod output schema with `propertyOrdering` enforcing reasoning-before-answer field order (EXTR-02)
- Inline concurrency limiter capping 5 simultaneous per-question LLM calls with 60s AbortSignal.timeout per question
- Failure-driven escalation: schema error or provider error triggers next tier, NOT confidence-based
- Extended `workpoolActions.ts` to run extraction cascade after parsing, wrapped in `withUserCreditsBatch` for credit billing
- Restructured parsing idempotency guard to skip parsing but still run extraction on workpool retry
- Credit exhaustion marks job as failed before re-throwing for workpool error handling
- Per-question results saved via `saveResult` mutation with parsingSource denormalized from paper
- Paper success determined by at least one question answering (D-15)
- 7 unit tests covering schema propertyOrdering, cascade escalation, total failure, concurrency cap, question isolation, and token capture

## Task Commits

Each task was committed atomically:

1. **Task 1: Create extract.ts cascade module** - `1e54b3d` (feat)
2. **Task 2: Wire extractAnswers into workpoolActions + credit billing** - `921a4ea` (feat)
3. **Task 3: Unit tests for cascade, concurrency, and schema** - `ee2f6c4` (test)

## Files Created/Modified

- `convex/extraction/extract.ts` - Three-tier extraction cascade module with extractAnswers, ExtractionResult, QuestionInput exports
- `convex/extraction/workpoolActions.ts` - Extended with extraction cascade after parsing, credit billing, result persistence, paper success determination
- `convex/extraction/extract.test.ts` - 7 unit tests with mocked generateText and createOpenRouter

## Decisions Made

- AI SDK v6 `LanguageModelUsage` type only exposes `inputTokens`/`outputTokens` -- removed `promptTokens`/`completionTokens` fallbacks from plan spec (would cause TypeScript errors).
- Added outer try/catch wrapping the entire pipeline (parsing + extraction) as a Rule 1 auto-fix -- the plan's restructuring of the idempotency guard removed the original try/catch, leaving parsing errors unlogged.
- Test mock for question isolation uses prompt content matching (`prompt.includes("Q2?")`) instead of sequential call counting, because concurrent question execution makes call order non-deterministic.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed invalid promptTokens/completionTokens fallbacks**
- **Found during:** Task 1
- **Issue:** Plan specified `usage.inputTokens ?? usage.promptTokens ?? 0` but AI SDK v6 `LanguageModelUsage` type only has `inputTokens`/`outputTokens` -- `promptTokens`/`completionTokens` cause TypeScript errors
- **Fix:** Simplified to `usage.inputTokens ?? 0` and `usage.outputTokens ?? 0`
- **Files modified:** convex/extraction/extract.ts
- **Committed in:** 1e54b3d

**2. [Rule 1 - Bug] Added missing outer try/catch for pipeline error logging**
- **Found during:** Task 2
- **Issue:** Plan's restructuring of idempotency guard removed the original try/catch that wrapped parsing. Without it, parsing errors would crash the action without a useful log message.
- **Fix:** Wrapped entire pipeline body (parsing + extraction) in try/catch with error logging and re-throw
- **Files modified:** convex/extraction/workpoolActions.ts
- **Committed in:** 921a4ea

**3. [Rule 1 - Bug] Fixed test mock for concurrent question isolation**
- **Found during:** Task 3
- **Issue:** Plan's test used sequential `callCount` to identify q2's cascade tiers, but with concurrency cap 5 all 3 questions run in parallel making call order non-deterministic
- **Fix:** Changed mock to identify questions by checking `prompt.includes("Q2?")` instead of call count
- **Files modified:** convex/extraction/extract.test.ts
- **Committed in:** ee2f6c4

---

**Total deviations:** 3 auto-fixed (3 bugs)
**Impact on plan:** All fixes were necessary for TypeScript correctness and test reliability. No scope creep.

## Issues Encountered

- Pre-existing `convex-test` infrastructure issue ("Could not find the _generated directory") prevents running `mutations.test.ts` in this worktree environment. This is documented in Plan 01's SUMMARY and is not caused by Plan 02 changes. The `extract.test.ts` tests (which use plain vitest mocks, not convex-test) all pass.
- Pre-existing TypeScript errors in `mutations.test.ts` and `mutations.ts` remain out of scope.

## User Setup Required

None -- no external service configuration required. OpenRouter API key is read at runtime by `createOpenRouter()` from the `OPENROUTER_API_KEY` env var (already configured in Convex deployment).

## Next Phase Readiness

- Extraction cascade is fully operational: `extractAnswers` produces per-question results with evidence provenance
- Credit billing integrated: extraction costs are tracked and deducted via `withUserCreditsBatch`
- Phase 92 (critic-pass) can now read extraction results and add citation grounding verification
- Phase 95 (observability) can query `tokensIn`/`tokensOut` and `modelUsed` fields from saved results

---
*Phase: 91-extraction-cascade-core*
*Completed: 2026-04-15*
