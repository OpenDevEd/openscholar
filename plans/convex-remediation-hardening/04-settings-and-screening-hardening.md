# Plan 04 — Settings And Screening Hardening

## Goal

Turn the settings/screening audit findings into durable behavior coverage and remove failure-mode ambiguity.

## Scope

- AI model catalog failure state and retry behavior.
- Sidebar screening progress semantics near completion.
- Mounted-query thinning coverage where behavior is still only indirectly asserted.

## Design

1. **AI settings**
   - Represent catalog fetch state explicitly: loading, success-empty, success-nonempty, failure.
   - Cover the rejected-query path in tests.
2. **Sidebar screening**
   - Render `percentComplete` from the query.
   - Add near-complete test coverage so `processing` cannot render `100%` accidentally.
3. **Mounted-query coverage**
   - Keep mounted-query regression tests where valuable, but pair them with at least one rendered behavior assertion.

## TDD sequence

1. Add failing AI settings failure-path test.
2. Add failing sidebar near-complete test.
3. Add or extend one settings/screening behavior test that proves the post-thinning UI still behaves correctly.
4. Implement the state-model changes and keep the test surface minimal but explicit.

## Files touched

- `app/settings/ai/page.tsx`
- `tests/components/ai-settings-page-mounted-queries.test.tsx`
- `components/app-sidebar.tsx`
- `tests/components/app-sidebar-screening-query.test.tsx`
- `tests/components/billing-page-mounted-queries.test.tsx` if behavior assertions are added there

## Migration stance

- None.
- These are behavior and test-model changes only.

## Test plan

- `pnpm vitest run tests/components/ai-settings-page-mounted-queries.test.tsx tests/components/app-sidebar-screening-query.test.tsx`
- Any adjacent settings/billing regression tests touched by the refactor
- Manual smoke:
  - `/settings/ai` with query failure
  - active screening job near completion

## Acceptance criteria

- AI settings failure no longer renders as generic empty state.
- Sidebar renders the query’s capped percent semantics.
- At least one settings/screening surface has behavior coverage in addition to mounted-query assertions.

## Known pitfalls

- Do not treat “retry” as a reason to globalize new state unnecessarily.
- Keep mounted-query assertions secondary to visible behavior.
