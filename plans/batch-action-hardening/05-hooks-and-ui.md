# Plan 05 — Hooks + UI (Guard Cleanup, Inline Alert, Panel Gating)

**Depends on:** 04 (the new hook factory contract); benefits from 03 being live (real errors flow through). **Blocks:** none.

## Goal

Land the user-visible improvements: insufficient-credits errors stop being silently swallowed, batch operations don't wedge under contention, the screening panel actually gates work, and the `useBatchOperation` factory loses one misused extension point and gains two needed ones.

## Scope

In scope:

- **Delete `beforeExecute` from `useBatchOperation`.** It has exactly one consumer (`useBatchTranslation:134-138`) which misuses it for `manualRunRequestId` accounting. Move that consumption into `handleResult` plus a focused all-cached effect.
- **Port `queuedLoadingBatchKeyRef` and `settledBatchVersion`** from main's `1a6f67a1` + `fa6d1fc8` into `hooks/use-batch-operation.ts`. Required so a queued K2 gets a loading indicator and the effect re-runs after K1 settles.
- **Add `retryFailedItems?: boolean` opt-in** to `useBatchOperation` config (default `true` for backward compatibility). When `false`, failed batchKeys are added to `fetchedKeysRef` instead of removed, preventing infinite re-fire on persistent errors. `useBatchScreening` opts in to `false`.
- **Refactor `useBatchScreening`** to consume the new `questionSetKey` param, extract `buildScreeningBatchKey`, and switch `contextId` to `[searchId, questionSetKey, testRunKey].join("::")`.
- **Build `ScreeningErrorAlert`** mirroring `ChatErrorAlert`. Reuse `parseChatError` and the existing i18n keys. Render slot in `components/results-list.tsx` above the results grid.
- **Remove dead `errors` field from `ScreeningContextValue`** (`components/results-contexts.ts:11`). The alert reads `screeningErrors` directly from the same component scope; context plumbing becomes unnecessary.
- **Add `isScreeningPanelOpen?: boolean` to `ScreeningContextValue`.** Source: existing `useUIStore.screeningPanelOpenBySearchId[searchId]`. Read once in `results-list.tsx`, propagate through `useScreening`.
- **Gate paper-card screening UI on `isScreeningPanelOpen`.** Update `paper-card-grid.tsx:148` and `paper-card/shared.tsx:216`.
- **Gate `useBatchScreening`'s `canStart` on `isScreeningPanelOpen`** in `results-list.tsx:392`.

Out of scope:

- Cleaning up the duplicated `useIsChromeless` between `app-sidebar.tsx:784` and `cookie-consent-banner.tsx:74` — orthogonal.
- Adding a translation-side equivalent of `ScreeningErrorAlert` — translation already shows errors in its popover banner and is not in this plan's user-visible scope.
- Refactoring `useBatchTranslation`'s `manualRunRequestId` state machine beyond the consumption-site move.

## Design

### Delete `beforeExecute` from `useBatchOperation`

Current state: `hooks/use-batch-operation.ts` accepts `beforeExecute?: (info: { batchKey, papersNeedingProcessing, context }) => void` and invokes it inside the effect after the data guards.

Refactor:

1. Remove `beforeExecute` from `UseBatchOperationConfig<...>`.
2. Remove the `beforeExecute?.({...})` invocation site.
3. Remove the prop from any default destructuring.

In `hooks/use-batch-translation.ts:134-138`, the consumption was:

```text
beforeExecute: () => {
  if (!autoTranslateResults) {
    lastConsumedManualRunRequestIdRef.current = manualRunRequestId
  }
}
```

Replace with two new sites in `use-batch-translation.ts`:

1. Inside the existing `handleResult` callback (around `:101`), after the result is processed, add:
   ```text
   if (!autoTranslateResults) {
     lastConsumedManualRunRequestIdRef.current = manualRunRequestId
   }
   ```
   This consumes when work is actually done.

2. Add a focused effect for the all-cached case:
   ```text
   useEffect(() => {
     if (
       hasPendingManualRun &&
       papersNeedingProcessing.length === 0 &&
       effectiveCanStart
     ) {
       lastConsumedManualRunRequestIdRef.current = manualRunRequestId
     }
   }, [hasPendingManualRun, papersNeedingProcessing.length, effectiveCanStart, manualRunRequestId])
   ```
   This consumes when the user clicked "Translate" but everything is already translated.

The deletion satisfies CLAUDE.md rule 3 (no legacy, no compatibility shims). One concept removed; two clearer sites added.

### Port `queuedLoadingBatchKeyRef` + `settledBatchVersion`

From `/tmp/openalex-main-inspect/hooks/use-batch-operation.ts:94, 98, 129, 132-152, 161, 208, 210, 228`:

- Add `const queuedLoadingBatchKeyRef = useRef<string | null>(null)`.
- Add `const [settledBatchVersion, setSettledBatchVersion] = useState(0)`.
- In the effect's "already fetching" branch, dedup `setLoadingState` calls:
  ```text
  if (isFetchingRef.current) {
    if (queuedLoadingBatchKeyRef.current !== batchKey) {
      queuedLoadingBatchKeyRef.current = batchKey
      setLoadingState(createLoadingState(papersNeedingProcessing))
    }
    return
  }
  ```
- Reset `queuedLoadingBatchKeyRef.current = null` on context change (effect cleanup), on fetch start, and in the `.finally` block.
- Bump `setSettledBatchVersion((v) => v + 1)` at the end of the `.finally` block.
- Add `settledBatchVersion` to the effect's dependency array so it re-runs after a fetch settles, picking up any queued K2.

### Add `retryFailedItems` opt-in

Add to `UseBatchOperationConfig<...>`:

```text
retryFailedItems?: boolean  // default true
```

Current behavior at `hooks/use-batch-operation.ts:175` deletes the failed `batchKey` from `fetchedKeysRef` (so it can be retried on next render). New behavior:

```text
if (retryFailedItems !== false) {
  fetchedKeysRef.current.delete(batchKey)
} else {
  // keep batchKey in fetchedKeysRef so the failed batch is not re-queued
}
```

`useBatchScreening` passes `retryFailedItems: false`. `useBatchTranslation` does not pass it (preserves existing behavior).

### Refactor `useBatchScreening`

Add `questionSetKey: string` to `UseBatchScreeningOptions` interface.

Extract `buildScreeningBatchKey(papersToProcess, missingResponses, testIndexPerQuestion): string | null` as a top-level pure helper. Reference at `/tmp/openalex-main-inspect/hooks/use-batch-screening.ts:30-51`. Use it inside the existing `computeBatchKey` callback.

Switch `contextId` from `searchId` to `[searchId, questionSetKey, testRunKey].join("::")`. Reference at `/tmp/openalex-main-inspect/hooks/use-batch-screening.ts:156-159`.

Pass `retryFailedItems: false` to `useBatchOperation`.

### Build `ScreeningErrorAlert`

New file `components/screening/screening-error-alert.tsx`. Mirror `components/extraction/chat/chat-error-alert.tsx` shape:

- Props: `errors: ScreeningError[]`, `onRetry: () => void`, `canRetry: boolean`.
- Pick the worst error class from `errors` (e.g., first `insufficient_credits` if present, else first `auth`, else first generic).
- Pass to `parseChatError` to get the `ChatErrorEnvelope`.
- Render a single shadcn `<Alert>` with `variant="destructive"` (or `default` for `aborted`-class), `role="alert"`, `data-screening-error="true"`, `data-error-code={envelope.class}`, `data-action="retry-batch"`.
- Localize via existing keys at `messages/en-US.json:588,609` (`errors.title.insufficient_credits`, `errors.body.insufficient_credits`).
- Two CTA buttons:
  - "Retry" → `onRetry()`.
  - "Open Billing" → routes to `/settings/billing` (use existing `resolveToastActionRoute` helper from `lib/toast/error-resolver.ts` if convenient, or hard-code).

### Render slot in `results-list.tsx`

Insert above the "Single results area" block (around `:484`, where `LoadingResults variant="banner"` already renders). Read `screeningErrors` from `useBatchScreening`'s return value (already in scope at `:388-394`). Pass `onRetry` that re-invokes the batch (e.g., bumps a manual-retry version key that breaks the `fetchedKeysRef` dedup).

### Remove dead `errors` from `ScreeningContextValue`

Delete `errors?: ScreeningError[]` from `components/results-contexts.ts:11`. Delete the corresponding `errors: screeningErrors` assignment in the provider value at `results-list.tsx:450`. The alert reads from the local component scope, not from context.

### Thread `isScreeningPanelOpen`

Add to `ScreeningContextValue` (`components/results-contexts.ts:7-15`):

```text
isScreeningPanelOpen?: boolean
```

In `results-list.tsx`:

- Read the slice: `const isScreeningPanelOpen = useUIStore((s) => s.screeningPanelOpenBySearchId[searchId] ?? false)`. The slice already exists at `lib/store.ts:89,600,627,631-646`.
- Pass `canStart: canStartScreening && !!searchId && isScreeningPanelOpen` to `useBatchScreening` (`:388-394`).
- Add `isScreeningPanelOpen` to the `ScreeningContext.Provider` value (`:445-459`).

In `components/paper-card/hooks.ts:101-133` (`useScreening`):

- Destructure `isScreeningPanelOpen` from the context.
- Add it to the returned object.

In `components/paper-card/paper-card-grid.tsx:148`:

- Destructure `isScreeningPanelOpen` from `useScreening()`.
- Gate the screening badge block: `{isScreeningPanelOpen && screeningQuestions.length > 0 && (...)}`.

In `components/paper-card/shared.tsx:216`:

- Same gating: `if (!isScreeningPanelOpen || screeningQuestions.length === 0) return null`.

## TDD Sequence

Phase A — pure logic for the helper extractions, commit per green:

1. RED: `tests/use-batch-screening-key.test.ts` for `buildScreeningBatchKey`:
   - returns `null` when no papers need processing.
   - encodes `paperId:question1#0,question2#0|paperId2:question1#0` for two papers with two questions each.
   - includes `testIndexPerQuestion` per question.
2. GREEN: extract `buildScreeningBatchKey` from inline logic into a top-level pure helper. **Commit:** `feat(batch-screening): [plan-05] extract buildScreeningBatchKey helper`.

Phase B — hook changes, commit per logical unit:

3. Delete `beforeExecute` from `useBatchOperation` and refactor `useBatchTranslation` consumption into `handleResult` + the all-cached effect. Add a unit test in `tests/hooks/use-batch-translation.test.tsx`: bump `manualRunRequestId`; assert the ref is updated only when work happens or the all-cached path fires (not on every render). **Commit:** `refactor(hooks): [plan-05] move manualRunRequestId consumption out of beforeExecute`.
4. Add `queuedLoadingBatchKeyRef`, `settledBatchVersion`, and the dedup branch in `useBatchOperation`. Add a unit test asserting `setLoadingState` is called only once for a queued K2. **Commit:** `feat(hooks): [plan-05] dedup queued loading state across batch keys`.
5. Add `retryFailedItems?: boolean` option. Update the failure-path branch. Add a unit test asserting failed batchKeys are kept in `fetchedKeysRef` when the option is `false`. **Commit:** `feat(hooks): [plan-05] add retryFailedItems opt-in`.
6. Refactor `useBatchScreening` to accept `questionSetKey` and pass `retryFailedItems: false`. Update `contextId` composition. **Commit:** `refactor(batch-screening): [plan-05] add questionSetKey contextId and retryFailedItems opt-in`.

Phase C — UI components, commit per logical unit:

7. Create `components/screening/screening-error-alert.tsx`. Add `tests/components/screening-error-alert.test.tsx`: assert `getByRole("alert")` + `data-error-code="insufficient_credits"` + retry button click invokes `onRetry`. **Commit:** `feat(screening): [plan-05] add ScreeningErrorAlert component`.
8. Wire the alert into `results-list.tsx` above the results grid. Read `screeningErrors` from `useBatchScreening` return value. Provide `onRetry`. **Commit:** `feat(results): [plan-05] render ScreeningErrorAlert above results`.
9. Add `isScreeningPanelOpen` to `ScreeningContextValue`. Read from `useUIStore` in `results-list.tsx`. Pass through `useScreening`. **Commit:** `feat(screening-context): [plan-05] thread isScreeningPanelOpen through context`.
10. Gate `useBatchScreening`'s `canStart` on `isScreeningPanelOpen` in `results-list.tsx`. **Commit:** `feat(results): [plan-05] gate screening batch on panel open`.
11. Gate paper-card screening rendering on `isScreeningPanelOpen` in `paper-card-grid.tsx` and `paper-card/shared.tsx`. **Commit:** `feat(paper-card): [plan-05] hide screening UI when panel closed`.
12. Remove the dead `errors` field from `ScreeningContextValue` and the corresponding provider assignment. **Commit:** `chore(screening-context): [plan-05] drop unused errors plumbing`.

## Files Touched

- [hooks/use-batch-operation.ts](../../hooks/use-batch-operation.ts) — delete `beforeExecute`, add refs/state/option/dedup branch.
- [hooks/use-batch-translation.ts](../../hooks/use-batch-translation.ts) — remove `beforeExecute` site, add consumption to `handleResult` + new effect.
- [hooks/use-batch-screening.ts](../../hooks/use-batch-screening.ts) — extract `buildScreeningBatchKey`, add `questionSetKey`, pass `retryFailedItems: false`, update `contextId`.
- [components/results-list.tsx](../../components/results-list.tsx) — render alert, read panel-open slice, gate `canStart`, propagate context, drop `errors` from provider.
- [components/results-contexts.ts](../../components/results-contexts.ts) — add `isScreeningPanelOpen?`, remove `errors?`.
- [components/paper-card/hooks.ts](../../components/paper-card/hooks.ts) — destructure and return `isScreeningPanelOpen`.
- [components/paper-card/paper-card-grid.tsx](../../components/paper-card/paper-card-grid.tsx) — gate render on `isScreeningPanelOpen`.
- [components/paper-card/shared.tsx](../../components/paper-card/shared.tsx) — gate render on `isScreeningPanelOpen`.
- [components/screening/screening-error-alert.tsx](../../components/screening/screening-error-alert.tsx) (new).
- [tests/use-batch-screening-key.test.ts](../../tests/use-batch-screening-key.test.ts) (new).
- [tests/hooks/use-batch-translation.test.tsx](../../tests/hooks/use-batch-translation.test.tsx) (new or extend).
- [tests/hooks/use-batch-operation.test.tsx](../../tests/hooks/use-batch-operation.test.tsx) (new or extend).
- [tests/components/screening-error-alert.test.tsx](../../tests/components/screening-error-alert.test.tsx) (new).

## Migration Stance

None. Pure client refactor and additive UI; no schema changes; no wire changes.

## Test Plan

- Unit: `buildScreeningBatchKey` extraction (3 cases).
- Unit/integration via RTL: `useBatchOperation` queued-loading dedup (1 case), `retryFailedItems: false` behavior (1 case).
- Unit/integration via RTL: `useBatchTranslation` consumption fires from `handleResult` and all-cached effect (2 cases).
- Component: `ScreeningErrorAlert` renders alert with correct `data-error-code` and retry callback (2 cases).
- Existing tests in `tests/hooks/`, `tests/components/paper-card-grid.test.tsx`, etc., continue to pass.
- Optional Playwright smoke in `e2e/screening.spec.ts`: open results, force insufficient credits, assert alert appears with retry button.
- `tsc`, Next.js compile, full `vitest run` green. pm2 next.js logs clean.

## Acceptance Criteria

- `useBatchOperation` no longer accepts `beforeExecute`.
- `useBatchTranslation` consumes `manualRunRequestId` in `handleResult` and the all-cached effect; behavior under contention is bug-free (verified by test).
- `queuedLoadingBatchKeyRef` and `settledBatchVersion` are present and exercised; queued K2 gets a single loading-state set and starts as soon as K1 settles.
- `retryFailedItems: false` is wired in `useBatchScreening`; failed batches don't re-fire.
- `ScreeningErrorAlert` renders above the results grid when `screeningErrors.length > 0`; clicking retry re-invokes the batch; clicking "Open Billing" navigates to `/settings/billing`.
- Dead `errors` field is removed from `ScreeningContextValue`.
- `isScreeningPanelOpen` is read from the existing `useUIStore` slice and threaded through context. When the panel is closed:
  - `useBatchScreening`'s `canStart` is `false` — no requests fire.
  - Paper-card screening badges/UI do not render.
- All TDD tests are green; existing tests continue to pass; `tsc` and Next.js compile clean; pm2 next.js logs show no warnings.

## Known Pitfalls

- The `beforeExecute` deletion is destructive. Verify no third-party consumer exists before merging — `grep -rn "beforeExecute" hooks components app` should show zero hits after the refactor.
- The `manualRunRequestId` consumption in `handleResult` fires per-result. If a batch produces 10 results, the consumption fires 10 times. That's fine because the ref write is idempotent (assigning the same value), but verify the test asserts on observable state (was `lastConsumedManualRunRequestIdRef.current === manualRunRequestId`), not call count.
- The all-cached effect must guard against `manualRunRequestId === lastConsumedManualRunRequestIdRef.current` to avoid fire on every render once `hasPendingManualRun` is satisfied. Either include this check inside the effect or rely on `hasPendingManualRun` flipping false naturally.
- `ScreeningErrorAlert` mounting on first error means it survives re-renders until `screeningErrors` is empty. The `onRetry` callback must succeed in clearing the errors (or trigger a context-id change) — otherwise the alert stays. Document the contract: "the alert unmounts when `screeningErrors.length === 0`."
- The `ScreeningErrorAlert` retry button must not fire if the batch is currently in-flight (use the existing `loadingState` from `useBatchScreening`). Otherwise the user can spam retry while a fetch is still going.
- `parseChatError` was designed for chat envelopes; it must accept a `ScreeningError`-shaped string. If the wire format differs, either pre-stringify on the screening side to match chat's wire shape OR widen `parseChatError` to accept a structured error object. Test before assuming compatibility.
- Removing the `errors` field from `ScreeningContextValue` is destructive. Verify no consumer reads it (agent-confirmed `paper-card/hooks.ts:112-116` does not destructure it; library page provider passes empty object). If any test asserts on the field, remove the assertion in the same commit.
- The i18n keys `errors.title.insufficient_credits` and `errors.body.insufficient_credits` already exist in `messages/en-US.json:588,609`. Verify they exist in all other locale files (`en-GB`, `fr`, `hi`, `ja`, `zh`) before merging — if missing, add them as part of the same commit.
- The render-slot decision (above results, vs. inside the screening panel itself) affects discoverability when the panel is collapsed. Above-results is the right default because the error indicates failed work; the user must be able to see it without re-opening the panel. Reference: `LoadingResults variant="banner"` already lives in this slot, establishing the pattern.
- The `useUIStore` slice subscription must use a stable selector to avoid re-render churn: `useUIStore((s) => s.screeningPanelOpenBySearchId[searchId] ?? false)` is fine for primitives; if the selector returned an object, equality comparison would be needed.
