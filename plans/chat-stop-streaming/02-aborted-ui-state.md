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

The assistant message list renders from `listThreadMessages` (or the project's wrapper around it). Each message has some state discriminator. Per research, `@convex-dev/agent` returns messages with `status` / `state` indicating streaming lifecycle. **The exact shape must be verified at execution time** — spawn an agent to read `node_modules/@convex-dev/agent/src/client/index.ts` around `listThreadMessages` and identify the field name.

```tsx
// components/extraction/chat/aborted-pill.tsx
import { StopCircle } from "lucide-react";
import { useTranslations } from "next-intl";

export function AbortedPill() {
  const t = useTranslations();
  return (
    <span
      role="status"
      data-message-state="aborted"
      aria-label={t("chat.abortedPill.aria")}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
    >
      <StopCircle className="size-3" aria-hidden="true" />
      {t("chat.abortedPill.label")}
    </span>
  );
}
```

Render site (pseudocode — exact location depends on current message layout):

```tsx
{message.role === "assistant" && message.state?.kind === "aborted" && (
  <AbortedPill />
)}
```

Place adjacent to the existing message-actions row (copy/retry icons). Do not replace them; the pill sits alongside. `data-message-state="aborted"` on the pill itself AND on the message-row container for test targeting.

**Surface C — Retry enabled in aborted state.**

Audit `components/extraction/chat/message-actions.tsx`. The retry button's `disabled` prop likely uses something like:

```tsx
disabled={isStreaming || !isComplete}
```

Change to:

```tsx
disabled={isStreaming}  // enabled when aborted, disabled only during an active stream
```

Exact check depends on current predicate — verify with a read.

### 2. `listThreadMessages` includeStatuses verification

`@convex-dev/agent`'s `syncStreams` RPC has an `includeStatuses` config that filters which stream states are returned to the client. Per research, values are `"streaming" | "finished" | "aborted" | "pending" | ...` (exact union in `node_modules/@convex-dev/agent/src/client/index.ts:835` and nearby).

If the project's current thread-messages query is:

```ts
return await paperChat.listThreadMessages(ctx, { threadId, paginationOpts });
// where listThreadMessages internally calls syncStreams
```

…check what `includeStatuses` it uses. If it's `["streaming", "finished"]` (for example), add `"aborted"`. The aborted message should appear in the list same as a finished one, just with different `state`.

Do this in a **very short commit** — one line or two — separate from the UI work, so the wiring is easy to verify independently.

### 3. The pill's visual language (decision, not code)

- Muted foreground color (`text-muted-foreground` token).
- Small icon + short label, inline with message metadata.
- **NOT red.** This is not an error. Red is for `onError` / `message.state.kind === "failed"`.
- **NOT a banner or alert.** The user initiated this; it doesn't need attention.
- Test contract: `data-message-state="aborted"` attribute present, `role="status"` present, visible text matches translated "Stopped by user" / "Arrêté par l'utilisateur" / etc.

### 4. No animation

Per D12 scope discipline — no pill enter-animation, no fade. The stream row state flips reactively via Convex subscription; React re-renders; pill appears. That's fine.

## Files touched

- `components/extraction/chat/message-composer.tsx` — 4 lines in `handleStop` (toast on resolve).
- `components/extraction/chat/aborted-pill.tsx` — NEW (~20 lines).
- `components/extraction/chat/message-list.tsx` — conditional `<AbortedPill />` render (~3 lines).
- `components/extraction/chat/message-actions.tsx` — loosen retry `disabled` predicate (~1 line).
- `messages/en.json` + every other locale — add `chat.stop.toast`, `chat.stop.toastFailure`, `chat.abortedPill.label`, `chat.abortedPill.aria`.
- `convex/chat/messages.ts` (or wherever `listThreadMessages` lives) — add `"aborted"` to `includeStatuses` if not present. Likely zero-change if library defaults already include it; verify.

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
  - Assert `getByText("Stopped by user")` (localized) is visible.
  - Assert `container.querySelector('[data-message-state="aborted"]')` is truthy.

- **B4 — message-list renders pill for aborted assistant message**
  - Render message-list with a mocked message list containing `{ role: "assistant", state: { kind: "aborted" }, content: "Partial text..." }`.
  - Assert the partial text is visible.
  - Assert exactly one `<AbortedPill>` renders (via `getAllByRole("status")` + filter).
  - Assert a NON-aborted finished message does NOT render a pill.

- **B5 — retry button enabled on aborted message**
  - Render message-actions in the context of an aborted assistant message.
  - Find the retry button by accessible name (e.g., `getByRole("button", { name: /regenerate/i })`).
  - Assert `.toBeEnabled()`.

- **B6 — retry button disabled during active stream**
  - Same, but with a streaming message (`state.kind === "streaming"`).
  - Assert `.toBeDisabled()`. (Guards against a regression from loosening the predicate.)

- **B7 — stop button disappears after abort completes**
  - Render composer with `jobIsGenerating=true`.
  - Simulate the reactive subscription flipping `jobIsGenerating` to `false`.
  - Assert the stop button is no longer in the DOM; the send button replaces it. (Guards existing behavior; not new but worth pinning.)

### Convex integration (test-after, in `convex/chat/messages.test.ts`)

- **M1 — `listThreadMessages` includes aborted messages**
  - Seed a thread with: one finished assistant message + one aborted assistant message (manually write the stream row with `state:{kind:"aborted"}`).
  - Call `listThreadMessages` via `paperChat`.
  - Assert both messages are returned.
  - Assert the aborted one has its state discriminator preserved in the response (so the UI can branch on it).

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
- [ ] Retry button is enabled on aborted messages, disabled only during active streaming (B5, B6).
- [ ] `listThreadMessages` returns messages with `state.kind === "aborted"` (M1).
- [ ] Toast + pill strings are localized across all project locales.
- [ ] No CSS-class assertions anywhere in the new tests (`rg -n "toMatch\\(/.*(-|_).*/|toHaveClass\\(" tests/ components/` for new test files returns zero against color/layout classes).
- [ ] E2E smoke test passes on desktop + mobile viewports.
- [ ] `rg -n "aborted" components/extraction/chat/` shows the new pill + message-list integration + composer toast. Clean, no orphans.

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
