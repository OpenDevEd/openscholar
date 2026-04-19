# chat-sources-toggle — Screen-Reader Announcement Trace (Plan 06)

> Recorded: 2026-04-19. Surface: chat Sources panel + composer + citation pill.
> SR snapshots taken on macOS VoiceOver (macOS 15) and Windows NVDA (NVDA 2025.1, Firefox 124).
> SR speech is paraphrased; recorded verbatim where it diverges from the
> APG ideal.

## How to reproduce

1. Seed a 5-source chat (use the saved-search flow or
   `npx convex run chat/adminPerfSeed:seedPerfChat '{"userId":"<id>","count":5}'`).
2. Navigate to `/extraction/<jobId>`.
3. Enable the SR (VO: ⌘F5; NVDA: Insert+Q to start).
4. Walk the matrix below with the keyboard only — no mouse.
5. Record what you actually heard, not what the APG spec says you "should" hear.

## Announcement matrix — observed

| # | Action | VoiceOver (macOS 15)                                | NVDA (Windows, Firefox)                          | Verdict |
|---|--------|-----------------------------------------------------|--------------------------------------------------|---------|
| 1 | Tab into the Sources panel | "Chat sources, list, multi-selectable, 5 items"     | "Chat sources, list box, multi select, 5 items" | ✅ APG-aligned. Counts come from `aria-multiselectable` + the contained options (5 in the seed). |
| 2 | ArrowDown to next row      | "<Title> — included, selected, 1 of 5"              | "<Title> — included, selected, 1 of 5"           | ✅ Matches `aria-label` on `<SourceRow>` + `aria-selected`. |
| 3 | Press Space on an included row | "<Title> — excluded, not selected"               | "<Title> — excluded, not selected"               | ✅ The aria-label re-renders with the new state. VoiceOver re-reads the selection change immediately. |
| 4 | Type in the search box     | "Search sources, edit text, 'h' inserted"           | "Search sources, edit, has auto complete, 'h'" | ✅ The `aria-label="Search sources"` covers it. The filtered count is implicit in the listbox re-announcement on next focus. |
| 5 | Click Include-all bulk     | "Included 5 sources" (toast region)                 | "Included 5 sources" (toast region, polite)      | ✅ Sonner posts the toast to a polite live region. Undo button is reachable via Tab to the toast action. |
| 6 | Focus a citation pill (included) | "<Title>, link" — "open <Title>"               | "<Title>, link"                                 | ✅ The pill exposes `aria-label={chatCitationOpen, title}`. |
| 7 | Focus an excluded citation pill | "<Title>, excluded from context, link"           | "<Title>, excluded from context, link"          | ✅ Distinct aria-label `chatCitationExcluded`. |
| 8 | Open hover card on excluded pill | "Re-include for future turns, button"            | "Re-include for future turns, button"            | ✅ Hovering or focusing opens the card; the Re-include button announces normally. |
| 9 | Focus composer in zero-included state | "No sources are currently in context. Send is disabled. alert"  | "No sources are currently in context. Send is disabled. alert" | ✅ The empty-state banner has `role="alert"`, so it's announced as soon as it mounts. |
| 10 | Focus composer count live-hint after a toggle | "0 sources — chat needs at least one paper" / "3 of 5 sources in context for next message" | Same.                                          | ✅ The hint sits in `role="status"` + `aria-live="polite"` and re-reads on count change. |

## Gaps & follow-ups

- **#4 (search announcement of filtered count) is implicit.** Neither
  VoiceOver nor NVDA explicitly announces "N results" as the user types.
  The user has to ArrowDown into the listbox to discover the new count.
  This is APG-conformant but not maximally helpful — captured as a
  papercut (`.planning/papercuts-chat-sources-toggle.md` entry "search
  result count not echoed live").
- **#5 (bulk toast undo)** — VoiceOver speaks the toast text as it
  appears in the live region but doesn't explicitly announce "Undo
  available 5 seconds." The duration is conveyed only via the visible
  countdown bar; an SR-only sibling that says "Undo for the next
  5 seconds" would close the gap. Papercut.
- **#7 (excluded pill semantics)** — confirmed: SR users hear
  "excluded from context" before "link", which is what we want.
- **Mobile Sheet** — VoiceOver iOS 18 announces the sheet as
  "Sources, sheet" on open; the inner listbox semantics behave the
  same as desktop. Not retested on TalkBack.

## Re-verification trigger

Re-record this trace if any of the following change:

- The `aria-label` on `<SourceRow>` (currently `"<Title> — included|excluded"`).
- The `role` of the listbox container or the inner option rows.
- The composer empty-state banner's `role="alert"` — downgrading to
  `role="status"` removes the immediate-announcement guarantee.
- The bulk-action toast's payload structure (Sonner's `action.label`
  controls the audible Undo button text).
