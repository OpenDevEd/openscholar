---
phase: quick-1
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - convex/ai/actions.ts
autonomous: true
requirements: [QUICK-1]
must_haves:
  truths:
    - "Batch translation deducts credits per paper, not as a single lump sum"
    - "Each translation credit deduction has a descriptive ledger entry identifying the paper"
    - "Screening per-item deduction behavior is unchanged"
  artifacts:
    - path: "convex/ai/actions.ts"
      provides: "Per-paper usageBreakdown in generateBatchTranslations"
      contains: "usageBreakdown"
  key_links:
    - from: "convex/ai/actions.ts (generateBatchTranslations)"
      to: "convex/ai/helpers.ts (withAuthAndCreditsBatch)"
      via: "usageBreakdown return field"
      pattern: "usageBreakdown"
---

<objective>
Fix batch translation to deduct credits per paper instead of as a single lump sum.

Purpose: Currently `generateBatchScreeningResponses` builds a `usageBreakdown` array from `usageByItemId` (returned by `processBatch` factory), passing it to `withAuthAndCreditsBatch` which then deducts credits per paper. `generateBatchTranslations` does NOT do this -- it only returns `totalUsage`, causing a single aggregate deduction. Both should behave identically: one credit ledger entry per paper processed.

Output: Updated `convex/ai/actions.ts` with per-paper credit deduction for translations.
</objective>

<execution_context>
@/Users/mcharrad/.claude/get-shit-done/workflows/execute-plan.md
@/Users/mcharrad/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@convex/ai/actions.ts
@convex/ai/helpers.ts (withAuthAndCreditsBatch — lines 181-248, note usageBreakdown handling at lines 224-242)
@lib/ai/core/batch.ts (processBatch factory — returns usageByItemId at line 60/88)

<interfaces>
From convex/ai/helpers.ts:
```typescript
export type UsageBreakdownEntry = {
  usage: Usage;
  description?: string;
  metadata?: Record<string, string>;
};

// withAuthAndCreditsBatch behavior:
// - If usageBreakdown provided: deducts per entry (lines 224-234)
// - If not provided: deducts totalUsage as single entry (lines 235-242)
```

From lib/ai/core/batch.ts:
```typescript
export interface BatchProcessorResult<TResult> {
  results: Record<string, TResult>
  errors: BatchError[]
  usages: Usage[]
  usageByItemId: Record<string, Usage>  // <-- already available, just not used by translation
}
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add per-paper usageBreakdown to generateBatchTranslations</name>
  <files>convex/ai/actions.ts</files>
  <action>
In the `generateBatchTranslations` action handler (line 167-194), the `processTranslationBatch` call already returns `usageByItemId` but it is currently destructured only as `{ results, errors, usages }`.

1. Destructure `usageByItemId` from the `processTranslationBatch` return value (add it alongside `results, errors, usages`).

2. Build a `usageBreakdown` array from `usageByItemId`, following the exact same pattern used in `generateBatchScreeningResponses` (lines 256-270). The breakdown entries should be:
   ```typescript
   const usageBreakdown = Object.entries(usageByItemId).map(
     ([paperId, usage]) => {
       const amount = calculateServerCreditsToDeduct(usage);
       return {
         usage,
         description: `AI: Batch translation (${paperId})`,
         metadata: {
           billingType: "batch_translation",
           paperId,
           chargedCredits: String(amount),
         },
       };
     },
   );
   ```

3. Update the return statement to include `usageBreakdown` alongside `result` and `totalUsage`:
   ```typescript
   return {
     result: { results, errors },
     totalUsage: aggregateUsage(usages),
     usageBreakdown,
   };
   ```

Do NOT change anything in `generateBatchScreeningResponses` or any other action. Only modify `generateBatchTranslations`.
  </action>
  <verify>
Run `npx tsc --noEmit --pretty 2>&1 | head -30` to confirm no TypeScript errors are introduced. Also verify the file compiles by checking that `usageBreakdown` type matches `UsageBreakdownEntry[]` expected by `withAuthAndCreditsBatch`.
  </verify>
  <done>
`generateBatchTranslations` returns `usageBreakdown` with per-paper entries, causing `withAuthAndCreditsBatch` to deduct credits individually per paper (same behavior as screening). Each ledger entry shows `AI: Batch translation ({paperId})` with metadata including `billingType: "batch_translation"`.
  </done>
</task>

</tasks>

<verification>
1. TypeScript compiles without errors: `npx tsc --noEmit`
2. Visual inspection: `generateBatchTranslations` and `generateBatchScreeningResponses` both follow the same pattern -- destructure `usageByItemId`, build `usageBreakdown`, return it alongside `totalUsage`.
3. Existing tests pass: `npx vitest run tests/ai-credit-billing.test.ts`
</verification>

<success_criteria>
- `generateBatchTranslations` deducts credits per paper via `usageBreakdown`, not as a single lump sum
- Each translation credit ledger entry includes paper ID and billing type metadata
- No TypeScript compilation errors
- Screening behavior is completely untouched
</success_criteria>

<output>
After completion, create `.planning/quick/1-currently-screening-deducts-points-for-e/1-SUMMARY.md`
</output>
