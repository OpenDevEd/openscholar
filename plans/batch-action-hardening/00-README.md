# Batch-Action Hardening — Plan Set

Implementation plan set for **defense-in-depth on interactive batch AI actions** (`generateBatchScreeningResponses`, `generateBatchTranslations`). Closes the concurrency, partial-failure, and silent-error gaps currently present on `dev`.

Target contract:

1. Only one batch action of a given kind runs per user at a time. Concurrent attempts fail fast with a structured error.
2. Mid-batch credit exhaustion returns paid items as results and unpaid items as structured errors — never an all-or-nothing failure.
3. Insufficient credits surface to the user as an inline alert with retry + top-up affordances, not a silently swallowed context value.
4. The client-side hook factory checks credits **per execution against the actual cost estimate**, not once per hook against a `> 0` heuristic.
5. Per-user request-frequency caps protect both screening and translation from auto-fire storms.

This plan set is grounded in the current repo state on **April 27, 2026**, the existing dev billing infrastructure (chat plan-01 work), the `origin/main` reference at commits `1a6f67a1` ("Harden batch screening execution") and `fa6d1fc8` ("Fix batch operation guard ordering"), and the project's planning + testing doctrine in `CLAUDE.md`.

## Motivation / Gap Audit

Current verified gaps on dev (vs the hardened reference on `origin/main`):

1. **No per-user batch lock.** `generateBatchScreeningResponses` (`convex/ai/actions.ts:241-339`) and `generateBatchTranslations` (`convex/ai/actions.ts:147-235`) are public client-callable actions with no concurrency guard. The `screeningJobs.status="processing"` per-user guard in `convex/screening/mutations.ts:65-78` does **not** cover these actions because they don't insert a `screeningJobs` row. The chat thread lock in `convex/chat/concurrency.ts:67` is fused to `extractionJobs` columns and not reusable for AI batch flows.
2. **No rate-limit on batch AI actions.** `convex/lib/rateLimit.ts:48-69` defines five buckets (`start-extraction`, `api-key-save`, `checkout-session`, `wallet-generate`, `wallet-connect`) but none cover batch screening or batch translation.
3. **No mid-batch credit salvage.** `withAuthAndCreditsBatch` (`convex/ai/helpers.ts:226-335`) loops per-item but the per-item `deductCredits` call has no try/catch. The first `INSUFFICIENT_CREDITS` aborts the batch and discards already-completed work.
4. **Screening errors are silently swallowed.** `useBatchScreening` returns `errors` (`hooks/use-batch-screening.ts:143`); `results-list.tsx:450` puts them into `ScreeningContext.Provider.value.errors`; the only consumer of `useScreening` (`paper-card/hooks.ts:112-116`) destructures `missingResponses`, `existingResponses`, `loadingQuestions` only. **`errors` is never read by anyone.** Users see question spinners disappear with no explanation.
5. **Client credit check is `> 0`, not cost-aware.** `lib/ai/client/hook-factory.ts:43-59` defines a local `resolveCreditsAvailability` that only checks `totalCredits > 0`. A user with 1 credit appears "available" even when the batch needs 100. The check is also memoized once per hook instance, not computed per `execute()` call.
6. **No `allowSmartLocalFallback` opt-out for batch hooks.** Both batch hooks in `lib/ai/client/router.ts:74,91` inherit smart-mode local fallback. On a batch credits failure, the local executor would fan out N concurrent OpenAI calls from the browser using the user's local key — slow, expensive, and bypasses any server-side coordination.
7. **`beforeExecute` ordering bug surfaces translation manual-run wedge.** `hooks/use-batch-operation.ts:130-132` runs `if (isFetchingRef.current) return;` before `beforeExecute`. `useBatchTranslation:134-138` relies on `beforeExecute` to consume `manualRunRequestId` — when a fetch is in-flight, the consumption never happens and the manual-run state wedges.
8. **No `queuedLoadingBatchKeyRef` / `settledBatchVersion`.** A second batch (different `batchKey`) queued while the first is in-flight does not get a loading indicator until the first finishes; without `settledBatchVersion` bumping a dep, the effect may not re-run when the first settles.
9. **Constants are server-only despite client need.** `ESTIMATED_CREDITS_PER_PAPER` and `ESTIMATED_CREDITS_PER_QUERY` (`convex/lib/constants.ts:18,25`) are imported only by Convex code; the new client-side `estimateCredits` callback needs them too. The path resolves cleanly in client code (plain TS, no Convex runtime).
10. **The duplicated `balance.total < required` server gates are an established repo smell.** Three identical inlinings in `convex/ai/helpers.ts:247,362,490` plus shape-divergent siblings in `convex/chat/messages.ts:364`, `convex/extraction/workpoolActions.ts:1276`, `convex/screening/mutations.ts:90`. The pure-function shadow at `tests/ai-credit-preflight.test.ts:75-113` (`wouldRejectBatch`) already proves the contract — the primitive just hasn't been extracted.

## Locked Design Decisions

All decisions below are locked as of **April 27, 2026** unless a later numbered plan explicitly records a deviation.

1. **The lock primitive is generic from day one.** `userResourceLocks` table with a `kind` discriminator union. `kind: v.union(v.literal("batch_screening"), v.literal("batch_translation"))`. The acquire/release internalMutations take `kind` as an argument. **Do not** write per-kind sibling functions.
2. **The lock module lives at `convex/lib/locks.ts`**, parallel to `convex/lib/rateLimit.ts`. `convex/ai/` is for AI orchestration; `convex/lib/` is for shared primitives. Reference's location at `convex/ai/batchLocks.ts` is rejected.
3. **Lock cleanup is ad-hoc on acquire.** GC expired rows for the same `(userId, kind)` before inserting. No new cron entry. The table is sparse and the per-acquire cost is O(few). Pattern reused from `/tmp/openalex-main-inspect/convex/ai/batchLocks.ts:36-46`.
4. **Lock TTL is 10 minutes.** Matches reference; long enough for the longest realistic batch, short enough that a hung action self-recovers within a session.
5. **Translation and screening share all hardening.** Same lock kind union, same rate-limit buckets, same salvage path, same action-wrapping shape. Translation is more risk-prone than screening (auto-translate fires on every page mount + every language switch).
6. **The insufficient-credits predicate is `classifyUnknownError(err).code === "insufficient_credits"`.** Reuse `lib/errors/taxonomy.ts:151-161`. Do **not** introduce a new `isInsufficientCreditsError` helper; that would be the third such predicate in the repo.
7. **The mid-batch salvage uses a typed item id, not metadata.** `UsageBreakdownEntry` on dev (`convex/ai/helpers.ts:197-218`) has typed `paperId/resultId/jobId/billingType` as first-class fields. Read those, **not** `metadata?.paperId`. The metadata-keying anti-pattern is explicitly warned against at `convex/ai/helpers.ts:139-146,1668-1670`.
8. **Telemetry uses `captureServerEvent` with snake_case names matching dev convention.** Event name `credits_exhausted_mid_batch`. Channel: `lib/posthog-server.ts:66`. Co-emit with the same payload shape as `credits_insufficient` at `convex/ai/helpers.ts:248,363,491`.
9. **Insufficient credits surface to users as an inline alert, not a toast.** Mirror `ChatErrorAlert` (`components/extraction/chat/chat-error-alert.tsx`). Reuse `parseChatError` and the existing i18n keys `errors.title.insufficient_credits` / `errors.body.insufficient_credits` (`messages/en-US.json:588,609`). Render slot is above the results grid in `components/results-list.tsx`. Toast-dedup pattern from main is **rejected**.
10. **`beforeExecute` is removed entirely from `useBatchOperation`.** The only consumer (`useBatchTranslation:134-138`) misuses it for `manualRunRequestId` accounting. Move that consumption into `handleResult` plus a focused effect for the all-cached case. **No `beforeGuards` companion hook is added** — that would create permanent API debt with two ordering rules.
11. **`hasEnoughCredits` is a pure boolean primitive, not throw-and-emit.** Lives at `lib/credits/availability.ts`. Callers compose their own throw + emit. The four `with*Credits*` server gates compose this primitive but keep their existing structured error and PostHog event.
12. **Server-side `hasEnoughCredits` adoption is scoped to the AI helper trio only.** Replace `convex/ai/helpers.ts:247,362,490`. Defer `convex/chat/messages.ts:364` (file is in active churn under `chat-exact-stop-billing` plan), `convex/extraction/workpoolActions.ts:1276` (wrapped in `handleCreditsExhaustionAndRethrow`, needs design), and `convex/screening/mutations.ts:90` (mutation context, different error code) to follow-up cleanup work.
13. **Estimate constants stay in `convex/lib/constants.ts`.** Client code imports directly. **Do not** create a duplicate constants file for the client.
14. **No `useIsChromeless` involvement.** That hook is route-only and is duplicated between `app-sidebar.tsx:784` and `cookie-consent-banner.tsx:74`. Cleaning up that duplication is orthogonal and out of scope.
15. **The screening UI gates on `isScreeningPanelOpen`, read from the existing Zustand slice.** `useUIStore.screeningPanelOpenBySearchId` already exists at `lib/store.ts:89,600,627,631-646`. Thread through `ScreeningContextValue` as a single optional field; `useScreening` is the single read site for paper-card consumers.
16. **Behavior-first verification.** Every test asserts on observable state (lock rows, error envelopes, ARIA roles, `data-error-code` attributes, balance changes). No CSS-class assertions. No re-checking that React rendered the literal class string from source.

## Plan-File Inventory

- `00-README.md` — control document for the whole plan set.
- `01-shared-credit-primitive.md` — extract `hasEnoughCredits` + `resolveCreditsAvailability` to `lib/credits/availability.ts`; replace the AI helper trio inline gates.
- `02-batch-partial-helper.md` — add `lib/ai/core/batch-partial.ts` with `applyUnpaidBatchItemErrors` + `BATCH_ITEM_INSUFFICIENT_CREDITS_ERROR`; close the missing test gap in `tests/ai-batch.test.ts`.
- `03-backend-hardening.md` — `userResourceLocks` schema, `convex/lib/locks.ts` parameterized by `kind`, both rate-limit buckets, mid-batch salvage in `withAuthAndCreditsBatch`, action wrapping for both screening and translation.
- `04-client-hook-factory.md` — `AIHookOptions<TParams>`, per-execution credit check using slice-01 primitive, `allowSmartLocalFallback: false` for batch hooks, router options wiring for all 9 hooks.
- `05-hooks-and-ui.md` — delete `beforeExecute`; refactor translation consumption pattern; port `queuedLoadingBatchKeyRef` + `settledBatchVersion`; add `retryFailedItems` opt-in; build `ScreeningErrorAlert`; thread `isScreeningPanelOpen`; remove dead context plumbing.
- `PROMPTS.md` — copy-paste execution prompts for each numbered plan.

## Dependency Graph

```text
01 shared-credit-primitive   ──┐
                               ├─→ 03 backend-hardening   ──┐
02 batch-partial-helper      ──┤                            │
                               └─→ 04 client-hook-factory ──┴─→ 05 hooks-and-ui
```

Reasoning:

- `01` and `02` are independent foundations. Both can run in any order (or in parallel sessions) but both must be merged before `03`.
- `03` consumes `01` (helper trio refactor) and `02` (`applyUnpaidBatchItemErrors` import in `withAuthAndCreditsBatch`).
- `04` consumes `01` (per-execution `resolveCreditsAvailability` call inside `execute()`). It does **not** consume `02` directly.
- `05` consumes `04` (the new hook factory contract) and benefits from `03` being live (so the inline alert has real errors to show), but does not require `03` to be merged first — the alert can render any error envelope.

## Reuse / DRY Notes

Primary donors that must be reused instead of re-invented:

- Insufficient-credits predicate: `classifyUnknownError` in [lib/errors/taxonomy.ts](../../lib/errors/taxonomy.ts).
- Server telemetry: `captureServerEvent` in [lib/posthog-server.ts](../../lib/posthog-server.ts).
- Credit deduction: `deductCreditsTransaction` and `deductCredits` in [convex/credits/internal.ts](../../convex/credits/internal.ts).
- Credit estimate constants: [convex/lib/constants.ts](../../convex/lib/constants.ts) (`ESTIMATED_CREDITS_PER_PAPER`, `ESTIMATED_CREDITS_PER_QUERY`).
- Rate-limit primitive: [convex/lib/rateLimit.ts](../../convex/lib/rateLimit.ts) (extend, do not parallel).
- Inline error UX template: [components/extraction/chat/chat-error-alert.tsx](../../components/extraction/chat/chat-error-alert.tsx) and `parseChatError`.
- Insufficient-credits i18n keys: [messages/en-US.json](../../messages/en-US.json) (`errors.title.insufficient_credits`, `errors.body.insufficient_credits`) — already wired for `ChatErrorAlert`. **No new keys needed.**
- UI-store screening panel slice: `useUIStore.screeningPanelOpenBySearchId` in [lib/store.ts](../../lib/store.ts) (already exists; do not duplicate).
- Pre-flight contract test: [tests/ai-credit-preflight.test.ts](../../tests/ai-credit-preflight.test.ts) (re-point at the new primitive in slice 01).
- `BatchResult` type: [lib/ai/core/batch-types.ts](../../lib/ai/core/batch-types.ts) (already exists; `applyUnpaidBatchItemErrors` consumes this shape).
- Typed `UsageBreakdownEntry`: [convex/ai/helpers.ts](../../convex/ai/helpers.ts) (use first-class `paperId`, not `metadata?.paperId`).

Do **not** introduce:

- A new `isInsufficientCreditsError` predicate (reuse `classifyUnknownError`).
- A new toast-dedup pattern for credits errors (use the inline alert).
- A new `beforeGuards` hook point (delete `beforeExecute` instead).
- Per-kind lock siblings (`acquireBatchScreeningLock` + `acquireBatchTranslationLock`); use one parameterized `acquireBatchLock({ userId, kind, ttlMs })`.
- A duplicate constants file for client-side credit estimates.
- A new `aiBatchLocks` table named per the reference; use the generalized `userResourceLocks` instead.

## Testing Doctrine

This plan set follows the repo testing doctrine from `CLAUDE.md`:

1. Assert on behavior — observable state, ARIA roles, `data-*` contracts, balance changes, lock rows. Never on CSS class strings.
2. Push pure logic into helpers and unit-test those first. `hasEnoughCredits`, `applyUnpaidBatchItemErrors`, and `resolveCreditsAvailability` are all pure.
3. Convex integration tests via `convex-test` for lock acquire/release/expiry/concurrent-throw and for the per-item credit salvage path.
4. RTL + jsdom for the `ScreeningErrorAlert` rendering and the `useBatchOperation` factory's new `retryFailedItems` and `queuedLoadingBatchKeyRef` behaviors. Use `data-error-code`, `role="alert"`, and `data-action="retry-batch"` as stable selectors.
5. Optional Playwright smoke for: open results, trigger screening with insufficient credits, confirm inline alert appears with retry button.
6. Zero type errors is part of done. `tsc`, Convex typecheck, and Next.js compilation must be green.
7. Tests are part of the deliverable, not follow-up polish. Each TDD slice's tests ship in the same commit (Phase A) or as the immediately preceding/following commit (Phase B logical units).

## Migration Stance

This plan adds one new schema table (`userResourceLocks`). Per project default (CLAUDE.md "Migration stance — dev data is disposable"):

1. **Breaking by default.** No widen-then-narrow on the `kind` validator. The plan ships with `v.union(v.literal("batch_screening"), v.literal("batch_translation"))` from the first commit; future kinds are added by editing the union, not by widening to `v.string()` and narrowing later.
2. **No backfill, no migrations.** If the schema validator rejects existing rows after a change, wipe `userResourceLocks` via the Convex dashboard — it's a transient lock table; nothing to preserve.
3. **No `@convex-dev/migrations` scripts.** Not applicable.
4. The AI helper trio refactor is non-breaking at the wire level (same throw, same event, same balance check) — no schema impact.

## Delegation Policy

Subagents are mandatory for bounded research and code mapping in this plan set.

- Delegate:
  - Mapping all `withAuthAndCreditsBatch` call paths and the per-item ledger interaction.
  - Reading `chat-error-alert.tsx` and `parseChatError` to design the `ScreeningErrorAlert` mirror.
  - Surveying `useBatchOperation` consumers for breaking-change risk on the `beforeExecute` deletion.
  - Confirming i18n key coverage for the new `data-error-code` values in en-US, en-GB, fr, hi, ja, zh.
- Keep in the main session:
  - TDD red → green → refactor cycles.
  - Schema edits.
  - Commits and conventional-commit prefixes.
  - Final acceptance verification per slice.

## Grounding Sources

Local source (post-commit reference at `/tmp/openalex-main-inspect/`):

- [convex/ai/actions.ts](../../convex/ai/actions.ts)
- [convex/ai/helpers.ts](../../convex/ai/helpers.ts)
- [convex/credits/internal.ts](../../convex/credits/internal.ts)
- [convex/lib/rateLimit.ts](../../convex/lib/rateLimit.ts)
- [convex/lib/constants.ts](../../convex/lib/constants.ts)
- [convex/schema.ts](../../convex/schema.ts)
- [convex/chat/concurrency.ts](../../convex/chat/concurrency.ts)
- [convex/chat/messages.ts](../../convex/chat/messages.ts)
- [convex/chat/billing.ts](../../convex/chat/billing.ts)
- [convex/screening/mutations.ts](../../convex/screening/mutations.ts)
- [lib/ai/client/hook-factory.ts](../../lib/ai/client/hook-factory.ts)
- [lib/ai/client/router.ts](../../lib/ai/client/router.ts)
- [lib/ai/client/mode-routing.ts](../../lib/ai/client/mode-routing.ts)
- [lib/ai/client/executor.ts](../../lib/ai/client/executor.ts)
- [lib/ai/core/batch-types.ts](../../lib/ai/core/batch-types.ts)
- [lib/credits/feature-flags.ts](../../lib/credits/feature-flags.ts)
- [lib/errors/taxonomy.ts](../../lib/errors/taxonomy.ts)
- [lib/posthog-server.ts](../../lib/posthog-server.ts)
- [lib/store.ts](../../lib/store.ts)
- [lib/toast/use-app-toast.ts](../../lib/toast/use-app-toast.ts)
- [hooks/use-batch-operation.ts](../../hooks/use-batch-operation.ts)
- [hooks/use-batch-screening.ts](../../hooks/use-batch-screening.ts)
- [hooks/use-batch-translation.ts](../../hooks/use-batch-translation.ts)
- [components/results-list.tsx](../../components/results-list.tsx)
- [components/results-contexts.ts](../../components/results-contexts.ts)
- [components/paper-card/hooks.ts](../../components/paper-card/hooks.ts)
- [components/paper-card/paper-card-grid.tsx](../../components/paper-card/paper-card-grid.tsx)
- [components/paper-card/shared.tsx](../../components/paper-card/shared.tsx)
- [components/extraction/chat/chat-error-alert.tsx](../../components/extraction/chat/chat-error-alert.tsx)
- [tests/ai-batch.test.ts](../../tests/ai-batch.test.ts)
- [tests/ai-mode-routing.test.ts](../../tests/ai-mode-routing.test.ts)
- [tests/ai-credit-preflight.test.ts](../../tests/ai-credit-preflight.test.ts)
- [messages/en-US.json](../../messages/en-US.json)

Reference clones:

- `/tmp/openalex-main-inspect/` — `origin/main` post-`fa6d1fc8` (Apr 26, 2026) for the hardened reference contract.
- Reference commits: `1a6f67a1` ("Harden batch screening execution"), `fa6d1fc8` ("Fix batch operation guard ordering").

Project doctrine:

- `CLAUDE.md` — planning doctrine, testing philosophy, migration stance, delegation policy.
- `convex/_generated/ai/guidelines.md` — Convex API rules; read before any Convex code.
