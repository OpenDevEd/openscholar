# Plan 02 — Library Coverage Hardening

## Goal

Prevent another library regression by replacing synthetic confidence with behavior and invariant coverage around the paginated library surface.

## Scope

- Collection-scoped totals and range copy.
- Collection-scoped pagination for browse and search.
- Search-to-browse transition and page reset.
- Export affordance behavior when filtered results become empty.
- Library counter writer invariants on save/remove flows.

## Design

1. **Page tests**
   - Make library tests query-ref-aware instead of call-order-aware.
   - Assert rendered copy such as `84 / 86` and `1-20 of 84`.
2. **Query tests**
   - Add collection-filter page-2 cases for both browse and search.
   - Add counter invariant tests around save/remove operations.
3. **If needed, expose stable test contracts**
   - Small `data-*` attributes are acceptable where copy is too localization-sensitive, but visible text remains the first choice.
4. **Add one browser-level smoke**
   - Use existing Playwright infra to cover the exact user-reported collection-count contract.

## TDD sequence

1. Add failing Convex query tests for collection-filter pagination.
2. Add failing library component tests for collection totals/range and search-to-browse reset.
3. Add failing counter invariant tests for library mutations.
4. Add failing Playwright smoke for collection total/range if the fixture path is ready.
5. Implement only enough code and fixture work to satisfy the new assertions.

## Files touched

- `convex/library/queries.test.ts`
- `convex/library/*.test.ts` as needed for mutation invariants
- `tests/components/library-page-client.test.tsx`
- `e2e/*library*.spec.ts` or an adjacent existing library/auth spec
- Shared test helpers/fixtures for library state if needed

## Migration stance

- No schema changes.
- If current dev data must be reseeded or repaired for Playwright library smoke, do that directly.

## Test plan

- Targeted Vitest for library query, mutation, and page tests
- New or extended Playwright library smoke
- Manual confirmation on `/library`:
  - collection on/off
  - search on/off
  - page navigation
  - export button availability

## Acceptance criteria

- Library tests assert real collection-filter totals and range copy.
- Query tests cover page-2 behavior under collection filtering.
- Search-to-browse transition is covered.
- Counter invariant tests exist for library writers.
- A browser-level smoke covers the user-reported collection count contract.

## Known pitfalls

- Over-mocking the page defeats the point of this plan.
- Do not assert on Tailwind classes for pager state.
- Keep Playwright scope narrow; this is a smoke, not a full library regression matrix.
