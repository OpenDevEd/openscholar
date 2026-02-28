# Phase 16: AI Batch Processing Tests - Research

**Researched:** 2026-02-28
**Domain:** AI batch processing test coverage (pure unit tests, no production changes)
**Confidence:** HIGH

## Summary

Phase 16 tests three source files containing batch processing logic: `lib/ai/core/batch.ts` (generic `processBatch` factory plus `processScreeningBatch` and `processTranslationBatch`), `lib/screening-utils.ts` (`generateMissingScreeningCombinationsByPaper`), and indirectly `lib/ai/core/execute.ts` (the `executeAIOperation` function that `processBatch` delegates to).

The testing strategy is straightforward: mock `executeAIOperation` at the module boundary to control success/failure per item, then verify that `processBatch` correctly accumulates results, captures errors, and preserves the fail-soft guarantee via `Promise.allSettled`. The domain-specific wrappers (`processScreeningBatch`, `processTranslationBatch`) need tests confirming they correctly wire up context (questions, target language) into the generic processor. `generateMissingScreeningCombinationsByPaper` is a pure synchronous function requiring no mocks at all.

**Primary recommendation:** Mock `executeAIOperation` via `vi.mock` at the `lib/ai/core/execute` module level. Each test scenario controls what `executeAIOperation` returns (resolved/rejected) per invocation to simulate all-success, all-failure, and mixed-outcome batches.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- no locked decisions from CONTEXT.md.

### Claude's Discretion
- Mocking strategy for AI provider responses in batch tests
- Error types and shapes to simulate for failure scenarios
- Test data construction (paper/question fixtures)
- How to verify per-item usage accumulation correctness
- How to verify domain-specific context (screening questions, target language) flows through to each batch item
- Test organization (one file per function vs grouped by scenario)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AIBP-01 | `processBatch` handles all-success scenario -- returns all results with correct `usageByItemId` accumulation | Mock `executeAIOperation` to resolve for every item; verify `results` has all items, `usageByItemId` maps each item ID to its usage, `errors` is empty |
| AIBP-02 | `processBatch` handles all-fail scenario -- returns empty results with all errors captured | Mock `executeAIOperation` to reject for every item; verify `results` is empty, `errors` contains one entry per item with correct `paperId` and `error` message |
| AIBP-03 | `processBatch` handles partial-failure scenario -- returns successful results while capturing errors for failed items | Mock `executeAIOperation` to resolve for some items and reject for others; verify `results` contains only successful items, `errors` contains only failed items |
| AIBP-04 | `processScreeningBatch` maps papers to screening configs correctly and passes through question context | Verify `toConfigInput` produces `{ title, abstract, questions }` matching `GenerateScreeningResponsesInput`; verify `getOperationConfig` is `getScreeningResponsesConfig` |
| AIBP-05 | `processTranslationBatch` passes target language through to each translation call | Verify `toConfigInput` produces `{ title, abstract, targetLanguage }` matching `TranslatePaperContentInput`; verify optional `targetLanguage` is conditionally spread |
| AIBP-06 | `generateMissingScreeningCombinationsByPaper` correctly identifies which (paper, question) pairs lack responses | Pure function test -- no mocking needed; test with complete, partial, and empty response sets |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | (project version) | Test runner and assertions | Already configured in project |
| vi.mock | built-in | Module-level mocking of `executeAIOperation` | Native vitest mocking, no additional deps |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vi.fn() | built-in | Spy on individual function calls | Track how `executeAIOperation` is called per item |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| vi.mock module mock | Manual dependency injection | DI would require changing production code; vi.mock is non-invasive |

**Installation:** No new dependencies needed. All required tools are already in the project.

## Architecture Patterns

### Recommended Test File Structure
```
tests/
├── ai-batch.test.ts              # processBatch generic + processScreeningBatch + processTranslationBatch
└── screening-utils.test.ts       # generateMissingScreeningCombinationsByPaper
```

### Pattern 1: Module Mock for executeAIOperation
**What:** Mock `lib/ai/core/execute` at the module level so `processBatch` calls the mock instead of the real AI operation.
**When to use:** All batch processor tests (AIBP-01 through AIBP-05).
**Example:**
```typescript
import { vi } from 'vitest'

// Mock the execute module BEFORE importing batch
vi.mock('@/lib/ai/core/execute', () => ({
  executeAIOperation: vi.fn(),
}))

import { executeAIOperation } from '@/lib/ai/core/execute'
import { processBatch } from '@/lib/ai/core/batch'

const mockExecute = vi.mocked(executeAIOperation)
```

### Pattern 2: Per-Call Mock Resolution Control
**What:** Use `mockResolvedValueOnce` / `mockRejectedValueOnce` to control outcome per item in the batch.
**When to use:** Mixed-outcome tests (AIBP-03).
**Example:**
```typescript
// Item 1 succeeds, Item 2 fails, Item 3 succeeds
mockExecute
  .mockResolvedValueOnce({ output: { ... }, usage: { promptTokens: 10, completionTokens: 5 } })
  .mockRejectedValueOnce(new Error('API rate limit'))
  .mockResolvedValueOnce({ output: { ... }, usage: { promptTokens: 12, completionTokens: 6 } })
```

### Pattern 3: Pure Function Tests (no mocks)
**What:** Direct input/output testing for `generateMissingScreeningCombinationsByPaper`.
**When to use:** AIBP-06.
**Example:**
```typescript
import { generateMissingScreeningCombinationsByPaper } from '@/lib/screening-utils'

it('identifies missing (paper, question) pairs', () => {
  const papers = [{ id: 'p1' }, { id: 'p2' }]
  const questions = [{ question: 'Q1' }, { question: 'Q2' }]
  const existing = { p1: { Q1: true } } // p1 missing Q2, p2 missing both

  const result = generateMissingScreeningCombinationsByPaper(papers, questions, existing)
  expect(result).toEqual({ p1: ['Q2'], p2: ['Q1', 'Q2'] })
})
```

### Anti-Patterns to Avoid
- **Testing AI output quality:** These tests verify batch orchestration logic, not AI response quality. Never assert on prompt content or model output semantics.
- **Mocking too deep:** Don't mock `generateObject` from the `ai` SDK. Mock at the `executeAIOperation` boundary which is the batch processor's direct dependency.
- **Shared mutable state between tests:** Always call `mockExecute.mockReset()` in `beforeEach` to prevent test pollution.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Controlling per-item mock outcomes | Manual promise arrays | `mockResolvedValueOnce` / `mockRejectedValueOnce` chains | Built-in vitest, handles ordering automatically |
| Verifying function was called with correct args | Manual tracking arrays | `expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({...}))` | Native vitest matchers, better error messages |

## Common Pitfalls

### Pitfall 1: Mock Import Order
**What goes wrong:** `vi.mock` hoisted but import of mocked module happens before mock is set up.
**Why it happens:** Vitest hoists `vi.mock` calls but dynamic imports can confuse the ordering.
**How to avoid:** Place `vi.mock()` call at top level before any imports of the mocked module. Use `vi.mocked()` to get typed access.
**Warning signs:** Tests pass individually but fail when run together; mock functions never get called.

### Pitfall 2: Promise.allSettled Timing
**What goes wrong:** Tests check results before all settled promises resolve.
**Why it happens:** `processBatch` uses `Promise.allSettled` internally which always resolves (never rejects).
**How to avoid:** Always `await` the `processBatch` call. The function returns a Promise that resolves after all items are settled.
**Warning signs:** Flaky tests, empty results arrays.

### Pitfall 3: Usage Type Shape
**What goes wrong:** Mock usage objects don't match the `Usage` type shape, causing runtime errors or incorrect accumulation checks.
**Why it happens:** `Usage` has both `promptTokens`/`completionTokens` AND `inputTokens`/`outputTokens` (provider-dependent).
**How to avoid:** Mock usage with both field variants: `{ promptTokens: 10, completionTokens: 5, inputTokens: 10, outputTokens: 5 }`.
**Warning signs:** Undefined values in usage accumulation assertions.

### Pitfall 4: getItemId Fallback
**What goes wrong:** The error branch in `processBatch` uses `getItemId(items[i]) || 'unknown'` as fallback.
**Why it happens:** When `Promise.allSettled` reports a rejection, the fulfilled value is not available, so the code indexes back into the original `items` array.
**How to avoid:** Test fixtures should always have valid IDs. The `|| 'unknown'` fallback is a safety net, not a primary path.

### Pitfall 5: LanguageModel Mock
**What goes wrong:** `processScreeningBatch` and `processTranslationBatch` require a `model: LanguageModel` parameter, but `LanguageModel` is a complex interface from the `ai` SDK.
**Why it happens:** The model object is passed through to `processBatch` config but never directly invoked by the batch processor (only by `executeAIOperation` which we mock).
**How to avoid:** Pass a simple stub `{} as LanguageModel` since `executeAIOperation` is mocked and the model is never actually used.

## Code Examples

### Fixture Factory for BatchPaper
```typescript
function createPaper(id: string, title = `Paper ${id}`, abstract = `Abstract for ${id}`): BatchPaper {
  return { id, title, abstract }
}

function createUsage(input = 100, output = 50): Usage {
  return { promptTokens: input, completionTokens: output, inputTokens: input, outputTokens: output }
}
```

### All-Success Batch Test (AIBP-01)
```typescript
it('returns all results with correct per-item usage accumulation', async () => {
  const papers = [createPaper('p1'), createPaper('p2')]
  const usage1 = createUsage(100, 50)
  const usage2 = createUsage(200, 75)

  mockExecute
    .mockResolvedValueOnce({ output: { responses: { Q1: true }, confidence: 0.9 }, usage: usage1 })
    .mockResolvedValueOnce({ output: { responses: { Q1: false }, confidence: 0.8 }, usage: usage2 })

  const result = await processScreeningBatch({ model: {} as any, papers, questions: ['Q1'] })

  expect(Object.keys(result.results)).toHaveLength(2)
  expect(result.errors).toHaveLength(0)
  expect(result.usageByItemId['p1']).toEqual(usage1)
  expect(result.usageByItemId['p2']).toEqual(usage2)
})
```

### targetLanguage Passthrough Test (AIBP-05)
```typescript
it('passes target language through to each translation call', async () => {
  mockExecute.mockResolvedValue({
    output: { translatedTitle: 'T', translatedAbstract: 'A' },
    usage: createUsage(),
  })

  await processTranslationBatch({
    model: {} as any,
    papers: [createPaper('p1')],
    targetLanguage: 'fr',
  })

  // Verify the config input included targetLanguage
  expect(mockExecute).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.objectContaining({ targetLanguage: 'fr' }),
    })
  )
})
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Testing individual AI calls directly | Testing batch orchestration with mocked AI boundary | Project architecture | Cleaner separation of concerns; batch logic tested independently of AI SDK |

## Open Questions

None. The batch processing code is self-contained and well-typed. All functions under test are deterministic once the AI boundary is mocked.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `lib/ai/core/batch.ts` (189 lines), `lib/ai/core/batch-types.ts` (61 lines), `lib/ai/core/execute.ts` (131 lines), `lib/ai/core/configs.ts` (155 lines), `lib/ai/core/types.ts` (94 lines), `lib/screening-utils.ts` (45 lines)
- Vitest documentation for `vi.mock`, `vi.fn`, `vi.mocked` patterns
- Project test infrastructure: `vitest.config.ts`, existing test patterns in `tests/`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - vitest already configured, no new dependencies
- Architecture: HIGH - direct codebase inspection of all target functions
- Pitfalls: HIGH - standard vitest mocking patterns with well-known gotchas

**Research date:** 2026-02-28
**Valid until:** 2026-03-30 (stable codebase, no external dependency changes expected)
