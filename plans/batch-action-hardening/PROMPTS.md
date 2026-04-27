# Copy-Paste Execution Prompts

One fenced prompt per numbered plan. Each prompt is self-contained and assumes a fresh `/clear`'d session.

```md
Plan file: plans/batch-action-hardening/01-shared-credit-primitive.md
Context README: plans/batch-action-hardening/00-README.md

Long-running autonomous task. Expect 1-2 hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, choose the option most consistent with the pure-function contract and the existing dev billing infrastructure, and document the choice in the commit message.

STANDING RULES
1. DRY with named donors: `convex/ai/helpers.ts` (the three gate sites), `tests/ai-credit-preflight.test.ts` (existing shadow `wouldRejectBatch`), `lib/credits/feature-flags.ts` (sibling in target directory).
2. No legacy: do not leave the inline `balance.total < required` comparison anywhere in `convex/ai/helpers.ts` after this plan.
3. Convex guidelines override training data: read `convex/_generated/ai/guidelines.md` before touching Convex code.
4. Testing doctrine per CLAUDE.md: pure-function unit tests first; assert on returned values; never on import paths or class strings.
5. Research before guessing: re-read the plan file when in doubt about which sites are in scope vs deferred.
6. Zero type errors is non-negotiable. `tsc` and Convex typecheck must be green at every commit.
7. Delegate to subagents for bounded investigation beyond trivial local file reads.
8. Out-of-scope sites (`convex/chat/messages.ts:364`, `convex/extraction/workpoolActions.ts:1276`, `convex/screening/mutations.ts:90`) are intentional. Do not opportunistically replace them.

EXECUTION RHYTHM
Phase A: TDD the pure helpers (`hasEnoughCredits`, `resolveCreditsAvailability`) in `tests/credits-availability.test.ts`. Commit per green.
Phase B:
1. Replace inline gate at `convex/ai/helpers.ts:247` (`withAuthAndCreditsBatch`).
2. Replace inline gate at `convex/ai/helpers.ts:362` (`withUserCreditsBatch`).
3. Replace inline gate at `convex/ai/helpers.ts:490` (`withAuthAndCredits`).
4. Re-point `tests/ai-credit-preflight.test.ts:75-113` shadow function at the primitive.
Commit per logical unit.

COMMIT DISCIPLINE
- Use conventional commits with `[plan-01]`.
- One commit per TDD green in Phase A.
- One commit per logical unit in Phase B.
- Never commit with tests red.
- Never use hook bypass flags (`--no-verify`, `--no-gpg-sign`).
- Do not push unless the user explicitly asks.

WHEN TO STOP
Stop only when the acceptance criteria in the plan file are satisfied and the full `vitest run` is green.
You may NOT stop for: ambiguity resolvable by re-reading the plan, token anxiety, or impulse to check with the user about already-locked scope decisions.

DEVIATIONS
If the plan is wrong or incomplete:
1. Commit any in-progress work cleanly.
2. Edit the plan file first.
3. Commit the plan edit as `docs: [plan-01] revise <section> — <reason>`.
4. Proceed against the revised plan.

START NOW
1. Read `plans/batch-action-hardening/00-README.md`.
2. Read `plans/batch-action-hardening/01-shared-credit-primitive.md`.
3. Read `convex/_generated/ai/guidelines.md`.
4. Check `git status` (must be clean before starting).
5. Begin the first red test for `hasEnoughCredits`.

Go.
```

```md
Plan file: plans/batch-action-hardening/02-batch-partial-helper.md
Context README: plans/batch-action-hardening/00-README.md

Long-running autonomous task. Expect 30-60 minutes. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, choose the option most consistent with the existing `BatchResult<TData>` shape at `lib/ai/core/batch-types.ts:18-26` and document the choice in the commit message.

STANDING RULES
1. DRY with named donors: `lib/ai/core/batch-types.ts` (existing `BatchResult` shape), `lib/ai/core/index.ts` (existing barrel export pattern), `tests/ai-batch.test.ts` (existing test file structure).
2. No legacy: the helper is co-located with its constant; do not put `BATCH_ITEM_INSUFFICIENT_CREDITS_ERROR` in `convex/lib/errors.ts`.
3. Convex guidelines override training data: read `convex/_generated/ai/guidelines.md` if you touch any Convex file (you should not in this plan).
4. Testing doctrine per CLAUDE.md: pure-function unit tests; assert on returned object structure (results keys, errors content); never on class strings or string equality of the constant.
5. Research before guessing: the reference at `/tmp/openalex-main-inspect/lib/ai/core/batch-partial.ts` defines the exact shape; consult it for ambiguity.
6. Zero type errors is non-negotiable. The polymorphic generic `<T extends BatchResultLike>` must compile clean against existing batch consumers.
7. Delegate to subagents only if you need to map every consumer of `BatchResult` across the repo.

EXECUTION RHYTHM
Phase A: TDD the two new test cases in `tests/ai-batch.test.ts` for `applyUnpaidBatchItemErrors`. Commit per green.
Phase B:
1. Add the barrel re-export to `lib/ai/core/index.ts`.
Commit as one logical unit.

COMMIT DISCIPLINE
- Use conventional commits with `[plan-02]`.
- One commit per TDD green in Phase A.
- One commit per logical unit in Phase B.
- Never commit with tests red.
- Never use hook bypass flags.
- Do not push unless the user explicitly asks.

WHEN TO STOP
Stop only when the acceptance criteria are satisfied and the full `vitest run` is green.
You may NOT stop for: ambiguity resolvable by re-reading the plan, token anxiety, or worry about whether the constant name "should be" different.

DEVIATIONS
If the plan is wrong or incomplete:
1. Commit any in-progress work cleanly.
2. Edit the plan file first.
3. Commit the plan edit as `docs: [plan-02] revise <section> — <reason>`.
4. Proceed against the revised plan.

START NOW
1. Read `plans/batch-action-hardening/00-README.md`.
2. Read `plans/batch-action-hardening/02-batch-partial-helper.md`.
3. Read `lib/ai/core/batch-types.ts` (the type donor) and `lib/ai/core/index.ts` (the barrel donor).
4. Check `git status`.
5. Begin the first red test for `applyUnpaidBatchItemErrors`.

Go.
```

```md
Plan file: plans/batch-action-hardening/03-backend-hardening.md
Context README: plans/batch-action-hardening/00-README.md
Depends on plans 01 and 02 being merged.

Long-running autonomous task. Expect 4-6 hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, choose the option most consistent with the existing `convex/lib/rateLimit.ts` and `convex/lib/cascade.ts` primitives' shape and the dev billing infrastructure (typed `UsageBreakdownEntry`, `classifyUnknownError`, `captureServerEvent`). Document the choice in the commit message.

STANDING RULES
1. DRY with named donors: `convex/lib/rateLimit.ts` (sibling primitive pattern), `convex/credits/internal.ts` (`deductCreditsTransaction` and `deductCredits`), `lib/errors/taxonomy.ts` (`classifyUnknownError`), `lib/posthog-server.ts` (`captureServerEvent`), `lib/ai/core/batch-partial.ts` (slice 02), `lib/credits/availability.ts` (slice 01).
2. No legacy: do not introduce a new `isInsufficientCreditsError` predicate; do not write per-kind lock siblings; do not duplicate constants for client estimation.
3. Convex guidelines override training data: read `convex/_generated/ai/guidelines.md` BEFORE touching Convex code. Required reading for this plan.
4. Testing doctrine per CLAUDE.md: pure helpers (`collectBillableItemIds`) get unit tests; lock primitives get `convex-test` integration tests; behavior assertions only (lock rows exist, ledger writes match paid items, telemetry fired with expected payload). Never CSS classes.
5. Research before guessing: verify the actual shape of `UsageBreakdownEntry` and `Pricing` at `convex/ai/helpers.ts:197-218` before writing `collectBillableItemIds`.
6. Zero type errors is non-negotiable. Convex typecheck and `tsc` must be green at every commit.
7. Delegate to subagents for: mapping all `withAuthAndCreditsBatch` callers; confirming no other table conflicts with `userResourceLocks`; verifying the rate-limit `consume` validator union shape across Convex generated types.
8. Migration stance per CLAUDE.md: dev data is disposable. If the schema validator rejects existing rows, wipe `userResourceLocks` via the Convex dashboard. No backfills, no migrations, no widen-then-narrow.
9. The lock kind discriminator uses underscore form (`"batch_screening"`); the rate-limit bucket name uses hyphen form (`"batch-screening"`). This asymmetry matches the established conventions of each primitive — do not unify them.
10. The `release` mutation must run in `finally`. The rate-limit `consume` happens BEFORE lock acquire (fast-fail).

EXECUTION RHYTHM
Phase A: TDD the lock primitive (`acquireBatchLock`, `releaseBatchLock`, expiry semantics) in `convex/lib/locks.test.ts`. Commit per green.
Phase B:
1. Add `userResourceLocks` table to `convex/schema.ts` and verify pm2 Convex logs show clean deploy.
2. Add the two rate-limit buckets to `convex/lib/rateLimit.ts` and extend the `consume` name validator union.
3. Add `collectBillableItemIds` helper in `convex/ai/helpers.ts` with focused unit test.
4. Refactor `withAuthAndCreditsBatch` per-item loop with try/catch + salvage. Add a `convex-test` integration test for mid-batch credit exhaustion.
5. Wrap `generateBatchScreeningResponses` with auth → rate-limit → acquire → try/finally release. Add a `convex-test` integration test for concurrent attempts.
6. Wrap `generateBatchTranslations` identically with `kind: "batch_translation"`. Add a parallel integration test.
Commit per logical unit.

COMMIT DISCIPLINE
- Use conventional commits with `[plan-03]`.
- One commit per TDD green in Phase A.
- One commit per logical unit in Phase B.
- Never commit with tests red.
- Never use hook bypass flags.
- Do not push unless the user explicitly asks.

WHEN TO STOP
Stop only when the acceptance criteria are satisfied, all tests are green, Convex typecheck is green, and pm2 Convex logs show no schema or runtime errors after deploy.
You may NOT stop for: ambiguity about constant placement (constants live where the plan says), token anxiety, or impulse to ask the user whether translation parity should be deferred (the README locks it as included).

DEVIATIONS
If the plan is wrong or incomplete:
1. Commit any in-progress work cleanly.
2. Edit the plan file first.
3. Commit the plan edit as `docs: [plan-03] revise <section> — <reason>`.
4. Proceed against the revised plan.

If the schema deploy is rejected for an unforeseen reason (existing field collision, generated types mismatch), write `plans/batch-action-hardening/03-BLOCKER.md` with the exact failure and stop — do not improvise around the schema validator.

START NOW
1. Read `plans/batch-action-hardening/00-README.md`.
2. Read `plans/batch-action-hardening/03-backend-hardening.md`.
3. Read `convex/_generated/ai/guidelines.md`.
4. Read `convex/ai/helpers.ts:197-218` (the `UsageBreakdownEntry` shape) and `convex/ai/helpers.ts:226-335` (the current `withAuthAndCreditsBatch` shape).
5. Read `convex/lib/rateLimit.ts` (the sibling primitive pattern).
6. Check `git status`.
7. Begin the first red test for `acquireBatchLock`.

Go.
```

```md
Plan file: plans/batch-action-hardening/04-client-hook-factory.md
Context README: plans/batch-action-hardening/00-README.md
Depends on plan 01 being merged.

Long-running autonomous task. Expect 2-3 hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, choose the option most consistent with React `useCallback` semantics (stable closure over options via dependency array) and the existing `lib/ai/client/` module structure. Document the choice in the commit message.

STANDING RULES
1. DRY with named donors: `lib/credits/availability.ts` (slice 01), `convex/lib/constants.ts` (`ESTIMATED_CREDITS_PER_PAPER`, `ESTIMATED_CREDITS_PER_QUERY`), `lib/ai/client/executor.ts` (existing `clientExecutor` callsite), `lib/ai/client/mode-routing.ts` (existing exports).
2. No legacy: remove `AIPlanEntitlementError` import and reference from `lib/ai/client/hook-factory.ts`. Do not preserve plan-tier checking residue.
3. Convex guidelines override training data: read `convex/_generated/ai/guidelines.md` if you touch any Convex file (you should not in this plan).
4. Testing doctrine per CLAUDE.md: pure-function unit tests for `resolveCreditsAvailability`; behavior assertions for `allowSmartLocalFallback: false` (assert `runLocal` was not called); never assert on hook internals.
5. Research before guessing: the reference at `/tmp/openalex-main-inspect/lib/ai/client/hook-factory.ts` and `lib/ai/client/router.ts` show the exact options shape and call-site wiring; consult for ambiguity.
6. Zero type errors is non-negotiable. The new `AIHookOptions<TParams>` generic must compile clean against all 9 hook call sites in `router.ts`. The Convex `api.ai.actions.*` `_args` types determine `TParams` per hook.
7. Delegate to subagents for: confirming no other module imports `AIPlanEntitlementError` from `hook-factory.ts`; mapping any other consumers of `createAIHook` outside `router.ts` (there shouldn't be any).
8. The `estimateCredits` callback runs synchronously inside `execute()`. It must be pure — no IO, no async, no React hook calls.
9. The `useCallback` dependency array must include `options.estimateCredits` and `options.allowSmartLocalFallback`. Otherwise stale closures across re-renders.
10. The `Math.max(0, Math.ceil(...))` clamp on `requiredCredits` is required (negative or fractional estimates would break the comparison).

EXECUTION RHYTHM
Phase A: TDD the two `resolveCreditsAvailability` cases in `tests/ai-mode-routing.test.ts`. Commit per green.
Phase B:
1. Add `AIHookOptions<TParams>` interface and the options parameter to `createAIHook`. Move credit check inside `execute()`. Remove `AIPlanEntitlementError` residue.
2. Gate the smart-mode local fallback with `options.allowSmartLocalFallback !== false`. Add a focused unit test asserting `runLocal` is not invoked when the option is false.
3. Wire options into all 9 `createAIHook` calls in `lib/ai/client/router.ts`. Import constants from `@/convex/lib/constants`.
Commit per logical unit.

COMMIT DISCIPLINE
- Use conventional commits with `[plan-04]`.
- One commit per TDD green in Phase A.
- One commit per logical unit in Phase B.
- Never commit with tests red.
- Never use hook bypass flags.
- Do not push unless the user explicitly asks.

WHEN TO STOP
Stop only when the acceptance criteria are satisfied, all 4 (was 2) `resolveCreditsAvailability` test cases pass, the full `vitest run` is green, and pm2 next.js logs show no compile or runtime errors.
You may NOT stop for: ambiguity about whether `useBatchTranslations` should also opt out of fallback (the plan says no, with a one-line code comment), token anxiety, or worry about chat parity (chat is out of scope per README).

DEVIATIONS
If the plan is wrong or incomplete:
1. Commit any in-progress work cleanly.
2. Edit the plan file first.
3. Commit the plan edit as `docs: [plan-04] revise <section> — <reason>`.
4. Proceed against the revised plan.

START NOW
1. Read `plans/batch-action-hardening/00-README.md`.
2. Read `plans/batch-action-hardening/04-client-hook-factory.md`.
3. Read `lib/ai/client/hook-factory.ts` and `lib/ai/client/router.ts` end-to-end on dev.
4. Read `lib/credits/availability.ts` (slice 01 product) and `convex/lib/constants.ts`.
5. Check `git status`.
6. Begin the first red test for `resolveCreditsAvailability`.

Go.
```

```md
Plan file: plans/batch-action-hardening/05-hooks-and-ui.md
Context README: plans/batch-action-hardening/00-README.md
Depends on plan 04 being merged. Benefits from plan 03 being live (so the alert has real errors to render).

Long-running autonomous task. Expect 4-6 hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, choose the option most consistent with the existing `ChatErrorAlert` pattern, `useUIStore` slice conventions, and `useBatchOperation`/`useBatchTranslation` factory shape. Document the choice in the commit message.

STANDING RULES
1. DRY with named donors: `components/extraction/chat/chat-error-alert.tsx` (UX template), `parseChatError` (taxonomy parser), `lib/store.ts` (`useUIStore.screeningPanelOpenBySearchId` slice), `messages/en-US.json:588,609` (i18n keys), `components/results-contexts.ts` (context shape donor), `hooks/use-batch-operation.ts` (factory pattern).
2. No legacy: delete `beforeExecute` from `useBatchOperation` entirely; delete the dead `errors` field from `ScreeningContextValue`; do not add a `beforeGuards` companion hook.
3. Convex guidelines override training data: read `convex/_generated/ai/guidelines.md` if you touch any Convex file (you should not in this plan beyond optional read for context).
4. Testing doctrine per CLAUDE.md: assert on `getByRole("alert")`, `data-error-code`, `data-action="retry-batch"`, `aria-pressed`, hook return shapes. Never CSS class strings. Never JSDOM layout assertions.
5. Research before guessing: confirm `parseChatError` accepts the screening error wire shape before assuming compatibility; widen it if necessary.
6. Zero type errors is non-negotiable. `tsc`, Next.js compile, and the full `vitest run` must be green at every commit.
7. Delegate to subagents for: confirming no other consumer reads `ScreeningContextValue.errors` (deletion safety); mapping `useBatchOperation` consumers across the codebase before deleting `beforeExecute`; verifying i18n key parity across all 6 locale files.
8. The `useUIStore` selector for the panel-open slice must use a stable primitive selector: `(s) => s.screeningPanelOpenBySearchId[searchId] ?? false`. Do not return objects that would re-render on every store mutation.
9. The render slot for `ScreeningErrorAlert` is above the results grid in `results-list.tsx` (where `LoadingResults variant="banner"` already lives). Do not put it inside the screening panel — the user must see the error when the panel is collapsed.
10. The `manualRunRequestId` consumption move requires two new sites: inside `handleResult` and a focused effect for the all-cached case. Do not collapse them into one — the all-cached path needs its own dependency array.

EXECUTION RHYTHM
Phase A: TDD `buildScreeningBatchKey` extraction in `tests/use-batch-screening-key.test.ts`. Commit per green.
Phase B:
1. Delete `beforeExecute` from `useBatchOperation`. Refactor `useBatchTranslation` consumption into `handleResult` + the all-cached effect. Add unit test.
2. Add `queuedLoadingBatchKeyRef`, `settledBatchVersion`, and the dedup branch in `useBatchOperation`. Add unit test.
3. Add `retryFailedItems?: boolean` option in `useBatchOperation`. Add unit test.
4. Refactor `useBatchScreening` to accept `questionSetKey`, switch `contextId`, pass `retryFailedItems: false`.
Phase C:
5. Create `components/screening/screening-error-alert.tsx` with component test.
6. Wire alert into `results-list.tsx` above results grid.
7. Add `isScreeningPanelOpen` to `ScreeningContextValue`; thread from `useUIStore` through `useScreening` to paper-card.
8. Gate `useBatchScreening`'s `canStart` on `isScreeningPanelOpen`.
9. Gate paper-card screening rendering on `isScreeningPanelOpen`.
10. Remove dead `errors` field from `ScreeningContextValue`.
Commit per logical unit.

COMMIT DISCIPLINE
- Use conventional commits with `[plan-05]`.
- One commit per TDD green in Phase A.
- One commit per logical unit in Phases B and C.
- Never commit with tests red.
- Never use hook bypass flags.
- Do not push unless the user explicitly asks.

WHEN TO STOP
Stop only when the acceptance criteria are satisfied: all unit and component tests green, no `beforeExecute` references remain in the codebase, no dead `errors` field remains in `ScreeningContextValue`, the inline alert renders for insufficient-credits errors with retry + billing CTAs, the screening panel actually gates work, `tsc` and Next.js compile clean, pm2 next.js logs are clean.
You may NOT stop for: ambiguity about whether to use a toast (the README locks the inline alert decision), token anxiety, or worry about whether `parseChatError` will accept screening errors (test it; widen if needed).

DEVIATIONS
If the plan is wrong or incomplete:
1. Commit any in-progress work cleanly.
2. Edit the plan file first.
3. Commit the plan edit as `docs: [plan-05] revise <section> — <reason>`.
4. Proceed against the revised plan.

If `parseChatError` cannot be made compatible with the screening error wire shape without major refactoring, write `plans/batch-action-hardening/05-BLOCKER.md` with the exact incompatibility and stop.

START NOW
1. Read `plans/batch-action-hardening/00-README.md`.
2. Read `plans/batch-action-hardening/05-hooks-and-ui.md`.
3. Read `components/extraction/chat/chat-error-alert.tsx` end-to-end (the UX template).
4. Read `hooks/use-batch-operation.ts`, `hooks/use-batch-translation.ts`, `hooks/use-batch-screening.ts` end-to-end on dev.
5. Read `components/results-contexts.ts` and `components/results-list.tsx:380-470` (the context provider region).
6. Check `git status`.
7. Begin the first red test for `buildScreeningBatchKey`.

Go.
```
