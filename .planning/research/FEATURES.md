# Feature Research: Academic Library UI Overhaul

**Domain:** Academic paper management and library browsing interface
**Researched:** 2026-03-01
**Confidence:** HIGH

## Executive Summary

Academic search tools (Zotero, Mendeley, Semantic Scholar, Google Scholar, PubMed) converge on a consistent library interface pattern: left sidebar for navigation/filtering, center content area for paper list, right panel for metadata/details. Modern expectations include collapsible sidebars for mobile, fast search across saved papers, and organizational primitives (collections, tags, ratings). The gap between tools is not in table stakes, but in how *intelligently* filtering and search work (Zotero's advanced search + full-text PDF searching vs. Mendeley's simpler approach) and how quickly users can organize and find what they saved.

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Search within saved papers** | Standard in all academic tools; users add papers they forget | MEDIUM | Must support: title, author, partial text. CRITICAL: Zotero users cite advanced search as key differentiator vs. Mendeley. |
| **Filter sidebar with collapsible state** | Zotero 7, Mendeley, Semantic Scholar all use left sidebar for global filters | MEDIUM | Must hide on mobile (tabs/drawer), stay visible on desktop. Show active filter count as badge. |
| **Collections/Folders for organization** | Every tool provides this; users expect to group papers by project/topic | LOW | OpenAlex Count already has collections; reuse junction table. |
| **Sort options (date saved, year, rating, title)** | Users need multiple sort orders; most frequent: newest first, highest rated | LOW | Already partially implemented; expose in UI clearly. |
| **Pagination or infinite scroll** | Standard for list-heavy interfaces; avoids loading 1000+ items at once | LOW | Depends on UX choice; pagination is safer for predictability. |
| **Two-column layout (sidebar + content)** | Standard pattern across search results and saved libraries | LOW | Already designed for search page; reuse TwoColumnLayout component. |
| **Mobile responsive with tab-based filters** | Zotero, Mendeley, Google Scholar all provide mobile view; sidebar→tabs on mobile | MEDIUM | Use existing SearchSidebar component that already handles this. |
| **Bulk actions on selected papers** | Export CSV/JSON, add to collection, remove from library (common task) | MEDIUM | Zotero allows multi-select; Mendeley allows starring. |
| **Quick filtering (by collection, date range, saved status)** | Users want instant visual filtering without page reload | LOW | Already have nuqs for URL state; live filter from existing state. |
| **Rating/starred visual indicator** | Visual feedback for rated papers (already saved to Convex per v2.1) | LOW | Already have rating data; expose in list view and detail pane. |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **AI-powered search/tagging suggestions** | Mendeley 2025 offers AI to interpret queries; offers smart categorization | HIGH | Requires LLM integration; consider for v3. Out of scope for v2.2. |
| **Full-text PDF search in saved papers** | Zotero's core strength over Mendeley; searchable extracted text from PDFs | HIGH | Would require PDF text extraction pipeline; not applicable since OpenAlex Count doesn't store PDFs. |
| **Smart collections (automatic grouping)** | ResearchGate, R Discovery mention auto-grouping by tag combinations | MEDIUM | Example: auto-create "ToRead + AI_Ethics" collection. Deferred per PROJECT.md. |
| **Shared reading lists with team permissions** | Paperpile, R Discovery, Mendeley Groups offer shared libraries with role-based access | HIGH | Deferred per PROJECT.md (collaborative libraries are v3+). |
| **Citation format preview in sidebar** | Zotero allows customizing item pane to show APA/Chicago/MLA inline | MEDIUM | Would require citation formatter integration; lower priority than filtering. |
| **Related papers discovery** | Semantic Scholar surfaces related papers in library context | MEDIUM | Requires embedding similarity / citation graph; future enhancement. |
| **One-click bulk export** | Quick export whole collection or filtered subset as CSV/JSON/BibTeX | MEDIUM | Already have CSV/JSON export; expose in toolbar with collection scope. |
| **Keyboard shortcuts for power users** | Zotero power users rely on keyboard navigation and shortcuts | LOW | Add later once core interaction is solid. Not critical for v2.2. |
| **Contextual inline actions** | Hover to see "Add to collection", "Export", "Remove" on each row | LOW | Nice UX polish; defer until core filtering is optimized. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Hierarchical nested collections** | "I want deep folder trees for organization" | Creates complex navigation, slow filtering, confuses export/sharing | Flat collections with smart filtering and tagging; users learn to use tags for sub-grouping |
| **Tags as first-class org system (parallel to collections)** | "Tags are more flexible than folders" | Users create too many tags, tag inconsistently, can't effectively filter by tag combinations | Use tags + collections together: tags are labels, collections are groupings. Make tag filtering optional sidebar. |
| **Real-time sync / live updates** | "See changes instantly from other team members" | Adds complexity, creates flaky UX (notifications pop while users click), requires server push | Defer to v3 (collaborative libraries). For now, simple page refresh is fine. |
| **Full-text PDF search** | "I want to search words inside PDFs I saved" | OpenAlex Count doesn't store PDFs, so this is impossible. Users are confused by promise unfulfilled. | Instead: emphasize that OpenAlex metadata is fully searchable; point users to Zotero for PDF annotation workflows. |
| **Nested filtering (AND/OR logic in filter sidebar)** | "I want papers from 2020+ AND tagged 'machine-learning' AND in my 'ToRead' collection" | Complex UI to express, most users just want simple AND; OR logic is rare and confusing | Keep simple: all selected filters apply as AND. Future: advanced search syntax if demand materializes. |
| **Infinite scroll in library** | "Feels more modern than pagination" | Creates unpredictable scroll behavior, makes "jump to top" annoying, harder to count results, poor for mobile | Use pagination (or lazy-load with "Load more" button). Shows result count up front. |
| **Auto-tagging on save** | "Automatically tag papers by field/topic on import" | Users distrust auto-tagging, it's often wrong, clutters the space. Requires ML, maintenance overhead | Instead: offer optional templates. Let users tag manually on save (takes 5 seconds). Simpler, more trustworthy. |

## Feature Dependencies

```
Two-Column Layout (sidebar + content)
    └──requires──> TwoColumnLayout component (ALREADY EXISTS)
    └──requires──> FilterSection reuse (ALREADY EXISTS)

Filter Sidebar (collapsible)
    └──requires──> SearchSidebar component (ALREADY EXISTS)
    └──requires──> Mobile responsive tabs (ALREADY EXISTS)
    └──enhances──> Quick Filtering (instant live refresh)

Search Within Library
    └──requires──> Convex index on libraryItems (LIKELY EXISTS via dual-path query)
    └──enhances──> Filter Sidebar (narrow results before filtering)

Collections Display
    └──requires──> libraryItemCollections junction table (ALREADY EXISTS)
    └──requires──> Collection CRUD (ALREADY EXISTS)
    └──enhances──> Bulk Actions (export collection subset)

Bulk Actions
    └──requires──> Multi-select UI component (NEW)
    └──requires──> Async toast pattern (ALREADY EXISTS)
    └──enhances──> CSV/JSON export (export-with-scope)

Rating Display
    └──requires──> Rating data in libraryItems (ALREADY SAVED in v2.1)
    └──enhances──> Sort options (sort by rating)

Mobile Responsive View
    └──requires──> SearchSidebar mobile tab mode (ALREADY EXISTS)
    └──conflicts──> Infinite scroll (use pagination instead)
```

### Dependency Notes

- **TwoColumnLayout + FilterSection + SearchSidebar are prerequisite**: These exist from search page; reuse saves implementation cost.
- **Multi-select UI is new**: Required for bulk actions (export, add to collection). Consider checkbox column in table.
- **Convex index assumptions**: Research assumes dual-path query already indexes libraryItems for fast search. Verify before implementation.
- **Mobile tabs vs. desktop sidebar**: Already solved on search page; reuse the exact same pattern.
- **Pagination vs. infinite scroll**: Incompatible choices. Pagination is safer (predictable UX, shows result count), but infinite scroll feels more modern. Recommend pagination for predictability + accessibility.

## MVP Definition

### Launch With (v2.2)

Minimum viable product for library UI overhaul — what's needed to match search page design quality.

- [x] **Two-column layout** — Reuse existing TwoColumnLayout component; non-negotiable for consistency
- [x] **Collapsible filter sidebar (desktop)** — Reuse SearchSidebar; must work identically to search page
- [x] **Mobile-responsive tabs for filters** — Reuse SearchSidebar mobile mode; no new code needed
- [x] **Filter state persistence via nuqs** — Already used on search page; reuse exact same pattern
- [x] **Search within saved papers** — Convex query optimization; must support title + author search
- [x] **Collections filter** — Already exists (v2.1); expose in FilterSection
- [x] **Sort options** — Expose: date saved (desc), year (desc), rating (desc), title (asc)
- [x] **Pagination** — Show results per page with prev/next controls
- [x] **Rating visual in list** — Show saved rating (0-5 stars or similar) on each row

### Add After Validation (v2.3)

Features to add once core library UI is stable and users are actively using it.

- [ ] **Bulk actions (multi-select)** — Checkbox column, "Export selected", "Add to collection", "Remove from library"
- [ ] **Inline quick actions** — Hover state: "Add to collection" dropdown on each row
- [ ] **Tag filter sidebar section** — Show user's tags as optional filter (current scope: collections + date + year only)
- [ ] **Citation format display** — Inline preview of APA/Chicago/MLA format for each paper

### Future Consideration (v3+)

Features to defer until library collaboration is ready or demand is clear.

- [ ] **AI-powered search** — Smart query interpretation (when LLM features expand)
- [ ] **Smart collections** — Auto-group by tag combinations (deferred: complex filtering UX)
- [ ] **Shared reading lists** — Team access with permissions (deferred: requires user/permission model)
- [ ] **Full-text PDF search** — Not applicable; OpenAlex Count doesn't store PDFs
- [ ] **Related papers discovery** — Requires embedding similarity; future enhancement
- [ ] **Keyboard shortcuts** — Power user feature; defer until core UX is polished
- [ ] **Nested collections** — Anti-feature; don't implement

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Notes |
|---------|------------|---------------------|----------|-------|
| Two-column layout | HIGH | LOW | P1 | Reuse existing component |
| Collapsible sidebar | HIGH | LOW | P1 | Reuse existing component |
| Mobile tabs for filters | HIGH | LOW | P1 | Reuse existing component |
| Search within library | HIGH | MEDIUM | P1 | Convex optimization required |
| Collections filter | HIGH | LOW | P1 | Already exists (v2.1) |
| Sort options (date, year, rating) | HIGH | LOW | P1 | Simple UI addition |
| Pagination | MEDIUM | LOW | P1 | UX best practice |
| Rating visual | MEDIUM | LOW | P1 | Data already saved |
| Bulk actions | MEDIUM | MEDIUM | P2 | Multi-select UI new |
| Tag filter section | MEDIUM | MEDIUM | P2 | Optional sidebar enhancement |
| Inline quick actions | MEDIUM | LOW | P2 | Polish feature |
| Citation format display | MEDIUM | MEDIUM | P2 | Requires formatter integration |
| Smart collections | LOW | HIGH | P3 | Complex filtering logic |
| AI-powered search | LOW | HIGH | P3 | Feature scope expansion |
| Shared reading lists | LOW | HIGH | P3 | Requires permission model |
| Related papers discovery | LOW | HIGH | P3 | Requires embedding similarity |

## Competitor Feature Analysis

| Feature | Zotero 7 | Mendeley 2025 | Semantic Scholar | Google Scholar | Our Approach (OpenAlex Count) |
|---------|----------|---------------|------------------|-----------------|------|
| **Sidebar filters** | Yes, collapsible + vertical tabs | Yes, left sidebar | Yes, collections + tags | No (Google Scholar library is minimal) | Match Zotero/Mendeley pattern |
| **Search within library** | Advanced (full-text PDF + metadata) | Basic (title/author only) | Basic (metadata + collections) | Very basic | Metadata + title/author search (Mendeley-level) |
| **Collections/Folders** | Yes, unlimited nesting | Yes, flat hierarchy | Yes, collections | Minimal | Flat collections (PROJECT.md scope) |
| **Sorting options** | Yes (date, title, author, year) | Yes (date, title, author) | Limited | Very limited | Date, year, rating, title |
| **Multi-select/bulk export** | Yes (select rows, export) | Limited | Limited | No | Plan for v2.3 |
| **Mobile responsive** | Yes, tabs for filters | Yes | Yes | Yes | Reuse search page pattern |
| **Rating/starred items** | Yes (color-coded priority flags + stars) | Yes (starred favorites) | Limited | No | Show rating saved in v2.1 |
| **AI-powered search** | No | Yes (2025 feature) | Basic (related papers) | No | Deferred to v3+ |
| **PDF annotation** | Yes (built-in reader) | Yes (built-in viewer) | No | No | N/A (no PDFs stored) |
| **Shared libraries/groups** | Yes (groups with sync) | Yes (shared libraries + groups) | Limited | No | Deferred to v3+ (PROJECT.md) |

## Recommendations for v2.2 Roadmap

### Phase 1: Layout & Component Reuse (LOW RISK, HIGH IMPACT)

**What to do:** Transplant search page's two-column layout, FilterSection, and SearchSidebar directly to library page.

- No new components; pure DRY refactor
- Ensures design consistency across search and library
- Minimal implementation cost
- **Blockers:** None identified
- **Risk:** Very low (reusing tested components)

### Phase 2: Filter State & Quick Search (MEDIUM EFFORT, MEDIUM IMPACT)

**What to do:** Wire up nuqs-based filter state for library page using existing FilterSection.

Filter priorities (MVP scope):
1. **Collections** — Already exists (v2.1); expose as filter
2. **Date Saved (date range)** — "Past week", "Past month", "Past year", "Any time"
3. **Year Published (year range)** — Slider or dropdown for publication year
4. **Search box** — Global search across library (title + author at minimum)

Optional (v2.3):
- **Tags** — Show user's tags as optional sidebar filter
- **Rating** — Filter by minimum rating (if heavily used)

**Implementation pattern:**
- Reuse FilterSection exactly as-is from search page
- Pass `libraryItems` query result to FilterSection
- Use existing nuqs integration for URL state
- Convex: Verify dual-path query optimization for search-within-saved
- **Risk:** Medium (new filter combinations; need Convex index validation)

### Phase 3: Display Polish (LOW EFFORT, HIGH UX IMPACT)

**What to do:** Add visual indicators for rating, sort options, and pagination controls.

- Show rating (0-5 stars or label: "Rated 4", etc.) on each library item row
- Expose sort dropdown: Date Saved (desc), Year (desc), Rating (desc), Title (asc)
- Add pagination controls: "1-50 of 342 papers" with prev/next buttons
- Mobile: Ensure sort dropdown works in tab-based filter view

**Implementation pattern:**
- Reuse existing rating data saved in v2.1
- Add sort param to URL state (nuqs)
- Render pagination controls in footer

**Risk:** Low (visual feature; no backend changes)

### Phase 4: Bulk Actions (MEDIUM EFFORT, FUTURE)

**What to do:** Add multi-select checkboxes + toolbar for bulk operations.

- Checkbox column on each row (only visible when user hovers or explicitly enables "select mode")
- Bulk action toolbar: "Export selected as CSV", "Add selected to collection", "Remove from library"
- Toggle "Select all" checkbox in header

**Implementation pattern:**
- Use client-side state (Zustand or React state) to track selected row IDs
- Show toolbar only when selections exist
- Async toast pattern for async operations (already used in v2.1)

**Risk:** Medium (new interaction pattern; requires multi-select state management)

## What Not to Build

**Explicitly avoid these anti-features for v2.2:**

1. **Nested/hierarchical collections** — Users will request "folder trees" after seeing the organize section. Resist. Flat collections + smart tagging is more powerful. (Already deferred in PROJECT.md)

2. **Real-time multi-user sync** — Tempting if thinking about future team features. Don't. Page refresh is fine. Adds hidden complexity. (Deferred in PROJECT.md)

3. **Full-text PDF search** — Users familiar with Zotero may expect this. Clarify: OpenAlex Count doesn't store PDFs; that's Zotero's domain. We search metadata + titles.

4. **Complex filter logic (AND/OR/NOT)** — "I want papers from 2020+ AND (machine-learning OR AI) BUT NOT review-articles". Don't expose this UX in v2.2. All selected filters apply as AND. If demand emerges: advanced search syntax in future.

5. **Infinite scroll** — Feels modern but causes accessibility issues (scroll fatigue, "jump to top" broken on mobile). Pagination is the right choice for a library (users want to know "how many results total").

## Sources

### Official Product Comparisons & Reviews
- [Zotero vs Mendeley: Which reference manager to choose [2025] - Paperpile](https://paperpile.com/r/zotero-vs-mendeley/)
- [Mendeley vs Zotero: Key Differences in 2025 - Qubic Research](https://qubicresearch.com/mendeley-vs-zotero/)
- [Zotero vs Mendeley vs EndNote: Which reference manager is better? - The Effortless Academic](https://effortlessacademic.com/zotero-vs-mendeley-vs-endnote-which-reference-manager-is-better/)
- [12 Best Citation Management Tools for Researchers in 2025 - Documind](https://www.documind.chat/blog/citation-management-tools)

### Interface & Feature Analysis
- [Zotero 7: Zotero, Redesigned - Zotero Blog](https://www.zotero.org/blog/zotero-7/)
- [Mendeley Reference Manager Library Guides - University of Illinois at Urbana-Champaign](https://guides.library.illinois.edu/mendeley/organizing)
- [Is Semantic Scholar the Best Free Research Tool in 2025? A Deep, Practical Review - Sider AI](https://sider.ai/blog/ai-tools/is-semantic-scholar-the-best-free-research-tool-in-2025-a-deep-practical-review)
- [Semantic Scholar Release Notes](https://www.semanticscholar.org/product/release-notes)

### Library UI/UX Patterns
- [Filter UX Design Patterns & Best Practices - Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-filtering)
- [Navigation and browsing - Library Stack at Stanford University](https://guides.library.stanford.edu/librarystack/navigation_and_browsing)
- [LibGuide Design: Best Practices and Guidelines - Washington State University](https://libguides.libraries.wsu.edu/bestpractices/layout)

### Paper Management & Organization Best Practices
- [Organizing Research Papers: Top Systems - Shy Editor](https://www.shyeditor.com/blog/post/organizing-research-papers)
- [8 Best Research Paper Organizer Tools For Easy Management — Otio Blog](https://otio.ai/blog/research-paper-organizer)
- [My favorite tools for managing, organizing, and reading research papers | Towards Data Science](https://towardsdatascience.com/my-favorite-tools-for-managing-organizing-and-reading-research-papers-56525083b827/)

### Collaboration & Sharing Features
- [Read Together With Co-Researchers and Lab Mates on R Discovery](https://researcher.life/blog/article/read-together-with-co-researchers/)
- [New in Paperpile: Flexible, fast sharing for teams and collaborators - Paperpile](https://paperpile.com/blog/paperpile-sharing-features-updates/)
- [Best Research Collaboration Tools in 2025 - Compared](https://blog.collabwriting.com/best-research-collaboration-tools-in-2025-zotero-paperpile-collabwriting-compared/)

### Academic Library Trends
- [Looking at the 2026 EDUCAUSE Top 10 through a library lens - ACRL](https://www.tandfonline.com/doi/full/10.1080/07317131.2025.2599621)

---

*Feature research completed: 2026-03-01*
*Domain: Academic paper library browsing and organization*
*Scope: V2.2 Library UI Overhaul milestone*
