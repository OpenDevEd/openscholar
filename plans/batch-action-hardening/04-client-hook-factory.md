# Plan 04 — Client AI Hook-Factory + Router

**Depends on:** 01 (`hasEnoughCredits`, `resolveCreditsAvailability`). **Blocks:** 05.

## Goal

Refactor the AI hook factory so credit availability is checked **per `execute()` call against a real cost estimate**, not once per hook instance against a `> 0` heuristic. Wire the new options through all 9 hook call sites in the router. Prevent batch hooks from silently degrading to local execution.

## Scope

In scope:

- `lib/ai/client/hook-factory.ts` (~179 lines) — add `AIHookOptions<TParams>` to the factory signature; remove the local `resolveCreditsAvailability`; move the credit availability call inside `execute()` so it sees actual params; gate the smart-mode local fallback with `options.allowSmartLocalFallback !== false`; remove `AIPlanEntitlementError` residue.
- `lib/ai/client/mode-routing.ts` — re-point its `resolveCreditsAvailability` re-export at the slice-01 primitive in `lib/credits/availability.ts`. Other resolvers (`resolveExecutionDecision`, `shouldRetrySmartWithLocalFallback`, `resolveModeConfigurability`, `resolveErrorCode`) are unchanged.
- `lib/ai/client/router.ts` (~120 lines) — add options arg to all 8 `createAIHook(...)` calls (6 single-op + 2 batch; the plan originally said 9, corrected to actual count). Single ops get fixed `estimateCredits: () => ESTIMATED_CREDITS_PER_QUERY`. The two batch hooks (`useBatchScreeningResponses`, `useBatchTranslations`) get dynamic `estimateCredits: (params) => Math.ceil(params.papers.length * ESTIMATED_CREDITS_PER_PAPER)` and `useBatchScreeningResponses` additionally sets `allowSmartLocalFallback: false`.
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
const settlement: CreditsSettlement =
  creditsQuery.settlement === "ready" ? "settled" : "loading"
const creditsAvailability = resolveCreditsAvailability({
  totalCredits: creditsQuery.data?.total,
  requiredCredits,
  settlement,
  isAuthenticated,
})
```

Add `options.estimateCredits` and `options.allowSmartLocalFallback` to the `useCallback` dependency array.

Import `ESTIMATED_CREDITS_PER_QUERY` from `@/convex/lib/constants` (the constant at `convex/lib/constants.ts:25`, value `2`). Import `resolveCreditsAvailability` and `CreditsSettlement` from `@/lib/credits/availability` (slice 01) — re-exported through `lib/ai/client/mode-routing.ts` for grouped imports.

#### Settlement adapter — DEVIATION 04-A

Slice 01's `CreditsSettlement` type is the abstract `"loading" | "settled" | "error"` union (`lib/credits/availability.ts:12`). The actual `creditsQuery.settlement` value comes from `useOptionalAuthQuery` and is the auth-aware union `AuthQuerySettlement = "auth_loading" | "anonymous" | "query_loading" | "ready"` (`lib/auth/use-auth-query.ts:18`). Passing `creditsQuery.settlement` directly into `resolveCreditsAvailability` does **not** typecheck and would always return `"unknown"` (every auth-query value is `!== "settled"`).

The hook-factory is the integration boundary between auth-query and credit-availability domains, so the mapping lives at the call site. Mapping rule:

- `"ready"` → `"settled"` (query has loaded)
- everything else (`"auth_loading"`, `"anonymous"`, `"query_loading"`) → `"loading"`

The `"anonymous"` case is functionally irrelevant because `resolveCreditsAvailability` short-circuits to `"unknown"` when `!isAuthenticated`, and `resolveExecutionDecision` short-circuits to its own unauth branch before consulting availability. Mapping `"anonymous"` to `"loading"` is therefore safe.

**Why not widen slice 01's `CreditsSettlement` type?** The slice-01 plan locked the abstract `"loading" | "settled" | "error"` union deliberately. Widening it here would either reach into slice 01 (out of scope for plan 04) or duplicate the type. The adapter is the minimal, scoped fix.

### Smart-local fallback gate

The catch block currently runs the local executor on recognized error codes (`AI_UNAUTHENTICATED`, `AI_INSUFFICIENT_CREDITS`, etc.) when mode is `smart` and a local key exists. The reference inlines the gate as `options.allowSmartLocalFallback !== false && shouldRetrySmartWithLocalFallback({...})` (reference at `/tmp/openalex-main-inspect/lib/ai/client/hook-factory.ts:138`).

#### Pure-helper extraction — DEVIATION 04-B

Per CLAUDE.md testing philosophy ("Push pure logic out of the render tree and unit-test it directly"), the gated decision is extracted into a new pure helper in `lib/ai/client/mode-routing.ts`:

```text
export function resolveFallbackToLocal({
  allowSmartLocalFallback,
  mode,
  hasApiKey,
  errorCode,
}: {
  allowSmartLocalFallback?: boolean
  mode: AIKeyMode
  hasApiKey: boolean
  errorCode?: string
}): boolean {
  if (allowSmartLocalFallback === false) return false
  return shouldRetrySmartWithLocalFallback({ mode, hasApiKey, errorCode })
}
```

Hook-factory then calls:

```text
if (
  resolveFallbackToLocal({
    allowSmartLocalFallback: options.allowSmartLocalFallback,
    mode: apiKeyMode,
    hasApiKey,
    errorCode: fallbackCode,
  })
) {
  return await runLocal()
}
throw creditsError
```

This satisfies the plan's intent ("`runLocal` is not invoked when the option is false") without needing to mock `runLocal` inside a `renderHook` setup — when `resolveFallbackToLocal` returns `false`, the catch block re-throws and the local executor is unreachable by construction.

### Cleanup — remove `AIPlanEntitlementError` residue — DEVIATION 04-C (already done)

The dev branch removed plan-tier checks from the AI op critical path but the plan author believed `AIPlanEntitlementError` import remained at `lib/ai/client/hook-factory.ts:12` and a reference at `:85`. Verified during plan-04 execution: **the residue is already gone** from `hook-factory.ts` (only `AIApiKeyRequiredError`, `AICreditsDisabledError`, `AIInsufficientCreditsError` are imported now). The class itself (`lib/ai/core/errors.ts:40`) is still consumed by `convex/ai/helpers.ts:12,90` (server-side helper) and `lib/toast/error-resolver.ts:72`, both out of scope for plan 04. No-op for this slice; documented for the audit trail.

### Router options wiring — `lib/ai/client/router.ts`

Import constants:

```text
import { ESTIMATED_CREDITS_PER_PAPER, ESTIMATED_CREDITS_PER_QUERY } from "@/convex/lib/constants"
```

For each of the 6 single-op hooks (lines 40-72):

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

3. Add `AIHookOptions<TParams>` interface to `lib/ai/client/hook-factory.ts`. Add the options parameter to `createAIHook`. Remove the `useMemo` for `creditsAvailability` and move the call inside `execute()` with the settlement adapter (DEVIATION 04-A). `AIPlanEntitlementError` residue is already absent (DEVIATION 04-C); verify and skip. Run existing tests in `tests/ai-mode-routing.test.ts`, `tests/ai-credit-preflight.test.ts`, and `tests/credits-availability.test.ts`. **Commit:** `refactor(ai-hook): [plan-04] move credits check inside execute and add options`.
4. Add the pure helper `resolveFallbackToLocal` to `lib/ai/client/mode-routing.ts` and one focused unit test in `tests/ai-mode-routing.test.ts` asserting it returns `false` when `allowSmartLocalFallback === false` even with smart-eligible inputs (DEVIATION 04-B). Replace the inline gate in the hook-factory catch block with a call to this helper. **Commit:** `feat(ai-hook): [plan-04] honor allowSmartLocalFallback option`.
5. Wire options into all 8 `createAIHook` calls in `lib/ai/client/router.ts`. Import constants from `@/convex/lib/constants`. **Commit:** `feat(ai-router): [plan-04] thread estimate options through all hooks`.
6. Verify the full `vitest run` is green. Verify pm2 next.js logs show no compile errors. **Commit if any cleanup needed.**

## Files Touched

- [lib/ai/client/hook-factory.ts](../../lib/ai/client/hook-factory.ts) — add options interface and parameter, move credit check inside `execute()` with settlement adapter, gate fallback via `resolveFallbackToLocal`. (`AIPlanEntitlementError` cleanup is already done — see DEVIATION 04-C.)
- [lib/ai/client/router.ts](../../lib/ai/client/router.ts) — wire options on all 9 hooks; import constants.
- [lib/ai/client/mode-routing.ts](../../lib/ai/client/mode-routing.ts) — re-export `resolveCreditsAvailability` and `CreditsSettlement` from `lib/credits/availability`; add new pure helper `resolveFallbackToLocal`.
- [tests/ai-mode-routing.test.ts](../../tests/ai-mode-routing.test.ts) — add 2 cases for `resolveCreditsAvailability` (re-export contract) and 1 case for `resolveFallbackToLocal`.

## Migration Stance

None. Pure client refactor; no schema changes; no wire changes server-side.

## Test Plan

- Unit: 2 new cases in `tests/ai-mode-routing.test.ts` for `resolveCreditsAvailability` (covers re-export contract).
- Unit: 1 new case in `tests/ai-mode-routing.test.ts` for `resolveFallbackToLocal` asserting `allowSmartLocalFallback === false` short-circuits to `false` even with otherwise-eligible smart inputs (DEVIATION 04-B replaces the runLocal-mock approach).
- Existing tests in `tests/ai-mode-routing.test.ts` for `resolveModeConfigurability`, `resolveExecutionDecision`, smart fallback, and `resolveErrorCode` continue to pass.
- Existing tests in `tests/credits-availability.test.ts` (slice 01) continue to pass.
- Existing tests in `tests/ai-credit-preflight.test.ts` continue to pass.
- `tsc` and Next.js compilation green.
- pm2 next.js logs clean after restart.

## Acceptance Criteria

- `createAIHook` signature has `options: AIHookOptions<TParams> = {}` as the 4th argument.
- The credit availability check fires inside `execute(params)` with the actual `params`.
- `options.estimateCredits` is called per execute; defaults to `() => ESTIMATED_CREDITS_PER_QUERY`.
- `options.allowSmartLocalFallback` defaults to allowed; setting `false` blocks the catch-block fallback.
- All 8 hook call sites in `router.ts` pass options. The two batch hooks compute estimate from `params.papers.length`.
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
