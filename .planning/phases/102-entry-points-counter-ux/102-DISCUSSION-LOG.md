# Phase 102: Entry Points & Counter UX - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 102-entry-points-counter-ux
**Areas discussed:** Counter & Progress Bar Placement, AddToExtractionButton Mount Points, Bulk-Paste Drop Toast Behavior, Cap-Disabled Checkbox UX
**Mode:** --auto (all decisions auto-selected)

---

## Counter & Progress Bar Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Shared component in drawer + selector page | Create `<ExtractionCounter>` reusable in both basket drawer header and `/extraction/new` selector page | ✓ |
| Drawer-only counter | Counter only in the basket drawer; selector page builds its own | |
| Inline counter per location | Each location has its own counter implementation | |

**User's choice:** [auto] Shared component (recommended default — DRY, satisfies LIM-04 which requires both locations)
**Notes:** LIM-04 explicitly requires the counter in the basket drawer AND on the selector page. A shared component prevents drift between the two display points.

---

## AddToExtractionButton Mount Points

| Option | Description | Selected |
|--------|-------------|----------|
| Library + search results as standalone icon button | Mount in LibraryItemActions and PaperCard action bar as a visible icon button | ✓ |
| Inside existing dropdown menus | Add as a dropdown menu item within existing action menus | |
| Library + search + bookmarks | Mount in all three surfaces including bookmarks | |

**User's choice:** [auto] Library + search results as standalone icon button (recommended default — bookmarks manage keyword bookmarks not papers; standalone button is more discoverable)
**Notes:** Bookmarks page handles keyword bookmarks, not individual papers — no per-paper action slot exists. SEL-11's "bookmarks command centers" maps to library and search which are the actual paper-browsing surfaces.

---

## Bulk-Paste Drop Toast Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Info toast with exact counts | "Added {added} papers; {dropped} dropped — basket limit reached" | ✓ |
| Error toast blocking the action | Show error and refuse all entries | |
| Silent truncation with subtle indicator | Add what fits, show count change only | |

**User's choice:** [auto] Info toast with exact counts (recommended default — LIM-06 requires explicit count communication; anti-feature: silent truncation is explicitly rejected in REQUIREMENTS.md Out of Scope)
**Notes:** The toast uses "info" variant, not "error" — truncation is expected behavior. The drop order is "first N fit" with no prioritization.

---

## Cap-Disabled Checkbox UX

| Option | Description | Selected |
|--------|-------------|----------|
| Muted/grayed with tooltip | Disabled visual state with "Basket full — remove N papers to continue" tooltip | ✓ |
| Hidden add buttons at cap | Remove add buttons entirely when cap reached | |
| Warning badge overlay | Keep buttons active but show warning before adding | |

**User's choice:** [auto] Muted/grayed with tooltip (recommended default — matches LIM-05 requirement verbatim; consistent with Phase 99's "already in basket" muted checkbox pattern)
**Notes:** Cap-disabled state driven by a shared `useIsBasketFull` selector comparing `papers.size >= limit` from the reactive query. Single comparison point prevents desync.

---

## Claude's Discretion

- Exact Tailwind color classes for yellow/red progress bar thresholds
- Animation on badge count changes
- Test file organization
- Whether `useIsBasketFull` is a standalone hook or inline selector
- Icon choice for AddToExtractionButton (Plus/Check from lucide-react)

## Deferred Ideas

None — discussion stayed within phase scope.
