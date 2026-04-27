# Plan 04 — Client AI Hook-Factory + Router

**Depends on:** 01 (`hasEnoughCredits`, `resolveCreditsAvailability`). **Blocks:** 05.

## Goal

Refactor the AI hook factory so credit availability is checked **per `execute()` call against a real cost estimate**, not once per hook instance against a `> 0` heuristic. Wire the new options through all 9 hook call sites in the router. Prevent batch hooks from silently degrading to local execution.

## Scope

In scope:

- `lib/ai/client/hook-factory.ts` (~179 lines) — add `AIHookOptions<TParams>` to the factory signature; remove the local `resolveCreditsAvailability`; move the credit availability call inside `execute()` so it sees actual params; gate the smart-mode local fallback with `options.allowSmartLocalFallback !== false`; remove `AIPlanEntitlementError` residue.
- `lib/ai/client/mode-routing.ts` — re-point its `resolveCreditsAvailability` re-export at the slice-01 primitive in `lib/credits/availability.ts`. Other resolvers (`resolveExecutionDecision`, `shouldRetrySmartWithLocalFallback`, `resolveModeConfigurability`, `resolveErrorCode`) are unchanged.
- `lib/ai/client/router.ts` (~120 lines) — add options arg to all 9 `createAIHook(...)` calls. Single ops get fixed `estimateCredits: () => ESTIMATED_CREDITS_PER_QUERY`. The two batch hooks (`useBatchScreeningResponses`, `useBatchTranslations`) get dynamic `estimateCredits: (params) => Math.ceil(params.papers.length * ESTIMATED_CREDITS_PER_PAPER)` and `useBatchScreeningResponses` additionally sets `allowSmartLocalFallback: false`.
- `tests/ai-mode-routing.test.ts` — add the two missing `resolveCreditsAvailability` cases.

Out of scope:

- Server-side action signatures (slice 03 owns those).
- The chat hook surface — chat uses raw `useMutation`, not `createAIHook`. Cross-stack alignment is out of scope (architectural overlap is documented as a follow-up in the README).
- `useBatchTranslations` getting `allowSmartLocalFallback: false` — not strictly required (translation falls back to local less destructively than screening) but worth a one-line follow-up note in the README.

## Design

### `AIHookOptions<TParams>` interface

Add to `lib/ai/client/hook-factory.ts`:

```text
export interface AIHookOptions<TParams> {
  estimateCredits?: (params: TParams) => number
  allowSmartLocalFallback?: boolean
}
```

### `createAIHook` signature

Add `options: AIHookOptions<TParams> = {}` as the 4th parameter. Reference at `/tmp/openalex-main-inspect/lib/ai/client/hook-factory.ts:73`.

### Per-execution credit check

Remove the existing `useMemo` for `creditsAvailability` (currently around `hook-factory.ts:85-93`). Inside the `useCallback` that defines `execute(params)`:

```text
const requiredCredits = Math.max(
  0,
  Math.ceil(options.estimateCredits?.(params) ?? ESTIMATED_CREDITS_PER_QUERY),
)
const creditsAvailability = resolveCreditsAvailability({
  totalCredits: creditsQuery.data?.total,
  requiredCredits,
  settlement: creditsQuery.settlement,
  isAuthenticated,
})
```

Add `options.estimateCredits` and `options.allowSmartLocalFallback` to the `useCallback` dependency array.

Import `ESTIMATED_CREDITS_PER_QUERY` from `@/convex/lib/constants` (the constant at `convex/lib/constants.ts:25`, value `2`). Import `resolveCreditsAvailability` from `@/lib/credits/availability` (slice 01).

### Smart-local fallback gate

The catch block currently runs the local executor on recognized error codes (`AI_UNAUTHENTICATED`, `AI_INSUFFICIENT_CREDITS`, etc.) when mode is `smart` and a local key exists. Wrap the entire fallback branch with:

```text
if (options.allowSmartLocalFallback !== false && /* existing conditions */) {
  return runLocal(params)
}
throw error  // re-throw if fallback denied
```

Reference at `/tmp/openalex-main-inspect/lib/ai/client/hook-factory.ts:138`.

### Cleanup — remove `AIPlanEntitlementError` residue

The dev branch removed plan-tier checks from the AI op critical path but leaves `AIPlanEntitlementError` import at `lib/ai/client/hook-factory.ts:12` and a reference at `:85`. Reference (post-Apr-25) removed both. Delete in this slice.

### Router options wiring — `lib/ai/client/router.ts`

Import constants:

```text
import { ESTIMATED_CREDITS_PER_PAPER, ESTIMATED_CREDITS_PER_QUERY } from "@/convex/lib/constants"
```

For each of the 7 single-op hooks (lines 40-72):

```text
{ estimateCredits: () => ESTIMATED_CREDITS_PER_QUERY }
```

For `useBatchScreeningResponses` (`router.ts:74`):

```text
{
  allowSmartLocalFallback: false,
  estimateCredits: (params) => Math.ceil(params.papers.length * ESTIMATED_CREDITS_PER_PAPER),
}
```

For `useBatchTranslations` (`router.ts:91`):

```text
{
  estimateCredits: (params) => Math.ceil(params.papers.length * ESTIMATED_CREDITS_PER_PAPER),
}
```

(Translation does not opt out of fallback; it's safe enough for the local executor and we want consistency with the existing UX. Document this asymmetry in a one-line code comment.)

### Mode-routing barrel update

`lib/ai/client/mode-routing.ts` currently exports nothing called `resolveCreditsAvailability` (per agent 4 audit). Add a re-export from the slice-01 primitive so existing test infrastructure and any external callers (`tests/ai-mode-routing.test.ts`) can keep importing from this path:

```text
export { resolveCreditsAvailability } from "@/lib/credits/availability"
```

Or, alternatively, the test file can import directly from `@/lib/credits/availability` and the mode-routing re-export is skipped. Pick the path with fewer downstream changes — the test file already exists with assertions that import from `mode-routing`, so re-export keeps those imports working.

## TDD Sequence

Phase A — pure logic, write tests first, commit per green:

1. RED: in `tests/ai-mode-routing.test.ts`, add a new `describe("resolveCreditsAvailability", ...)` block. Test name 1: "compares balance against the required credit estimate" — covers `totalCredits = 5, requiredCredits = 10` → `"unavailable"` and `totalCredits = 100, requiredCredits = 10` → `"available"`. Test name 2: "keeps unsettled balances unknown instead of guessing from zero" — covers `settlement = "loading"` → `"unknown"` regardless of `totalCredits` value. Reference at `/tmp/openalex-main-inspect/tests/ai-mode-routing.test.ts:11-42`.
2. GREEN: re-export `resolveCreditsAvailability` from `lib/ai/client/mode-routing.ts` (slice 01 already implemented the function). **Commit:** `feat(ai-routing): [plan-04] re-export resolveCreditsAvailability from mode-routing`.

Phase B — factory + router integration, commit per logical unit:

3. Add `AIHookOptions<TParams>` interface to `lib/ai/client/hook-factory.ts`. Add the options parameter to `createAIHook`. Remove the `useMemo` for `creditsAvailability` and move the call inside `execute()`. Remove `AIPlanEntitlementError` residue. Run existing tests in `tests/ai-mode-routing.test.ts` and `tests/ai-credit-preflight.test.ts`. **Commit:** `refactor(ai-hook): [plan-04] move credits check inside execute and add options`.
4. Gate the smart-mode local fallback with `options.allowSmartLocalFallback !== false`. Add a focused unit test for this branch (mock `runLocal` and assert it's not called when the option is false and the catch path triggers). **Commit:** `feat(ai-hook): [plan-04] honor allowSmartLocalFallback option`.
5. Wire options into all 9 `createAIHook` calls in `lib/ai/client/router.ts`. Import constants from `@/convex/lib/constants`. **Commit:** `feat(ai-router): [plan-04] thread estimate options through all hooks`.
6. Verify the full `vitest run` is green. Verify pm2 next.js logs show no compile errors. **Commit if any cleanup needed.**

## Files Touched

- [lib/ai/client/hook-factory.ts](../../lib/ai/client/hook-factory.ts) — add options interface and parameter, move credit check, remove `AIPlanEntitlementError`, add fallback gate.
- [lib/ai/client/router.ts](../../lib/ai/client/router.ts) — wire options on all 9 hooks; import constants.
- [lib/ai/client/mode-routing.ts](../../lib/ai/client/mode-routing.ts) — re-export `resolveCreditsAvailability` from `lib/credits/availability`.
- [tests/ai-mode-routing.test.ts](../../tests/ai-mode-routing.test.ts) — add 2 cases for `resolveCreditsAvailability`.

## Migration Stance

None. Pure client refactor; no schema changes; no wire changes server-side.

## Test Plan

- Unit: 2 new cases in `tests/ai-mode-routing.test.ts`.
- Unit: 1 new case for `allowSmartLocalFallback: false` blocking the fallback path.
- Existing tests in `tests/ai-mode-routing.test.ts` for `resolveModeConfigurability`, `resolveExecutionDecision`, smart fallback, and `resolveErrorCode` continue to pass.
- Existing tests in `tests/ai-credit-preflight.test.ts` continue to pass.
- `tsc` and Next.js compilation green.
- pm2 next.js logs clean after restart.

## Acceptance Criteria

- `createAIHook` signature has `options: AIHookOptions<TParams> = {}` as the 4th argument.
- The credit availability check fires inside `execute(params)` with the actual `params`.
- `options.estimateCredits` is called per execute; defaults to `() => ESTIMATED_CREDITS_PER_QUERY`.
- `options.allowSmartLocalFallback` defaults to allowed; setting `false` blocks the catch-block fallback.
- All 9 hook call sites in `router.ts` pass options. The two batch hooks compute estimate from `params.papers.length`.
- `useBatchScreeningResponses` sets `allowSmartLocalFallback: false`.
- `tests/ai-mode-routing.test.ts` is green with 4 (was 2) `resolveCreditsAvailability` assertions.
- No `AIPlanEntitlementError` references remain in `hook-factory.ts`.
- Full `vitest run` green; `tsc` green; Next.js compile green.

## Known Pitfalls

- Moving `resolveCreditsAvailability` call into `execute()` means it runs synchronously inside the user's click handler. If `creditsQuery.data` is stale (subscription hasn't refreshed), the check uses stale data. This is acceptable — the server lock + per-item ledger are the source of truth; the client check is UX (fast-fail before round-trip). Reference accepts the same staleness.
- `options.estimateCredits` is invoked with the live `params` object. Implementations must be pure and synchronous. Do not perform IO inside.
- Do **not** memoize `resolveCreditsAvailability(...)` result by `params`. Each `execute` call is a fresh decision; memoization would defeat the purpose of moving it out of the hook-instance memo.
- The `ESTIMATED_CREDITS_PER_QUERY` import path is `@/convex/lib/constants` — works in client code because the module is plain TypeScript (no Convex runtime imports). Do **not** create a duplicate constants file at `lib/ai/core/constants.ts`.
- The `Math.max(0, Math.ceil(...))` clamp prevents a negative or fractional `requiredCredits` from breaking the comparison. The reference does this; preserve it.
- Ensure the dependency array of the `execute` `useCallback` includes `options.estimateCredits` and `options.allowSmartLocalFallback`. Otherwise React will close over stale option closures across re-renders. Reference behavior at `/tmp/openalex-main-inspect/lib/ai/client/hook-factory.ts:167-169`.
- The mode-routing re-export is for backward compatibility of test imports. If the test file is updated to import directly from `@/lib/credits/availability`, the re-export can be skipped — choose one and document the choice in the commit message.
- Removing the `AIPlanEntitlementError` import is destructive cleanup per CLAUDE.md rule 3. Verify no other module imports it from `hook-factory.ts` (it shouldn't; it's a one-file residue).
