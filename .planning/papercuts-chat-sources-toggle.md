# chat-sources-toggle — Polish Backlog (Plan 06)

> Captured during plan-06 testing. **None of these are regressions.**
> They are small UX rough edges that surfaced while exercising the
> feature end-to-end. Triage in a future polish sprint.

## P0 — Visible UX

(none)

## P1 — Light-theme disabled chip is barely legible

**Symptom.** Source-type chip with `count===0` is rendered with
`disabled:opacity-50`. In bright/light theme, this gives a contrast
ratio of ~1.88:1 (foreground 50%-mixed over background) — exempt from
WCAG AA per SC 1.4.3 (inactive UI), but still pinches usability when
a user wants to confirm the chip exists.

**Fix sketch.** Either bump opacity to 60% or pair the disabled state
with a subtle outline so the chip remains visually scannable while
clearly inactive.

**Source.** `.a11y/chat-sources-toggle-contrast.md` § Disabled chip.

## P1 — Search filtered-count not announced live

**Symptom.** When the user types a query, the listbox option count
changes but neither VoiceOver nor NVDA announces "N results" until
the user presses ArrowDown into the listbox. APG-conformant but not
maximally helpful for SR users searching by typing.

**Fix sketch.** Add a sibling `role="status"` + `aria-live="polite"`
near the search input that re-renders to "{N} sources match" when the
filtered set changes. Throttle to once per 250 ms to avoid SR spam.

**Source.** `.a11y/chat-sources-toggle-trace.md` § Gap #4.

## P1 — Bulk-toast Undo duration not voiced

**Symptom.** The bulk-action toast carries an Undo button that
auto-dismisses after 5 s. SR users hear the toast text and the Undo
button label, but nothing tells them how long they have to act before
the button vanishes.

**Fix sketch.** Render an SR-only `<span>` inside the toast: "Undo
available for the next 5 seconds." Sonner allows custom action JSX, so
the visible label can stay clean.

**Source.** `.a11y/chat-sources-toggle-trace.md` § Gap #5.

## P2 — Chip counts re-animate on every toggle

**Symptom.** The chip count text re-renders on every paper toggle
because the chip-counts hook recomputes on each `chatPapers` push. With
the new motion wrappers, the chip's parent `motion.div` is at scale 1
(no animation triggered), so the text cross-fades briefly only when
the active chip changes — but the count number visually flickers on
every toggle.

**Fix sketch.** Memoize chip counts on `(chatPapers length, included
parity bitmap)` so micro-toggles that don't change a chip's count
don't re-render the chip at all.

**Source.** Observed during plan-06 manual exercise of bulk operations.

## P2 — HoverCard latency feels off on mobile tap

**Symptom.** The chat citation pill HoverCard opens on tap on mobile.
The tap-to-open felt slightly laggy (~250 ms) compared to a real mouse
hover; users sometimes tap a second time thinking the first didn't
register, which closes the card immediately.

**Fix sketch.** Consider a Sheet/Dialog variant for the pill on mobile
breakpoints — explicit open/close beats hover semantics on touch.

**Source.** Observed during plan-06 mobile Sheet exercise (#10).

## P3 — Search and chip changes don't reset sort scroll position

**Symptom.** After filtering or sorting, the panel doesn't scroll the
list back to the top. If the user had scrolled to position N before
filtering, the list reveals position N of the filtered set, which
sometimes shows nothing.

**Fix sketch.** When `state.q`, `state.src`, or `state.sort/dir`
changes, scroll the panel container to top.

**Source.** Observed during plan-06 manual exercise of sort + filter.
