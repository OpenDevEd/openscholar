---
phase: quick-13
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - lib/extraction/feature-flags.ts
autonomous: true
requirements:
  - QUICK-13

must_haves:
  truths:
    - "Review Queue tab does not appear in the extraction page for any user"
    - "Report Builder tab does not appear in the extraction page for any user"
    - "The Results, Insights, and Overview tabs are unaffected and continue to work"
  artifacts:
    - path: "lib/extraction/feature-flags.ts"
      provides: "Feature flag configuration"
      contains: "reviewQueue: false"
    - path: "lib/extraction/feature-flags.ts"
      contains: "reportBuilder: false"
  key_links:
    - from: "lib/extraction/feature-flags.ts"
      to: "app/extraction/[jobId]/page.tsx"
      via: "extractionFeatureFlags.reviewQueue / extractionFeatureFlags.reportBuilder"
      pattern: "extractionFeatureFlags\\.reviewQueue|extractionFeatureFlags\\.reportBuilder"
---

<objective>
Disable the Review Queue and Report Builder features on the extraction page by setting their feature flags to false. Both features have active bugs (review queue shows "Unknown" for all answers and only surfaces 250/600 items) and are not useful enough to keep enabled.

Purpose: Remove broken UI features to avoid confusing users without deleting any code, making it easy to re-enable later.
Output: `lib/extraction/feature-flags.ts` with `reviewQueue: false` and `reportBuilder: false`. Both tabs vanish from the extraction page UI.
</objective>

<execution_context>
@/Users/mcharrad/.claude/get-shit-done/workflows/execute-plan.md
@/Users/mcharrad/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Set reviewQueue and reportBuilder feature flags to false</name>
  <files>lib/extraction/feature-flags.ts</files>
  <action>
    In `lib/extraction/feature-flags.ts`, change the `reviewQueue` and `reportBuilder` values from their current env-driven defaults to hardcoded `false`:

    Current:
    ```ts
    reviewQueue: process.env.NEXT_PUBLIC_EXTRACTION_REVIEW_QUEUE !== "false",
    reportBuilder: process.env.NEXT_PUBLIC_EXTRACTION_REPORT_BUILDER !== "false",
    ```

    Replace with:
    ```ts
    reviewQueue: false,
    reportBuilder: false,
    ```

    Do NOT touch the `enabled`, `pdf`, or `insights` flags — those remain env-driven.

    The page at `app/extraction/[jobId]/page.tsx` already gates both tab buttons and their rendered content behind `extractionFeatureFlags.reviewQueue` and `extractionFeatureFlags.reportBuilder` respectively. Setting these to `false` is sufficient — no changes to the page file are needed.
  </action>
  <verify>
    <automated>npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>
    `lib/extraction/feature-flags.ts` contains `reviewQueue: false` and `reportBuilder: false`. TypeScript compilation passes. The Review Queue and Report Builder tabs no longer render in the extraction job detail page.
  </done>
</task>

</tasks>

<verification>
- `grep -n "reviewQueue\|reportBuilder" lib/extraction/feature-flags.ts` shows both set to `false`
- `npx tsc --noEmit` exits 0
- Visually: visit any `/extraction/[jobId]` — only Results, Insights (pro), and Overview tabs appear; no Review Queue or Report Builder tabs
</verification>

<success_criteria>
Review Queue and Report Builder tabs are invisible to all users on the extraction job detail page. All other tabs and functionality work unchanged. No code deleted — re-enabling is a one-line change per flag.
</success_criteria>

<output>
After completion, create `.planning/quick/13-disable-review-queue-and-report-builder/13-SUMMARY.md`
</output>
