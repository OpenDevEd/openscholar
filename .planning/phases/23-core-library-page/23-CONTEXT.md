# Phase 23: Core Library Page - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Dedicated `/library` route where authenticated users browse, search, filter, sort, and manage their saved papers. Auth gate, paginated item list, search, filter by rating, sort options, remove with confirmation, empty states. Collections, advanced date filters, URL state persistence, export, and view mode switching belong in later phases.

</domain>

<decisions>
## Implementation Decisions

### Page layout & item display
- Compact vertical list — one row per item, not cards or table
- Each row shows: rating stars, title, authors, publication year, journal name, cited_by_count, open access badge
- Clicking a row expands it inline to reveal the abstract and a link to the full paper
- Three-dot overflow menu (⋯) on each row for destructive actions (remove)

### Search bar
- Full-width search bar at the top of the page, above the list — always visible
- Debounced live search (~300ms) — results update as user types, no Enter required
- Searches by title, author, and abstract text via Convex search index

### Rating filter
- Clickable star row — click a star to filter by that rating and above (e.g., click 3★ = show 3, 4, 5 star papers)
- Click the same star again to clear the filter

### Sort controls
- "Sort by" dropdown with options: Date saved, Rating, Publication year
- Each option has asc/desc toggle

### Pagination
- "Load more" button at bottom of list (not infinite scroll, not numbered pages)
- 20 items per batch via Convex `.paginate()` cursor-based pagination
- Total item count displayed at top of page (e.g., "X papers in your library")

### Loading states
- Skeleton row placeholders mimicking list layout during initial fetch and load-more

### Empty library state
- Illustration/icon + message ("Your library is empty") + CTA button linking to search to start rating papers

### Empty search/filter results
- Inline message: "No papers match your search/filters" with a "Clear filters" button to reset all active filters

### Removal flow
- Confirmation dialog (small modal): "Remove [Paper Title] from your library?" with Cancel/Remove buttons
- Triggered from three-dot menu on the list row

### Auth gate
- Unauthenticated users visiting /library are immediately redirected to sign-in page with return URL
- After sign-in, user lands back on /library

### Claude's Discretion
- Exact spacing, typography, and color choices within existing design system
- Skeleton animation style
- Empty state illustration choice
- Dual-path query strategy implementation details (search mode vs browse mode switching)
- How sort direction toggle is presented in the dropdown
- Debounce timing fine-tuning

</decisions>

<specifics>
## Specific Ideas

- List rows should feel compact and scannable — more like Linear's issue list than a cluttered academic table
- Rating filter as a clickable star row is the primary visual filter control — should feel native, not like a form input
- "Load more" is deliberate — user stays in control of how much they load

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 23-core-library-page*
*Context gathered: 2026-02-28*
