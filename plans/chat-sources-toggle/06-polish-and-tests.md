# Plan 06 — Motion, Reduced-Motion, A11y Audit, E2E, Performance Validation

**Depends on:** 01, 02, 03, 04, 05. **Blocks:** nothing — this is the final gate.

## Goal

Turn the functionally-complete feature into a shippable one. Add purposeful animations, respect `prefers-reduced-motion`, run a full a11y audit against WAI-ARIA APG's listbox pattern, write end-to-end tests for the user-visible happy paths and critical edges, and measure subscription + render cost at the 500-paper ceiling to decide whether virtualization is needed now or can defer.

## Scope

**In scope**

- Animation pass on the Sources panel:
  - Row enter/exit on filter (`framer-motion` with layout animations).
  - Checkbox flip micro-interaction (tap → spring).
  - Chip activation ripple.
  - Sort pill `↑/↓` glyph crossfade on direction flip.
  - Bulk toast slide-in.
  - Citation pill state transitions (excluded ↔ included — color + border crossfade).
- `prefers-reduced-motion` respect — all animations gate on this, falling back to instant state changes.
- A11y audit:
  - Automated axe-core against the rendered Sources panel (0 violations).
  - Manual screen-reader trace on VoiceOver (macOS) and NVDA (Windows) for the keyboard-flow matrix.
  - Keyboard-only E2E (Playwright) walking the feature without mouse.
  - Color-contrast check on excluded-state pill + row (WCAG AA minimum on the muted colors).
- End-to-end tests (Playwright — `tests/e2e/chat-sources-toggle.spec.ts`):
  - The 6 "golden path" scenarios (§ Test plan).
  - The 4 "critical edge" scenarios.
- Performance measurement harness — seed a 500-source chat (dev-only helper), measure subscription-payload size, render time, toggle latency. Record numbers in `.perf/chat-sources-toggle.md`.
- Virtualization decision:
  - If 500-row render stays under 100ms on a MacBook-class machine and bulk toggle feels snappy, **do not install** `@tanstack/react-virtual`. Record the decision.
  - If either metric degrades below threshold, scope a P7 follow-up (out of this plan set).
- Known-issue triage pass — open a short markdown memo for any behavior this plan discovers that's not a regression but is a small papercut, to be folded into a future polish sprint.
- Final acceptance matrix — cross-reference every decision D1–D16 to a test that proves it holds.

**Out of scope**

- Any schema or Convex-function change (plans 01–03 locked the backend).
- Any new product feature (collaboration, multi-select chips, group ops — rejected in grilling).
- Virtualization implementation (contingent P7 if measurement forces it).

## Design

### 1. Motion palette

Keep it tight. Four animations total, all ≤ 200ms, all `ease-out`.

| Surface | Trigger | Motion | Duration |
|---|---|---|---|
| Row in Sources panel | Appears after search/chip filter | Fade + slight `y: 4 → 0` | 150ms |
| Row in Sources panel | Disappears after filter | Fade + `y: 0 → 4` | 120ms |
| Checkbox (single toggle) | Click | Spring pop on check icon | default `framer-motion` spring |
| Chip | Activation | Subtle 1.03 scale + fill fade | 150ms |
| Sort pill direction glyph | Direction flip | Crossfade `↑ ↔ ↓` | 120ms |
| Citation pill | Inclusion state change | Color + border crossfade | 180ms |
| Bulk toast | Appear | Slide up + fade | 180ms; auto-dismiss at 5000ms |

`framer-motion`'s `AnimatePresence` wraps the `sources-panel-list` to get automatic enter/exit orchestration. Stagger between row animations disabled by default (too visually busy at 50+ rows); enable only for ≤12 rows if telemetry ever shows users prefer it.

### 2. `prefers-reduced-motion`

Use the existing `useReducedMotion` hook from `framer-motion` (no extra install). Gate every animation through it:

```tsx
const reduceMotion = useReducedMotion();
const transition = reduceMotion ? { duration: 0 } : { duration: 0.15, ease: "easeOut" };
```

Verify via Playwright's `emulateMedia({ reducedMotion: "reduce" })` in the a11y E2E — assert that `data-motion-disabled` attribute (added to the panel root when reduced-motion is on) is `"true"` and no animation frames are produced across a tracked interaction.

Export the reduced-motion check as a data-attribute for test targeting:

```tsx
<SourcesPanel data-motion-disabled={reduceMotion ? "true" : "false"} ... />
```

### 3. A11y audit

**Automated (axe-core):**

- Install `@axe-core/react` if not present.
- Add `tests/a11y/sources-panel.axe.test.tsx` — renders panel against a seeded fixture, runs axe, expects 0 violations.
- Add `tests/a11y/paper-citation.axe.test.tsx` — each of 3 citation states, 0 violations.
- Add `tests/a11y/composer-empty-state.axe.test.tsx` — zero-included composer, 0 violations.

**Manual screen-reader trace matrix:**

Actions to verify announcements on VoiceOver + NVDA:

| Action | Expected announcement (paraphrased) |
|---|---|
| Focus Sources panel with `Tab` | "Sources, listbox, multi-select, 14 of 50 included" |
| Arrow-down to next row | "<Title>, <authors>, <year>, <source type>, included" |
| Press Space on an included row | "<Title>, excluded" |
| Type in search box | "Search sources, filtered, <N> results" |
| Click Include-all bulk | "Included 18 sources. Undo available 5 seconds." |
| Focus a citation pill | "Source 3, <title>, included" (or "excluded from context") |
| Focus excluded pill, open hover card | "Re-include for future turns, button" |
| Focus composer in zero-included state | "Chat needs at least one source. Include all, button." (region=alert) |

Record screenshots of VoiceOver / NVDA announcement text in `.a11y/chat-sources-toggle-trace.md`. Fix any gap before marking the plan done.

**Keyboard-only Playwright walkthrough:**

Single E2E test that performs the entire happy path with no `page.mouse` calls — only `keyboard.press`. Required to pass.

**Color contrast:**

Measure with [Colour Contrast Analyser](https://www.tpgi.com/color-contrast-checker/) or equivalent:

- Excluded row text (`text-muted-foreground` on the panel background) ≥ 4.5:1 for body text.
- Excluded pill text (`text-muted-foreground` on `bg-muted/40`) ≥ 4.5:1.
- Chip "disabled" state — often a failure point; confirm.

If any ratio fails, adjust the token (not a class override) and re-measure. Record ratios in the audit memo.

### 4. End-to-end scenarios

**Playwright — `tests/e2e/chat-sources-toggle.spec.ts`:**

**Golden path (6 scenarios):**

1. **Default included** — create a new chat with 5 sources, open chat, assert all 5 rows show `data-paper-included="true"`, composer shows `"5 of 5 sources in context"`, send button enabled.
2. **Single toggle** — click one checkbox, assert that row flips visually, composer updates to `"4 of 5"`, another `sendMessage` succeeds with only 4 papers in the prompt.
3. **Bulk exclude all + undo** — click Exclude all, assert composer shows `"0 of 5"`, send disabled, banner with Include-all CTA visible. Click Undo in bulk toast. Assert back to 5 of 5.
4. **Search + bulk on filtered** — type a query that narrows to 2 rows, click Include all (visible), assert banner appears offering "Include all 5 sources", click it, assert all 5 included.
5. **Sort persistence** — sort by Title, refresh page, assert Title pill is still active with correct direction arrow.
6. **Chip filter** — click OpenAlex chip, assert only `data-paper-source="openalex"` rows visible; chip count shown; click `All` to reset.

**Critical edges (4 scenarios):**

7. **Toggle mid-stream doesn't corrupt current stream** — send a message, while streaming toggle off a source the stream is about to cite. Assert the streaming reply's citation pill renders in its *final* state as `data-citation-state="excluded"` (live read), but the text content is whatever the LLM produced (unchanged by the toggle).
8. **Past message citation still resolves after exclusion** — send a message that cites `[P3]`, wait for completion, exclude source at position 3. Assert the historical pill is now `data-citation-state="excluded"` but still clickable and still opens the paper's primary link.
9. **Send rejection on zero-included** — force a race by modifying `chatPapers` directly to exclude all before the composer has updated, then attempt `sendMessage`. Assert `ConvexError.data.code === "no_sources_included"` and the composer flips to the empty-state banner reactively.
10. **Mobile Sheet round-trip** — emulate `viewport: { width: 600 }`, assert the persistent rail is hidden, the `data-sources-trigger` button is visible. Tap trigger, assert Sheet opens, toggle a paper, close Sheet, reopen — assert state persisted.

### 5. Performance measurement

**Seed helper — `convex/chat/adminPerfSeed.ts`:**

```ts
export const seedPerfChat = internalMutation({
  args: { count: v.number() },
  handler: async (ctx, { count }) => {
    // Dev-only gate — reuse plan 01's pattern.
    // Create one chat-mode extractionJob, insert N extractionJobSources
    // with synthetic titles/authors/abstracts, seed chatPapers 1:1 included=true.
    // Return { jobId, threadId } for test navigation.
  },
});
```

**Measurements — run on dev machine, record in `.perf/chat-sources-toggle.md`:**

| Metric | How | Threshold |
|---|---|---|
| `listChatSourcesWithInclusion` payload (500 rows) | Chrome DevTools → Network → WS frames | < 500 KB |
| First render time of Sources panel at 500 rows | React Profiler | < 100 ms |
| Single-toggle latency (click to pill flipped visually) | Playwright `page.evaluate` with `performance.mark` | < 50 ms (optimistic) |
| Bulk Include-all (500 rows) latency to UI reconciled | Same | < 400 ms |
| Rapid-toggle — 10 clicks in 2 seconds, final state correct | Playwright loop | 100% correctness, no dropped clicks |
| Subscription re-push on toggle | Count WS frames | Exactly 1 per toggle |

If any threshold fails:
- Payload > 500 KB → split query (static sources + reactive inclusion map).
- Render > 100 ms → install `@tanstack/react-virtual`, wrap the list with `overscan: 8`.
- Toggle latency > 50 ms → inspect React tree for unnecessary re-renders, memoize row component.
- Bulk > 400 ms → confirm `.withOptimisticUpdate` is actually updating the cached query (check DevTools React render count).

Record decisions + rationale in the perf memo. Do not silently install virtualization; either it's needed (measured) or it's not (measured).

### 6. Known-issue triage

During this plan's testing, any UX papercut that's **not** a regression but **is** a polish opportunity gets a one-liner in `.planning/papercuts-chat-sources-toggle.md`. Examples: "chip counts re-animate on every toggle (minor)", "hover card latency feels slightly off on mobile tap". These are not blockers. They feed a future sprint.

### 7. Final acceptance matrix

Table in this plan, filled once all tests pass. Cross-references D1–D16 to the exact test file + test name that proves the decision holds.

| Decision | Test file | Test name |
|---|---|---|
| D1 (positional IDs stable) | `lib/chat/render-corpus.test.ts` | "P IDs preserved across toggle" |
| D1 (resolver honors gaps) | `lib/chat/resolve-paper.test.ts` | "resolves with positional gaps" |
| D2 (live read, no snapshot) | `tests/e2e/...spec.ts` | "Critical edge #7" |
| D2 (regenerate uses live) | `tests/e2e/...spec.ts` | "regenerate uses current toggle state" (add if missing) |
| D3 (bridge table) | `convex/schema.ts` + `convex/chat/chatPapersLifecycle.test.ts` | "seed 1:1" |
| D4 (single surface) | `tests/chat/sources-panel/*.test.tsx` | "renders all chat papers" |
| D5 (bulk ops) | `tests/chat/sources-panel/*.test.tsx` | "bulk Include/Exclude/Invert" + "Gmail extension banner" |
| D6 (weighted search) | `lib/chat/search/source-scorer.test.ts` | 14 cases |
| D7 (chips single-select) | `tests/chat/sources-panel/*.test.tsx` | "chip filter narrows" |
| D8 (sort pills + URL) | `tests/chat/sources-panel/*.test.tsx` | "sort pills" + "URL params persist" |
| D9 (empty-state block send) | `tests/e2e/...spec.ts` | "Golden path #3" + "Critical edge #9" |
| D10 (regenerate uses live) | As D2 | — |
| D11 (toggle during streaming) | `tests/e2e/...spec.ts` | "Critical edge #7" |
| D12 (excluded row styling) | `tests/chat/sources-panel/*.test.tsx` | "data-paper-included attribute" |
| D13 (toast-undo bulk) | `tests/chat/sources-panel/*.test.tsx` | "bulk toast undo reverts" |
| D14 (seed / cascade / duplicate) | `tests/chat/chatPapersLifecycle.test.ts` | 5 cases |
| D15 (row layout) | `tests/chat/sources-panel/source-row.test.tsx` | "renders title + meta + chip" |
| D16 (citation tri-state) | `tests/chat/paper-citation.test.tsx` | 3 state cases |

Fill the matrix when the tests exist. Any blank row = not done.

## TDD sequence

This plan has **no new pure-logic modules**. Motion, a11y, and perf are test-after. Skip the TDD ceremony.

If during implementation a small pure helper emerges (e.g., "compute staggered delays for N rows"), TDD it before wiring into the component. Otherwise proceed directly.

## Files touched

- `components/extraction/chat/sources-panel/*.tsx` — motion wrappers, reduced-motion data attribute.
- `components/extraction/chat/paper-citation.tsx` — pill state-change transition.
- `tests/a11y/sources-panel.axe.test.tsx` (new)
- `tests/a11y/paper-citation.axe.test.tsx` (new)
- `tests/a11y/composer-empty-state.axe.test.tsx` (new)
- `tests/e2e/chat-sources-toggle.spec.ts` (new) — 10 scenarios (6 golden + 4 edge).
- `convex/chat/adminPerfSeed.ts` (new) — 500-row seed helper, dev-gated.
- `.perf/chat-sources-toggle.md` (new) — measured numbers + decisions.
- `.a11y/chat-sources-toggle-trace.md` (new) — SR announcement log.
- `.planning/papercuts-chat-sources-toggle.md` (new) — polish backlog.

## Migration stance — **none**

No schema changes. No data changes.

## Test plan

All test content is already enumerated above in § E2E scenarios and § A11y audit. No additional plan here — this plan's plan IS tests.

## Acceptance criteria

- [ ] Every animation gates on `prefers-reduced-motion`; a data attribute exposes the state.
- [ ] Axe produces 0 violations on Sources panel, citation pill, composer empty-state.
- [ ] VoiceOver and NVDA announcement trace recorded in `.a11y/chat-sources-toggle-trace.md` with no gaps.
- [ ] All 6 golden-path E2E scenarios pass on CI.
- [ ] All 4 critical-edge E2E scenarios pass on CI.
- [ ] Keyboard-only Playwright walkthrough passes.
- [ ] Perf numbers recorded in `.perf/chat-sources-toggle.md`; all thresholds met OR a P7 follow-up is scoped.
- [ ] Color-contrast ≥ 4.5:1 for excluded state.
- [ ] Final acceptance matrix table in this file has all 16 rows pointing to real tests.
- [ ] `rg -n "prefers-reduced-motion" components/` returns at least one match (the gating).

## Known pitfalls

- **Axe runs require actual DOM** — use JSDOM with the component mounted in a `render()` call. Some shadcn primitives use portals (HoverCard, Sheet); axe only sees mounted DOM, so portals may need explicit mount targets in the test. Read axe + @testing-library docs before assuming.
- **Screen-reader traces are manual and subjective** — different SR versions announce differently. Record what the tester actually heard, not what the APG spec says they "should" hear. Discrepancies flag real UX issues.
- **Playwright streaming assertions are flaky** — use `expect.toHaveText` with a retry window rather than raw `toBe`; LLM stream timing varies. Add a test-only mode that swaps the LLM for a deterministic mock if needed (likely already present — check `convex/chat/agent.ts` for a dev toggle).
- **Perf seed runs in dev only** — gate with the same pattern as plan 01's backfill. Never ship a 500-row seed to prod.
- **Virtualization add-if-needed, not just-in-case** — if measurements are under thresholds, **do not** install `@tanstack/react-virtual`. Virtualization has its own complexity (focus management, keyboard scroll-into-view, screen-reader issues). Only install when measured pain forces it. Record the decision either way.
- **Reduced-motion on iOS Safari** — `prefers-reduced-motion` is respected but `useReducedMotion` from framer-motion may not re-fire if the user changes the setting mid-session. Accept as a known minor; the setting is rarely toggled mid-session.
- **Final acceptance matrix is aspirational until filled** — the checkbox at the top of this plan is the hard gate. Don't claim done until every D1–D16 row points to a real test that's passing in CI.
