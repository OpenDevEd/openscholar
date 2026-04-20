# Plan 02 — Aborted UI State (pill, toast, a11y, retry affordance)

**Depends on:** 01 (needs the stream row to actually transition to `state:{kind:"aborted"}` — otherwise there's nothing client-side to render distinctly). **Blocks:** nothing.

## Goal

When a user clicks stop and plan 01's backend aborts the stream, the UI should:

1. Show a **subtle, instant toast** (`"Generation stopped"`, 2s, `aria-live="polite"`) as soon as the `abortGeneration` mutation resolves — before the backend has finished aborting. This is about click feedback.
2. Render the **partial assistant message with a "Stopped by user" pill** (not an error/failure banner). Partial text stays visible; a small indicator sits inline with the message metadata (next to the copy/retry actions).
3. Expose the aborted state via `data-message-state="aborted"` on the message row for test targeting and for CSS hooks.
4. Keep **retry** available on the aborted message — the user may want to regenerate. The existing retry affordance (already in `message-actions.tsx`) just needs to not be disabled when state is `"aborted"`.
5. Ensure the streaming list query (whatever feeds `message-list.tsx`) **includes aborted messages** — `@convex-dev/agent`'s `listThreadMessages` / `syncStreams` filters by `includeStatuses`. Verify `"aborted"` is in that allowlist; add if missing.

No backend changes. No schema changes. Entirely client-side + one possible tweak to a Convex query's `includeStatuses` array if it excludes aborted today.

Implements decisions D8, D11, D12.

## Scope

**In scope**

- `components/extraction/chat/message-composer.tsx` — `handleStop` fires a `toast.success("Generation stopped")` on mutation resolve. The button itself stays untouched per D12.
- `components/extraction/chat/message-list.tsx` (or wherever assistant messages render) — add conditional `<AbortedPill />` next to metadata when `message.state?.kind === "aborted"` (or whatever the actual discriminator is — verify with a research agent against the library's message shape).
- `components/extraction/chat/aborted-pill.tsx` (NEW) — tiny presentational component. `role="status"`, visible label "Stopped by user", small stop icon, muted color. One line of JSX, uses existing Tailwind tokens.
- `components/extraction/chat/message-actions.tsx` — audit the `retry` button's `disabled` state; ensure it's enabled when `state.kind === "aborted"` (currently likely disabled on any non-"finished" state).
- Locale strings for `"Generation stopped"` and `"Stopped by user"` in `messages/*.json` (existing i18n pattern — add keys, translate per locale).
- `convex/chat/messages.ts` or wherever `listThreadMessages` is exposed — verify `syncStreams` config includes `"aborted"` in `includeStatuses`; add if missing.
- Tests: Testing Library assertions on `data-message-state="aborted"` + `role="status"` pill visible + retry button enabled + toast `role="status"` + message-list includes aborted messages. Assert on ARIA and `data-*` attributes per CLAUDE.md testing doctrine — NEVER on CSS classes.

**Out of scope**

- Any styling beyond basic tone ("subtle, muted"). The pill uses existing design tokens; no new Tailwind colors.
- A "Resume" button (D9).
- Changes to the stop button itself (D12).
- Any backend logic (plan 01 covers it).
- Animated transitions on pill appearance (if the designer wants them later, fine; not in this plan).

## Design

### 1. The three surfaces

**Surface A — Toast on click (instant feedback).**

Today (`components/extraction/chat/message-composer.tsx:57-61`):

```tsx
const handleStop = useCallback(() => {
  void abortGeneration({ threadId }).catch((err) => {
    console.error("abort failed", err);
  });
}, [abortGeneration, threadId]);
```

After:

```tsx
const handleStop = useCallback(() => {
  void abortGeneration({ threadId })
    .then(() => {
      toast.success(t("chat.stop.toast"));  // "Generation stopped"
    })
    .catch((err) => {
      console.error("abort failed", err);
      toast.error(t("chat.stop.toastFailure"));  // "Couldn't stop generation"
    });
}, [abortGeneration, threadId, t]);
```

**Why success on mutation resolve, not on stream row state change:** the mutation resolves within ~50ms; the stream row transition can take up to ~600ms. Users need instant acknowledgement, and the mutation IS the authoritative "I heard you click" signal. The toast is about click feedback, not stream state.

Use existing `sonner` toast primitive (project-standard — verify via `grep -l "sonner" components/ app/ | head -3`).

**Surface B — Pill on the aborted message.**

⚠️ **Deviation resolved during Phase A research** (2026-04-20): the discriminator is NOT `message.state.kind === "aborted"`. `@convex-dev/agent`'s `useUIMessages` hook has `UIMessage.status: "streaming" | "pending" | "success" | "failed"` — `"aborted"` is not in the union. Internally (`deltas.ts:41-54`, `statusFromStreamStatus`) the library maps stream `status: "aborted"` → UIMessage `status: "failed"`. Separately, the library's `call.fail` handler at `node_modules/@convex-dev/agent/src/client/start.ts:162-169` calls `finalizeMessage({status:"failed", error: reason})` where `reason` is the `AbortSignal.reason.toString()` — plan 01 aborts with `new DOMException("user_stopped", "AbortError")`, so the persisted error string is exactly `"AbortError: user_stopped"`.

**Chosen predicate path (server-authoritative):**

1. Extract `"user_stopped"` to a shared constant in `lib/chat/abort-signal.ts` so server (plan 01's abort controller) and server-side `listThreadMessages` share the sentinel — no drift possible.
2. In `listThreadMessages` on the server:
   - Pass `includeStatuses: ["streaming", "finished", "aborted"]` to `syncStreams` (required — library default is `["streaming"]` only; see `node_modules/@convex-dev/agent/src/component/streams.ts:125`).
   - When enriching `page` with the stored `error`: if the error string equals `ABORT_ERROR_STRING` (`"AbortError: user_stopped"`), emit `{...m, aborted: true}` INSTEAD of `{...m, error: ...}`. Real errors keep their envelope; aborted messages surface a clean boolean flag with no error.
3. Client predicate: `message.aborted === true`. No string parsing, no envelope inspection — just a boolean from the server.

This is cleaner than "status=failed && !error" heuristics and survives any future library change to the mapping.

```tsx
// components/extraction/chat/aborted-pill.tsx
import { StopCircle } from "lucide-react";
import { useTranslations } from "next-intl";

export function AbortedPill() {
  const t = useTranslations("extraction");
  return (
    <span
      role="status"
      data-message-state="aborted"
      aria-label={t("chatAbortedPillAria")}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
    >
      <StopCircle className="size-3" aria-hidden="true" />
      {t("chatAbortedPillLabel")}
    </span>
  );
}
```

Render site (in `MessageRow` inside `message-list.tsx`, alongside `MessageActions`):

```tsx
{!isUser && isAborted && <AbortedPill />}
```

Also set `data-message-state="aborted"` on the motion.li row container when `isAborted` (overriding the existing `data-status="failed"` signal) and suppress `data-error={true}` for aborted messages so tests can distinguish abort from failure.

**Surface C — Retry enabled in aborted state.**

Audited `components/extraction/chat/message-actions.tsx` during Phase A. Current logic:

- `isStreaming = message.status === "streaming"`
- `isFailed = message.status === "failed"`
- `showRetry = isLastAssistant || isFailed`
- `disabled={isStreaming}` (on the retry ActionButton)

Because aborted messages map to `status: "failed"` via the library, they already satisfy `isFailed` → `showRetry=true`, and `isStreaming=false` → retry is **already enabled**. **No change to message-actions.tsx needed.** Only concern: ChatErrorAlert (rendered at `message-list.tsx:268-274` when `isFailed && rawError`) must NOT render for aborted — which is automatic once the server drops the error envelope and emits `aborted:true` instead.

### 2. `listThreadMessages` includeStatuses verification

**Confirmed during Phase A research**: the library's `syncStreams` accepts `includeStatuses: ("streaming"|"finished"|"aborted")[]` at `node_modules/@convex-dev/agent/src/client/streaming.ts:48-81`, and **defaults to `["streaming"]` only** (`node_modules/@convex-dev/agent/src/component/streams.ts:125`). Our current call at `convex/chat/messages.ts:351` passes `args` directly without overriding — aborted streams are **silently filtered out**. Adding `"aborted"` is mandatory, not optional.

Fold the `includeStatuses` change into the same commit as the server-side `aborted`-flag enrichment (they're the same edit surface — `listThreadMessages` in `convex/chat/messages.ts`).

### 3. The pill's visual language (decision, not code)

- Muted foreground color (`text-muted-foreground` token).
- Small icon + short label, inline with message metadata.
- **NOT red.** This is not an error. Red is for `onError` / `message.state.kind === "failed"`.
- **NOT a banner or alert.** The user initiated this; it doesn't need attention.
- Test contract: `data-message-state="aborted"` attribute present, `role="status"` present, visible text matches translated "Stopped by user" / "Arrêté par l'utilisateur" / etc.

### 4. No animation

Per D12 scope discipline — no pill enter-animation, no fade. The stream row state flips reactively via Convex subscription; React re-renders; pill appears. That's fine.

## Files touched

- `lib/chat/abort-signal.ts` — **NEW** (~10 lines). Exports `ABORT_REASON_USER_STOPPED` and `ABORT_ERROR_STRING` constants so the server (plan 01's abort controller) and `listThreadMessages` enrichment share a single sentinel.
- `convex/chat/messages.ts` —
  - Import `ABORT_REASON_USER_STOPPED`, use it in the `abortController.abort(new DOMException(...))` at line 150 (replace hardcoded `"user_stopped"`).
  - In `listThreadMessages` (line 334–366): pass `includeStatuses: ["streaming","finished","aborted"]` to `syncStreams`; in page-enrichment, recognize the sentinel error string and emit `{aborted: true}` instead of `{error}`.
- `components/extraction/chat/message-composer.tsx` — `handleStop` fires toast.success on resolve and toast.error on reject; uses existing `sonner`-backed pattern.
- `components/extraction/chat/aborted-pill.tsx` — **NEW** (~20 lines). Presentational component, `role="status"`, `data-message-state="aborted"`.
- `components/extraction/chat/message-list.tsx` —
  - Widen `ChatUIMessage` type to include `aborted?: boolean`.
  - Compute `isAborted = message.aborted === true` in `MessageRow`.
  - Conditionally render `<AbortedPill />` next to `MessageActions`.
  - Override `data-status` to `"aborted"` and suppress `data-error` when `isAborted`.
  - Add `data-message-state="aborted"` on the message row.
- `components/extraction/chat/message-actions.tsx` — **no change** (retry is already enabled for `status: "failed"`, which aborted maps to).
- `messages/en-GB.json`, `messages/en-US.json`, `messages/fr.json`, `messages/hi.json`, `messages/ja.json`, `messages/zh.json` — add 4 keys under `extraction` namespace (matching existing `chatXxx` naming convention): `chatStopToast`, `chatStopToastFailure`, `chatAbortedPillLabel`, `chatAbortedPillAria`.
- `lib/chat/abort-signal.test.ts` — **NEW** pure unit tests for the sentinel constant.
- `components/extraction/chat/aborted-pill.test.tsx` — **NEW** Testing Library test B3.
- Tests B1, B2, B4, B5, B6, B7 — colocated next to their component under test.
- `convex/chat/messages.test.ts` — extend with M1 (aborted message enrichment).

## Migration stance — **none**

No schema changes. No backend behavior changes. Client-side rendering + one Convex-query config tweak at most.

## Test plan

### Unit / component (Testing Library + `vi`)

All assertions use aria, `data-*`, and visible text. **Never CSS classes.**

- **B1 — toast fires on successful mutation**
  - Mock `useMutation(api.chat.messages.abortGeneration)` to resolve with `null`.
  - Render composer with `jobIsGenerating=true`, click the stop button (`data-testid` or button's `aria-label`).
  - Assert `screen.getByRole("status")` eventually contains the localized "Generation stopped" text.
  - Assert the toast has `aria-live="polite"` (per sonner defaults).

- **B2 — error toast on mutation failure**
  - Mock mutation to reject with a plain error.
  - Click stop. Assert `screen.getByRole("status")` contains "Couldn't stop generation".
  - Assert `console.error` spy was called (diagnostic trail preserved).

- **B3 — `AbortedPill` renders visible label + role + data attr**
  - Render `<AbortedPill />`.
  - Assert `getByRole("status")` exists.
  - Assert `getByText(/stopped by user/i)` (localized) is visible.
  - Assert the element has `data-message-state="aborted"`.

- **B4 — message-list renders pill for aborted assistant message** (integration test against `MessageRow`)
  - Render `MessageRow` directly with a mocked message `{ role: "assistant", status: "failed", aborted: true, text: "Partial text..." }`.
  - Assert the partial text is visible.
  - Assert one element with `data-message-state="aborted"` exists.
  - Assert the message row container has `data-message-state="aborted"` and does NOT have `data-error="true"`.
  - Assert `ChatErrorAlert` is NOT in the DOM (no "rate limit"-style copy).
  - Separately: render with `{ role: "assistant", status: "failed", error: '{"kind":"rate_limit"}' }` (no `aborted` flag). Assert `data-error="true"` is present and NO `data-message-state="aborted"` attr, and `ChatErrorAlert` IS in the DOM.

- **B5 — retry button enabled on aborted message**
  - Render `MessageActions` with `{ role: "assistant", status: "failed" }` (aborted shows up as status=failed on the UIMessage; the retry predicate doesn't need to know why).
  - Find the retry button by accessible name.
  - Assert `.toBeEnabled()`.

- **B6 — retry button disabled during active stream**
  - Same, but with `{ role: "assistant", status: "streaming" }`.
  - Assert the retry button is either not rendered (current behavior — `showRetry` gates on `isLastAssistant || isFailed`) or is disabled. The guard is: no way to click retry while streaming.

- **B7 — stop button disappears after abort completes**
  - Render composer with `jobIsGenerating=true`.
  - Simulate the reactive subscription flipping `jobIsGenerating` to `false`.
  - Assert the stop button is no longer in the DOM; the send button replaces it. (Guards existing behavior; not new but worth pinning.)

### Convex integration (test-after, in `convex/chat/messages.test.ts`)

- **M1 — `listThreadMessages` enriches aborted messages with `aborted: true` instead of `error`**
  - Seed a thread with: one "regular" finished assistant message; one message whose MessageDoc has `{status:"failed", error: "AbortError: user_stopped"}` (simulating library's `call.fail` on abort); one real-error message with `{status:"failed", error: '{"kind":"rate_limit",...}'}`.
  - Call `listThreadMessages` as the authenticated owner.
  - Assert all three messages appear in the `page` array.
  - Assert the aborted message has `aborted: true` and NO `error` field.
  - Assert the real-error message has its JSON `error` envelope and NO `aborted` field.
  - Assert the finished message has neither `aborted` nor `error`.

### E2E smoke (no code — do this after merge)

1. Start a chat. Send a message. Wait for streaming to begin.
2. Click stop mid-stream.
3. Assert instantly (< 200ms): toast `"Generation stopped"` appears.
4. Assert within ~1s: streaming cursor disappears; partial text stays; "Stopped by user" pill appears next to message actions.
5. Assert: retry button is enabled. Click retry — new stream starts normally.
6. Navigate away, come back. Aborted message + pill + partial text all persist.
7. Mobile viewport: pill doesn't overflow, retry button still tappable.

## Acceptance criteria

- [ ] Clicking stop produces a toast within 200ms of click (B1, E2E step 3).
- [ ] Aborted assistant messages render an `<AbortedPill>` with `role="status"` and `data-message-state="aborted"` (B3, B4).
- [ ] Partial text on aborted messages is preserved and visible (covered by plan 01 at the data layer; this plan just doesn't hide it).
- [ ] Retry button is enabled on aborted messages, disabled/absent during active streaming (B5, B6).
- [ ] `listThreadMessages` returns aborted messages with `aborted: true` and no `error`; real-error messages retain their `error` envelope (M1).
- [ ] Abort sentinel string lives in a single shared constant (`lib/chat/abort-signal.ts`) consumed by both `convex/chat/messages.ts::generateResponse` and `convex/chat/messages.ts::listThreadMessages`.
- [ ] Toast + pill strings are localized across all 6 project locales (en-GB, en-US, fr, hi, ja, zh).
- [ ] No CSS-class assertions anywhere in the new tests (`rg -n "toMatch\\(/.*(-|_).*/\\)|toHaveClass\\(" components/extraction/chat/ lib/chat/` for new test files returns zero against color/layout classes).
- [ ] E2E smoke test passes on desktop + mobile viewports.
- [ ] `rg -n "aborted" components/extraction/chat/` shows the new pill + message-list integration + composer toast. Clean, no orphans.
- [ ] ChatErrorAlert does NOT render for aborted messages; only for real-error (has `error` envelope) messages.

## Known pitfalls

- **The message-state discriminator field name is library-internal.** Do NOT assume `state.kind === "aborted"` verbatim — read the library to confirm whether it's `state.kind`, `status`, `streamState`, or something else. One 5-minute agent spawn against `node_modules/@convex-dev/agent/src/client/index.ts` + `listThreadMessages` return type saves a failed test cycle.
- **Partial text with the current streaming renderer.** `streaming-cursor.tsx` may still render a blinking cursor for a message whose deltas stopped arriving. Verify that when `state.kind === "aborted"`, the cursor disappears. If not, that's a 1-line fix: gate the cursor on `state.kind === "streaming"`.
- **Toast on mutation resolve vs on action finish:** the mutation is fire-and-forget; the actual LLM HTTP cut happens ~500ms later. If you wait for the action to finish (via some server-push), the toast feels delayed. **Fire the toast on mutation resolve.** Accept the ~500ms disconnect between toast and actual-stop.
- **Race where user clicks stop AFTER the stream finished naturally:** `abortGeneration` mutation no-ops because `!job.isGenerating`. The mutation still resolves; the toast still fires. If this feels wrong ("why did it say 'stopped' when it was already done?"), either (a) have `abortGeneration` return a status enum the client can branch on, or (b) accept it — the user's mental model is "I clicked stop, it said stopped", truthfully. Prefer (b) for scope discipline; revisit if users complain.
- **`sonner` toast render target:** ensure `<Toaster />` is mounted in the layout. If the project uses `sonner` elsewhere, it already is. If the toast fails to render during tests, mock `toast.success` directly and assert the spy rather than fighting the portal.
- **i18n keys under `chat.stop.*` and `chat.abortedPill.*`:** keep key paths consistent with existing chat keys (whatever naming scheme `chat-header`/`composer-model-picker` use). Grep `messages/en.json` for existing chat keys before inventing new paths.
- **Retry enabling might cascade:** the `disabled` predicate on retry may be shared with other message states. Double-check that loosening it to "enabled on aborted" doesn't accidentally enable retry on a failed message in an unwanted way. If there are multiple non-success states, enumerate:
  - `streaming` → disabled
  - `finished` → enabled (current)
  - `aborted` → enabled (new)
  - `failed` → enabled (current, probably)
  - Explicit `switch` is clearer than a negated boolean; refactor the predicate into a named helper if it grows past 2 conditions.

## Deviations

If during execution you find any of these, **update this plan, commit the plan edit, then proceed**:

- The library's message shape doesn't have a `state.kind === "aborted"` discriminator. The UI needs a different predicate — e.g., `message.status === "aborted"` or `message.streamStatus === "aborted"`. Update the plan's Surface B section and all tests.
- `listThreadMessages` silently drops aborted messages (even when `includeStatuses` includes `"aborted"`). Investigate the library's internal filter; may need an upstream fix or a local workaround. File a BLOCKER.md.
- The existing retry button has a non-trivial disabled logic that touches more states than just streaming. Refactor to a helper function `canRetry(state) → boolean` and add unit tests for the matrix. Expand § Files touched accordingly.
- The project does NOT use `sonner`. Find the in-use toast primitive (`grep -l "toast" components/ui/`) and use it instead. Swap `toast.success` / `toast.error` for the project's equivalent.
