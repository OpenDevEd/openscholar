# Plan 01 — Shared Credit-Availability Primitive

**Depends on:** nothing. **Blocks:** 03, 04.

## Goal

Extract the duplicated `balance.total < required` comparison into a single pure-function primitive consumed by both client and server, and replace the three identical inlinings in the AI helper trio. Establishes the foundation that slice 03 (backend salvage) and slice 04 (client per-execution credit check) both build on.

## Scope

In scope:

- New module `lib/credits/availability.ts` with two pure exports:
  - `hasEnoughCredits({ balance, required }): boolean`
  - `resolveCreditsAvailability({ totalCredits, requiredCredits, settlement, isAuthenticated }): "available" | "unavailable" | "unknown"`
- New unit test file `tests/credits-availability.test.ts`.
- Replacement of inline `balance.total < required` at three sites in `convex/ai/helpers.ts`:
  - `:247` (`withAuthAndCreditsBatch`)
  - `:362` (`withUserCreditsBatch`)
  - `:490` (`withAuthAndCredits`)
- Re-pointing `tests/ai-credit-preflight.test.ts:75-113` from its shadow `wouldRejectBatch` function to the new primitive (the test becomes a real contract test, not a copy).

Out of scope:

- `convex/chat/messages.ts:364` — file is in active churn under the `chat-exact-stop-billing` plan; touching it now causes merge conflict. Tracked as follow-up.
- `convex/extraction/workpoolActions.ts:1276` — wraps in `handleCreditsExhaustionAndRethrow`, needs separate design.
- `convex/screening/mutations.ts:90` — mutation context, uses `freeBalance + paidBalance` arithmetic, throws plain `INSUFFICIENT_CREDITS` (not `AI_` prefix). Different shape; deferred.
- The client-side consumer of `resolveCreditsAvailability`. Slice 04 wires it into `lib/ai/client/hook-factory.ts`.

## Design

1. **`hasEnoughCredits` is a pure boolean.** Signature: `({ balance, required }: { balance: { total: number } | null | undefined; required: number }): boolean`. Returns `false` when `balance` is null/undefined. Compares `balance.total >= required`. **No side effects, no throws, no telemetry.**

2. **`resolveCreditsAvailability` is the routing-decision form.** Signature: `({ totalCredits, requiredCredits, settlement, isAuthenticated }: { totalCredits: number | undefined; requiredCredits: number; settlement: "loading" | "settled" | "error"; isAuthenticated: boolean }): "available" | "unavailable" | "unknown"`.
   - When `!isAuthenticated` or `settlement !== "settled"`, return `"unknown"`.
   - When settled and `(totalCredits ?? 0) >= requiredCredits`, return `"available"`.
   - Otherwise return `"unavailable"`.
   - This is the contract slice 04 needs. Mirrors the reference at `/tmp/openalex-main-inspect/lib/ai/client/mode-routing.ts:73-86`.

3. **Module location is `lib/credits/availability.ts`.** The directory `lib/credits/` already exists (`lib/credits/feature-flags.ts`). Both Convex code (server actions) and React code (hooks) import from this path with no runtime concerns — it is pure TypeScript with no Convex or DOM dependencies.

4. **The three AI helper gates compose the primitive but keep their existing behavior.** Each call site replaces `if (!balance || balance.total < required) {` with `if (!hasEnoughCredits({ balance, required })) {`. The structured `createError("AI_INSUFFICIENT_CREDITS", ...)` throw and the `captureServerEvent("credits_insufficient", { required, available, feature })` emit are unchanged. **Wire shape and observable behavior must be byte-identical.**

5. **`tests/ai-credit-preflight.test.ts` re-point.** The existing shadow function `wouldRejectBatch(balance, minimumRequired)` (`:75-113`) literally encodes the same contract. After the primitive lands, replace the shadow with a direct import: `import { hasEnoughCredits } from "@/lib/credits/availability"; const wouldRejectBatch = (balance, required) => !hasEnoughCredits({ balance, required });`. Existing assertions remain unchanged. The test becomes a contract test for the primitive, eliminating duplication (CLAUDE.md rule 3).

## TDD Sequence

Phase A — pure logic, write tests first, commit per green:

1. RED: `tests/credits-availability.test.ts` for `hasEnoughCredits`:
   - returns `false` when balance is `null`.
   - returns `false` when balance is `undefined`.
   - returns `false` when `balance.total < required`.
   - returns `true` when `balance.total === required`.
   - returns `true` when `balance.total > required`.
   - handles `required === 0` (returns `true` for any non-null balance).
2. GREEN: implement `hasEnoughCredits` in `lib/credits/availability.ts`. **Commit:** `feat(credits): [plan-01] add hasEnoughCredits primitive`.
3. RED: extend the same test file for `resolveCreditsAvailability`:
   - returns `"unknown"` when `!isAuthenticated`.
   - returns `"unknown"` when `settlement === "loading"`.
   - returns `"unknown"` when `settlement === "error"`.
   - returns `"unavailable"` when settled, authenticated, and `totalCredits < requiredCredits`.
   - returns `"unavailable"` when settled, authenticated, and `totalCredits` is `undefined`.
   - returns `"available"` when settled, authenticated, and `totalCredits >= requiredCredits`.
   - explicit case: `totalCredits = 5, requiredCredits = 10` → `"unavailable"` (the bug-class the `> 0` check missed).
4. GREEN: implement `resolveCreditsAvailability`. **Commit:** `feat(credits): [plan-01] add resolveCreditsAvailability primitive`.

Phase B — integration, commit per logical unit:

5. Replace the inline gate in `convex/ai/helpers.ts:247` (`withAuthAndCreditsBatch`). Run `tests/ai-credit-preflight.test.ts` and any direct helper tests. **Commit:** `refactor(ai): [plan-01] use hasEnoughCredits in withAuthAndCreditsBatch`.
6. Replace the inline gate in `convex/ai/helpers.ts:362` (`withUserCreditsBatch`). **Commit:** `refactor(ai): [plan-01] use hasEnoughCredits in withUserCreditsBatch`.
7. Replace the inline gate in `convex/ai/helpers.ts:490` (`withAuthAndCredits`). **Commit:** `refactor(ai): [plan-01] use hasEnoughCredits in withAuthAndCredits`.
8. Re-point `tests/ai-credit-preflight.test.ts:75-113` shadow function at the primitive. **Commit:** `test(credits): [plan-01] re-point preflight contract test at primitive`.

## Files Touched

- [lib/credits/availability.ts](../../lib/credits/availability.ts) (new)
- [tests/credits-availability.test.ts](../../tests/credits-availability.test.ts) (new)
- [convex/ai/helpers.ts](../../convex/ai/helpers.ts) (3 inline gate replacements)
- [tests/ai-credit-preflight.test.ts](../../tests/ai-credit-preflight.test.ts) (shadow replacement)

## Migration Stance

None. Pure refactor; same wire behavior; no schema changes.

## Test Plan

- Unit: 13 cases in `tests/credits-availability.test.ts` (6 for `hasEnoughCredits`, 7 for `resolveCreditsAvailability`).
- Contract: `tests/ai-credit-preflight.test.ts` continues to pass against the new primitive.
- Existing helper tests for `withAuthAndCreditsBatch`, `withUserCreditsBatch`, `withAuthAndCredits` continue to pass — observable behavior is unchanged.
- Convex typecheck and `tsc` green.

## Acceptance Criteria

- `lib/credits/availability.ts` exports both functions with the documented signatures.
- All 13 unit tests are green.
- The three AI helper sites use the primitive; no inline `balance.total < required` remains in `convex/ai/helpers.ts`.
- `tests/ai-credit-preflight.test.ts` imports the primitive (direct, not via shadow function) and is green.
- Convex typecheck, `tsc`, and the full `vitest run` are green.
- No regression in observable behavior at the three refactored sites (same `AI_INSUFFICIENT_CREDITS` throw, same PostHog event payload).

## Known Pitfalls

- The shadow function `wouldRejectBatch` in `tests/ai-credit-preflight.test.ts:75-113` returns `true` when balance is null. The primitive returns `false` from `hasEnoughCredits` when balance is null. The shadow's `wouldRejectBatch` is `!hasEnoughCredits`, so the contract is preserved — verify this on the re-point step.
- Do not extend the primitive to throw or emit. Callers compose. Adding side effects pollutes the pure-function contract and prevents reuse on the client (slice 04).
- Do not import from `convex/...` in `lib/credits/availability.ts`. The module must be import-safe from any context (Convex action, React component, Vitest unit test, Edge runtime). No Convex generated types, no `convexTest` fixtures, no `useQuery`.
- The `settlement` parameter on `resolveCreditsAvailability` is a string union — do not type it as `boolean`. The reference at `/tmp/openalex-main-inspect/lib/ai/client/mode-routing.ts:73-86` distinguishes `"loading"` from `"error"` even though both currently return `"unknown"`.
- Out-of-scope sites (`convex/chat/messages.ts:364`, etc.) are intentional. Do not opportunistically replace them — the README locks the scope and tracks them as follow-up.
