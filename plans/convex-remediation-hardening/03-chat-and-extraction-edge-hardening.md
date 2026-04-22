# Plan 03 — Chat And Extraction Edge Hardening

## Goal

Close the chat/extraction edge cases that the audit found but the original remediation did not test.

## Scope

- `listThreadMessages` cap-exhaustion behavior on tool-heavy threads.
- Suggestion-chip count correctness during chat bootstrap.
- Extraction page routing coverage for chat vs non-chat job modes.

## Design

1. **Thread read model**
   - Keep read caps only if the query preserves visible-page integrity and exposes any split state the client needs.
   - Add a regression test that forces cap pressure.
2. **Suggestion-chip count**
   - Stop deriving the headline count purely from `rows.length` after a defensive join.
   - Expose or preserve authoritative source count separately from joined rows.
3. **Extraction route coverage**
   - Add explicit tests for both chat and non-chat job routes so the shell split cannot silently regress.

## TDD sequence

1. Add a failing `listThreadMessages` regression test that forces cap exhaustion.
2. Add a failing provider-level `SuggestionChips` test using the real papers context/query path.
3. Add a failing extraction page test for the non-chat route.
4. Implement the minimum changes necessary to make each path correct.

## Files touched

- `convex/chat/messages.ts`
- `convex/chat/messages.readModel.test.ts`
- `convex/chat/messages.test.ts`
- `convex/chat/sourceReadModel.ts` or adjacent source-count helper
- `components/extraction/chat/papers-context.tsx`
- `components/extraction/chat/suggestion-chips.tsx`
- `tests/components/suggestion-chips.test.tsx`
- `app/extraction/[jobId]/page.tsx`
- `app/extraction/[jobId]/__tests__/page.test.tsx`

## Migration stance

- No schema migration expected.
- If the cleanest fix is a widened query return shape for source count, cut over directly and delete dead assumptions.

## Test plan

- `pnpm vitest run convex/chat/messages.readModel.test.ts convex/chat/messages.test.ts`
- `pnpm vitest run tests/components/suggestion-chips.test.tsx 'app/extraction/[jobId]/__tests__/page.test.tsx'`
- Manual smoke:
  - long/tool-heavy chat thread pagination
  - fresh chat page with source bootstrap in progress

## Acceptance criteria

- Cap exhaustion is explicitly tested and handled.
- Suggestion-chip paper count no longer underreports during bootstrap.
- Both chat and non-chat extraction page routes are covered.
- No duplicate source-count logic remains without a clear source of truth.

## Known pitfalls

- Do not keep a silent truncation path in `listThreadMessages`.
- Do not reintroduce duplicate broad source reads just to fix the headline count.
- Use real provider/query wiring in tests where the race condition matters.
