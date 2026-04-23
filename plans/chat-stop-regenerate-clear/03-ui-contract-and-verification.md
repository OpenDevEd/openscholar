# Plan 03 — UI Contract And Verification

**Depends on:** 01 and 02. **Blocks:** nothing.

## Goal

Lock the final product behavior in the UI and tests:

- stopped turns render as stopped, not failed,
- retry/regenerate affordance remains available on stopped turns,
- regenerate visibly replaces the stopped turn instead of adding residue,
- clear-history leaves a truly empty conversation surface.

## Scope

In scope:

- `components/extraction/chat/message-list.tsx`
- `components/extraction/chat/message-actions.tsx`
- `components/extraction/chat/clear-conversation.tsx`
- `components/extraction/chat/message-composer.tsx` only if acknowledgment copy needs tightening
- component tests and one smoke verification path

Out of scope:

- backend data model changes,
- unrelated visual redesign,
- new chat controls beyond the existing UX.

## Design

1. **Stopped is a first-class UI branch.**
   The UI must keep the stopped pill / non-error rendering path explicit and tested.

2. **Retry remains enabled for stopped turns.**
   A stopped turn is intentionally retryable. Do not fold it back into generic failure handling.

3. **Clear must visually empty the list.**
   After 02 lands, UI tests should assert the empty-state surface after clear instead of merely checking the dialog opened.

4. **Product verification includes full turn lifecycle.**
   The important smoke path is:
   - stream,
   - stop,
   - see stopped pill,
   - regenerate,
   - see same logical reply replace,
   - clear,
   - see empty conversation.

## TDD Sequence

Phase A — red component tests:

1. stopped message renders pill and not error alert
2. regenerate affordance exists for stopped turn
3. clear-history transitions to empty-state after backend success

Phase B — implementation / tightening:

1. adjust UI branches only where tests prove gaps remain after 02
2. add smoke verification notes / test harness updates if needed

## Files Touched

- [components/extraction/chat/message-list.tsx](../../components/extraction/chat/message-list.tsx)
- [components/extraction/chat/message-actions.tsx](../../components/extraction/chat/message-actions.tsx)
- [components/extraction/chat/clear-conversation.tsx](../../components/extraction/chat/clear-conversation.tsx)
- component tests under `tests/components/**`

## Migration Stance

None.

## Test Plan

- Component:
  - stopped turn shows stopped indicator, not error treatment
  - retry button is enabled on stopped turn
  - clear after stopped turn leads to empty-state UI
- Smoke:
  - desktop and mobile viewport
  - verify no ghost reply after clear
- Optional live verification:
  - check pm2 logs only if the UI outcome is ambiguous

## Acceptance Criteria

- Stopped turns are visibly non-error.
- Regenerate affordance remains available on stopped turns.
- Clear-history has a regression test for post-clear empty state.
- End-to-end smoke path passes.
- Next/Convex compilation is green in the local dev servers for the touched codepaths.

## Known Pitfalls

- Do not assert on Tailwind classes.
- Do not overfit tests to implementation detail inside `@convex-dev/agent` hooks.
- Do not reintroduce a generic error alert for stopped turns through careless branching.
