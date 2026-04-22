# Plan 01 — Correctness And Type Restoration

## Goal

Close the confirmed escaped product bugs and restore a trustworthy baseline in the touched surface before adding more coverage.

## Scope

- Library total correctness under filtered and counter-breach states.
- Library UI correctness for exact total/range copy.
- Missing import / direct type failures in plan-touched files.
- AI settings fetch-failure behavior.
- Screening sidebar progress rendering.
- Any plan-touched or immediately-adjacent type failures required to make this slice type-clean.

## Design

1. **Library counts**
   - Keep `users.libraryItemCount` as the primary total source.
   - Treat a missing counter as an invariant breach, not as “0 is correct.”
   - Add a bounded repair path and tests that reject the silent-zero behavior.
2. **Library page**
   - Keep the exact filtered-count query already introduced.
   - Assert rendered total/range copy from the mounted page, not only query args.
3. **Collection picker**
   - Fix direct compile issues instead of letting the repo carry type noise.
4. **AI settings**
   - Distinguish “fetch failed” from “empty successful result.”
   - Add a small retry affordance or explicit error state.
5. **Sidebar**
   - Use `activeJob.percentComplete` as the source of truth.

## TDD sequence

1. Add failing library query tests for “user has rows but missing `libraryItemCount`”.
2. Add failing page-client tests for rendered filtered total/range copy.
3. Add failing AI settings failure-path test.
4. Add failing sidebar near-complete test.
5. Run typecheck to capture touched-file failures before implementation.
6. Implement one bug at a time until all new tests are green.

## Files touched

- `convex/library/queries.ts`
- `convex/library/queries.test.ts`
- `components/library/library-page-client.tsx`
- `tests/components/library-page-client.test.tsx`
- `components/library/collection-picker.tsx`
- `app/settings/ai/page.tsx`
- `tests/components/ai-settings-page-mounted-queries.test.tsx`
- `components/app-sidebar.tsx`
- `tests/components/app-sidebar-screening-query.test.tsx`
- Any touched-file tests or fixtures needed to restore type safety

## Migration stance

- Repair invalid library counters directly.
- No compatibility shims.
- If a dev-only repair helper is introduced, it exists to fix current bad state and enforce the invariant, not to preserve old behavior.

## Test plan

- `pnpm vitest run convex/library/queries.test.ts tests/components/library-page-client.test.tsx`
- `pnpm vitest run tests/components/ai-settings-page-mounted-queries.test.tsx tests/components/app-sidebar-screening-query.test.tsx`
- `pnpm tsc --noEmit`
- Manual browser smoke:
  - `/library?col=...` exact total and range
  - `/settings/ai` failure state using forced query rejection if feasible in local harness

## Acceptance criteria

- Library no longer treats missing counter as correct `0`.
- Library filtered total/range are asserted from rendered UI.
- `CollectionPicker` and touched files are type-clean.
- AI settings renders explicit failure state on rejected catalog fetch.
- Sidebar does not render `100%` for an active processing job unless the query says so.
- `pnpm tsc --noEmit` is green or any remaining failure is documented as a blocker outside this plan’s scope.

## Known pitfalls

- Reintroducing an always-on count scan defeats the original bandwidth goal. Any fallback must be invariant-breach-only.
- Library page tests must not return to hook-call-order mocking as the only source of truth.
- Do not let “empty result” and “query failed” collapse into the same state.
