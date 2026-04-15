# Feature Research — v7.0 Extraction Workbench

**Domain:** Academic paper extraction results workbench + cross-source paper selector (systematic-review / AI-extraction tool)
**Researched:** 2026-04-15
**Confidence:** MEDIUM (strong primary sources for Elicit, Covidence, Rayyan; MEDIUM for newer/less-documented tools)
**Scope:** Only the NEW v7.0 features — existing library/collections/search/screening not re-researched.

---

## Executive Summary

OpenScholar v7.0 enters a mature category. The table-stakes bar was set by Elicit (Jan 2025 workflow overhaul with 1,000 papers/20,000 data points per review), Rayyan (Aug 2025 data extraction form builder launch), and Covidence (2025 "Ask AI" with click-to-PDF supporting quotes). All three now offer customizable columns + AI-suggested answers with clickable source verification — that is the floor, not the ceiling.

**The five v7.0 categories map cleanly to existing prior art:**

1. **Results Workbench** — Elicit's table view is canonical: papers-as-rows × questions-as-columns, with supporting quote tooltips, per-cell confidence, column picker, and filter bar. Four views is unusual (most tools pick one); OpenScholar's split view (table + detail drawer) is the true differentiator.
2. **Cross-Source Picker** — The canonical pattern is a **tab-per-source dialog with a persistent selection basket** that survives tab switches. Elicit, Zotero, and Rayyan all use variations of this. A sticky bottom action bar with "N selected" count and "Clear/Review" buttons is industry standard and matches e-commerce sticky-add-to-cart (+7.9% completion, per GrowthRock A/B study).
3. **Paper Limit UX** — Elicit is the direct benchmark: 1,000-paper cap per systematic review, unlimited search but capped workflow. The accepted pattern is inline counters ("X / 1,000") in every selection dialog, warning state at 80%, hard reject at 100% with a toast — not a mid-flow paywall modal.
4. **Per-Tier Limits** — Industry consensus (Orb, Webstacks, Flexprice) is to show caps INLINE near the limit with a subtle upgrade link, not a separate upgrade page. Spotify's "warn before hit" pattern is the gold standard.
5. **Highlighted Citations** — Covidence's 2025 pattern (click supporting quote → jump to PDF location) is now table stakes. Consensus.app's lack of "deep links" is called out as a deficiency. The implementation path depends on parsing source: inline highlight for abstract-only, drawer for full text.

**Strategic recommendations for roadmap:**

- Build **table view first** — it's the minimum viable workbench and what users expect. Card view second. Split view third. "Highlighted citation" view should NOT be a 4th top-level view — it should be a drawer triggered from table/card rows (see anti-feature #1 in Workbench).
- Build **cross-source picker as a single dialog with tabs + persistent basket**, not a wizard. Wizards force linearity; users want to mix sources freely.
- **Never show a paywall mid-flow.** Reject-with-explanation + persistent header CTA. Paywall is OK at first job-creation attempt; not at selection-time.
- **`unpdf` is currently in the stack for v6.0 parsing** — this milestone can reuse it for simple text-location lookups without adding a new PDF rendering dependency (full PDF.js viewer is out of scope — OpenScholar does not store PDFs server-side, only parses them).

---

## Category 1: Results Workbench (Multiple Views)

**The question answered:** What's the canonical feature set for displaying extracted data across papers × questions?

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes / Real-World Reference |
|---|---|---|---|
| **Paper × Question matrix table view** with columns: title, authors, year, venue/journal, DOI, one column per question, per-cell confidence dot, per-cell evidence quote on hover | Elicit, Covidence, Rayyan 2025 all ship this. Missing it = "where's my data?" | MODERATE | Elicit's SR table is the direct benchmark. Existing v6.0 `extractionResults` schema supports this 1:1 — papers rows, questions columns, answer + evidence + confidence per cell. |
| **Column visibility toggle** (show/hide title, authors, year, venue, DOI, per-question columns) | TanStack Table provides this out of the box. Absent = info overload at 20+ questions. | TRIVIAL | TanStack Table `columnVisibility` state. Shadcn data-table blocks use DropdownMenu + checkboxes pattern. Persist in URL state via `nuqs`. |
| **Filters:** by status (success/failed/insufficient_evidence/running), by confidence (high/medium/low), by answer value per question, by year range, by venue | Users screen results to find what matters. Elicit and Covidence both offer filter bars above the table. | MODERATE | Use existing `FilterSection` component (v2.2). `status` and `confidence` are enums in v6.0 schema — trivial to filter. Per-question answer filters are harder because each question has a different answer space. |
| **Full-text search** across paper title/authors/abstract + answer text | Any list-view without search feels broken at >20 items. | LOW | Client-side fuzzy search with `fuse.js` for ~1,000 rows is fine; server-side search is overkill at this scale. |
| **Pagination with result counts** ("1–50 of 847 papers") | Users need to know the total. v2.2 library page already uses this pattern. | TRIVIAL | Reuse existing pagination bar from library page. URL state via `nuqs`. |
| **Card view as an alternative to table** (compact card per paper with title, confidence badge, answers in a list) | Mobile users and researchers who prefer reading cards over scanning tables. v2.2 library has list/grid toggle already. | LOW | Existing `PaperResultCard` from v6.0 Phase 97 is the card. Just needs to be selectable as a view mode. |
| **Supporting evidence quote visible on demand** (hover tooltip, click to expand, or drawer) | This is what distinguishes "AI told me X" from "AI found X in the paper." v6.0 already ships verbatim slice rendering — just needs integration into workbench. | LOW | v6.0 `EvidenceQuote` component renders verbatim slice from stored `evidenceStart`/`evidenceEnd`. Reuse as-is. |
| **Export subset** (CSV/JSON) from current filter/selection | Users need to hand the output to R, Excel, Zotero. Elicit, Rayyan, Covidence all export table contents. | LOW | v6.0 already has `getExtractionResultsForExport` query. Just needs filter-awareness (export only what matches current filters). |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| **Split view** — table on left, detailed drawer on right showing the selected paper's full metadata, all questions/answers, all evidence quotes, parsing source badge | Lets users "scan-and-read" without losing place. No tool reviewed has this — Elicit opens a full-page modal, Covidence has a side sheet but for extraction form entry, not viewing. | MODERATE | Use shadcn `ResizablePanel` or two-column CSS grid. Selection state in Zustand (like sidebar store). The most distinctive OpenScholar view. |
| **Per-cell confidence as colored dot + tooltip** ("HIGH — grounded in verbatim quote", "LOW — insufficient_evidence state") | Consensus.app's color-coding of citations is praised as a differentiator. Covidence does text-only. | LOW | v6.0 already stores `confidence` enum; just needs a colored `Badge` or `Dot` component with tooltip. Aligns with v5.0 color-coded summary cards (green/yellow/red). |
| **Bulk re-run** (select N papers → "Re-extract" button) | When the cascade failed on a subset, or tier was wrong, re-running costs credits but preserves everything else. No tool reviewed offers this — they force a new job. | MODERATE | Backend needs a `reRunPapers(jobId, paperIds[])` mutation that re-enqueues those specific papers into the existing workpool. Credit-gated. Depends on v6.0's per-paper workpoolId targeting. |
| **"Insufficient evidence" filter toggle** (one-click filter to show only the papers where AI said "I couldn't find this") | Flagged in v6.0 as a first-class state but not yet exposed as a filter. Researchers specifically hunt for these rows to do manual fallback. | TRIVIAL | Already stored as `confidence: "insufficient_evidence"`. Just a filter chip. |

### Anti-Features (Commonly Built, Actually Bad)

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **"Highlighted citation view" as a top-level 4th view tab** (full-screen PDF viewer with highlighted source text) | The original v7.0 spec listed 4 views. Intuition says: if I click an evidence quote I want the PDF to open. | (a) OpenScholar does not store PDFs — they're parsed once and discarded. Re-fetching PDFs for rendering is against the v6.0 "free-first parsing waterfall" architecture. (b) Three of five parsing sources (abstract-only, PMC JATS, arXiv HTML) are NOT PDFs at all — no PDF to highlight. (c) Full PDF.js rendering adds ~500KB to the bundle. | Make the evidence quote a **drawer/dialog** triggered from table cells or card rows. Render the verbatim quote in context (surrounding 2-3 sentences from the parsed text), with a badge showing parsing source. Only render the PDF URL for `gemini-pdf` sources if available, as an external link. See Category 5 below. |
| **Infinite scroll on the results table** | "It feels modern" | (a) Breaks accessibility (no keyboard jump-to-end). (b) Breaks the "1–50 of 847" pagination counter researchers need for provenance. (c) Breaks URL-state bookmarking. PROJECT.md already lists infinite scroll as explicitly out-of-scope for library. | Pagination with 50 rows/page + "Jump to page N" input. Consistent with v2.2 library page. |
| **Inline cell editing of AI answers** | "Users can fix wrong answers" | (a) Creates a silent divergence between AI output and user edits — you can no longer trust the export. (b) Requires an edit/audit schema that doesn't exist. (c) Tools like Elicit that allow this report user confusion about what's "AI" and what's "human." | Read-only cells. Provide a "Flag for review" button that adds the paper to the (future) review queue. Manual overrides can go in `reviewStatus` notes, not in the answer itself. |
| **Complex boolean filter builder (AND/OR/NOT)** | Power users want precise queries. | PROJECT.md already lists this as out-of-scope for library ("all filters apply as AND; deferred until demand"). Same reasoning applies here. Filter fatigue is real — Smashing Magazine, Pencil&Paper, Smart Interface Design all warn about this. | Chip-based active-filter display + "Clear all" button. AND-only semantics. Column-level filters beat global filter builders for learnability. |

### Complexity Assessment

| Component | Complexity | Why |
|---|---|---|
| TanStack Table integration | LOW | Drop-in from shadcn data-table block |
| Column visibility/ordering with URL state persistence | LOW | TanStack Table + `nuqs` |
| Split view (resizable two-column) | MODERATE | Shadcn `ResizablePanel` + Zustand for selected-paper state |
| Filter bar integration with existing `FilterSection` | LOW | Reuse v2.2 primitive |
| Bulk re-run mutation (backend) | MODERATE | New mutation + workpool targeting — REQUIRES RESEARCH on OCC for partial re-runs |
| Client-side virtualization for 1,000 rows | LOW → MODERATE | TanStack Virtual is the standard, but only needed if card view becomes sluggish |

---

## Category 2: Cross-Source Paper Selection Basket

**The question answered:** What's the canonical pattern for letting users mix papers from library + collections + search + manual IDs + Zotero into one extraction job?

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes / Real-World Reference |
|---|---|---|---|
| **Tabs for source selection** inside one dialog: "From Library" · "From Collections" · "From Search" · "Manual IDs" · "From Zotero" | Zotero's classic Add Citation dialog, Rayyan's Import flow, Covidence's import wizard — all show the tab-per-source pattern. Rayyan specifically supports 10 files at a time from multiple databases in one import. | MODERATE | Shadcn `Tabs` inside `Dialog`. Each tab is a distinct inner component. |
| **Persistent selection basket** that survives tab switches | The #1 "I couldn't figure it out" problem with Covidence-style imports is losing selections when switching sources. Zotero's beta citation dialog added multi-item selection explicitly to fix this. | MODERATE | Zustand store (`useExtractionBasketStore`) outside the dialog tree so selections persist across tab switches. Keyed by OpenAlex ID for dedup. |
| **Sticky action bar at bottom of dialog** showing "N papers selected · [Review selection] [Clear] [Continue →]" | GrowthRock A/B study: sticky add-to-cart = +7.9% completion. PatternFly bulk-selection pattern recommends bottom toolbar for bulk operations. Gmail uses this. | LOW | Shadcn `Dialog` + absolutely-positioned footer bar. Updates reactively from Zustand count. |
| **Dedupe by OpenAlex ID** (selecting the same paper from Library and Search shows once) | Without dedup, users get "why is this paper listed 3x in my extraction job?" Covidence explicitly dedupes on import. | LOW | Map-keyed-by-openAlexId in Zustand store. Show visual indicator when a paper is already in basket (checkbox pre-checked). |
| **Remove-from-basket button** (chip-style removal, or "-" in a review panel) | The NN/G "Bulk Actions" video and PatternFly both emphasize undo. | TRIVIAL | Shadcn `Badge` with X icon or dropdown "Review Selection" panel. |
| **Visual indicator of already-selected papers** when browsing a source | Without this, users can't tell if they already added a paper. Critical for the multi-source pattern. | LOW | Pre-checked checkbox state + subtle background color when `basket.has(paper.openAlexId)`. |
| **Select-all / deselect-all within current source tab** (e.g., "Select all 50 visible search results") | Rayyan's multi-select feature, Gmail, GitHub — all offer this. Without it, 200-paper selection = 200 clicks. | LOW | Standard TanStack Table row selection API. |
| **Manual OpenAlex ID paste area** (textarea accepting one-per-line W-IDs or DOIs, validated + previewed) | Power users bring their own ID lists (exported from PubMed, Scopus, etc.). Not having this forces Zotero-only workflows. | MODERATE | Parse → validate shape → query OpenAlex for metadata preview → add to basket. Malformed IDs stay in input with error annotation. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| **Keyboard shortcuts:** Shift+click range select, Ctrl/Cmd+A select-all-visible, Esc clear | Power users from Zotero/Gmail habitually use these. `github/check-all` library ships this exact pattern for open web apps. | LOW | TanStack Table supports this in `enableMultiRowSelection`. |
| **"Review basket" step** — expandable sheet/panel showing all selected papers with remove buttons, re-orderable, total count, over-limit warnings | Covidence shows imported items in an "Import history" panel for auditability. Elicit does not — confirmed pain point. | MODERATE | Shadcn `Sheet` from the sticky footer. Renders the basket as a deduplicated list. |
| **Source badge on each basket item** ("from Library", "from Search 'diabetes covid-19'", "manual") | Provenance for the user — 3 months later, "where did this paper come from?" | LOW | Store `source: "library" \| "search" \| "manual" \| "zotero" \| "collection"` in basket state. |
| **"Save as collection"** from basket before submitting (opens create-collection dialog, reuses v2.1 collection CRUD) | Users who assemble a cross-source list often want to re-use it. Avoids re-doing the selection. | MODERATE | Requires v2.1 collection write-path to accept paper arrays. Already partly exists for v4.0 screening's collection picker. |

### Anti-Features (Commonly Built, Actually Bad)

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Multi-step wizard (Step 1: Pick library → Step 2: Pick search → Step 3: Review)** | "Linear flow is easier" | Forces every user through every source even if they only want 10 library papers. Breaks back-navigation (you lose step 2 when going back to step 1). Covidence users report confusion. | Single dialog with tab switcher. Selections persist. User can finalize at any point. |
| **Separate dialog instances per source** ("Add from Library..." button opens its own dialog) | "Each dialog does one thing" | Users can't compare across sources. Selection state is scattered. Every dialog needs its own close → re-open cost. | One unified dialog. Tabs. |
| **Drag-and-drop-only selection** (no checkboxes, only DnD into a basket pane) | "Drag is intuitive" | WCAG-failing. Impossible on mobile/touch without gesture conflicts. Kills keyboard users. | Checkboxes (which CAN be combined with drag if that's a differentiator), with DnD optional. |
| **Auto-submit when basket hits capacity** | "Save a click" | Irreversible surprise action. User loses staged selection. Violates every undo-ability principle. | Explicit "Continue →" button. Hitting cap = sticky basket bar turns orange/red, Continue button highlights. |

### Integration with Existing Components

| Existing Feature | How It Integrates |
|---|---|
| **v2.1 library page + collections** | Library source tab reuses library pagination + filter query. Collection source tab reuses v2.1 collection picker. |
| **Existing search page** | Search source tab embeds the search results list with the existing filter UI. |
| **v4.0 screening dialog's collection picker** | Proven UI pattern — same "pick from existing + create new" flow. |
| **v6.0 `ExtractionDialog`** | This dialog is the EXISTING shell. v7.0 fills its empty `papers` prop by replacing the "paperCount === 0" dead path with this basket store. |
| **v2.4 `zoteroConnections` table + encrypted API keys** | Already exists for OAuth state. Zotero tab's data fetch uses the existing `convex/zotero/**` orphaned code path. |

---

## Category 3: Paper-Limit Communication UX (Hard Caps)

**The question answered:** How do tools communicate the 1,000-paper-per-job hard cap without being annoying?

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes / Real-World Reference |
|---|---|---|---|
| **Inline "X / 1,000 papers" counter** visible at all times in the picker sticky bar and extraction dialog header | Elicit shows this in the systematic-review workflow. ChatGPT shows "X files" in its upload area. JetBrains AI Assistant shows "monthly credits left / total" with a progress bar. | TRIVIAL | Sticky bar text binding. Update reactively from Zustand basket count. |
| **Progress bar fill** alongside the counter (0% → 100% fill) | Visual reinforcement. JetBrains uses this exact pattern for AI credits. Research shows users notice proximity to limits better with progress bars than numbers alone. | TRIVIAL | Shadcn `Progress` component. Color shifts at 80% (yellow) and 100% (red). |
| **80% warning state** (yellow/orange progress bar, subtle text: "Approaching limit") | Spotify's "approaching limit" pattern is the gold standard. Orb/Webstacks SaaS best-practice guides explicitly call this out. | LOW | Conditional className based on `count / max >= 0.8`. |
| **100% hard-reject state** with clear message + disabled Continue button | Progressive Enhancement: tell me why I can't proceed, don't just dim the button. | LOW | Continue button disabled with tooltip: "You've reached the 1,000-paper limit. Remove papers or [upgrade to Pro]." |
| **Backend hard reject with toast** (server-side validation in case client race) | Never trust the client. Server's `createExtractionJob` must re-validate. Existing v6.0 mutation-to-toast routing handles this. | LOW | Add `MAX_EXTRACTION_PAPERS_PER_JOB` check in mutation. Throw `ConvexError` with structured payload for toast routing. |
| **Disabled checkboxes when at 100%** for additional selections in any source tab | GitHub, Gmail, Rayyan multi-select — all disable "more than limit" selections. Prevents over-selection state. | LOW | Bind `disabled` prop on checkbox to `basketSize >= maxLimit && !isCurrentlySelected`. |
| **"Paper will be dropped" warning when pasting a batch that exceeds the cap** (e.g., paste 1,500 manual IDs, system keeps first 1,000, toasts "Dropped 500") | Silent drop = surprising and broken. Blocking-error = also frustrating. Middle path: import the first N, explain the rest. | LOW | In manual-IDs parser, slice + show count of dropped. |
| **Clear "remove N papers to continue" message at cap** | Users hit the cap mid-selection. They need to know exactly what to do. | TRIVIAL | Banner above sticky bar: "You're at the 1,000-paper limit. Remove some to add more." |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| **Per-question cost estimate alongside paper count** (e.g., "1,000 papers × 5 questions = 5,000 cells ≈ 120 credits") | Users care about credit burn, not paper count. v4.0 screening dialog already has this pattern. | LOW | Reuse cost-estimate formula from v4.0 screening dialog. |
| **Split the counter by source** in review panel ("From Library: 400 · From Search: 500 · Manual: 100") | Lets users decide where to trim if they hit cap. No other tool does this. | LOW | Group-by in basket store. |

### Anti-Features (Commonly Built, Actually Bad)

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Silent truncation** (accept 1,500 papers, process 1,000, never tell user) | "Don't annoy the user" | Data integrity nightmare. User thinks all 1,500 were processed; 500 are missing from results. Violates "trust through transparency" design principle. | Explicit toast + banner + dropped-count display. |
| **Modal block mid-flow** ("You've hit the limit!" full-screen dialog) | "Get user's attention" | Interrupts the exact task the user was trying to finish. Paywall design research says this kills conversion and satisfaction. | Sticky bar color shift + disabled button + inline message. Non-modal. |
| **Hiding the cap** (cap exists but is not shown until user hits it) | "Surprise delight" | Users build a 1,200-paper selection and then get blocked. Frustration = rage-quit. Every SaaS best-practice guide says "show the cap, give users fair warning." | Show "X / 1,000" from the moment the dialog opens. |
| **Ambiguous "too many papers" error** | "Keep it short" | Users don't know what to do. Tooltip must be specific: "You've selected 1,247 papers but the limit is 1,000. Remove 247 to continue." | Precise numbers in every message. |

### Constant Shape for Future Tiering

Make the constant per-tier-ready NOW without adding tier logic:

```typescript
// convex/lib/constants.ts
export const MAX_EXTRACTION_PAPERS_PER_JOB = {
  free: 1000,  // v7.0: same for everyone
  go: 1000,    // v7.0: same for everyone
  pro: 1000,   // v7.0: same for everyone
  enterprise: 1000, // v7.0: same for everyone
} as const;

// Today's usage (flat):
function getMaxPapers(tier: Tier): number {
  return MAX_EXTRACTION_PAPERS_PER_JOB[tier];
}
```

When per-tier is later enabled, only the values change — all call sites already flow through `getMaxPapers(tier)`. No schema changes required.

---

## Category 4: Per-Tier Limits UX

**The question answered:** Where and how do SaaS tools display tier-based limits? (Even though v7.0 won't enable per-tier values, the UI must be structured to display tier context.)

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes / Real-World Reference |
|---|---|---|---|
| **Inline tier badge** near the counter ("Free plan: 1,000 papers/job") | Orb, Flexprice, Webstacks all recommend inline display over "hidden in pricing docs." | TRIVIAL | Small `Badge` component next to the "X / 1,000" counter. Pulled from existing `useSubscription()` hook. |
| **Subtle upgrade link when approaching limit** ("Need more? Upgrade") | Spotify, Notion, Elicit — all show this as a secondary CTA, not primary. | LOW | Link appears at 80% usage, routes to existing /billing page. |
| **Show cap even when user is under it** (don't hide the limit until hit) | Same transparency principle as Category 3. | TRIVIAL | Always render "X / 1,000" regardless of percentage. |
| **Paywall ONLY on attempt to exceed, not during browsing** | Paywall UX research: interruption fatigue is real. | LOW | Browsing a source and hitting the cap → toast/message, not modal. Actual "upgrade" is a separate button on the /billing page. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| **Comparative display** ("Free: 1,000 · Pro: 5,000 · Enterprise: unlimited") shown only in upgrade context | Helps users self-select the right plan. Webstacks comparison-table research: comparative displays convert 18% better. | LOW | Only show on hover/click of "Need more?" link. Don't shove it into every dialog header. |
| **Graceful downgrade path** ("You had 1,500 papers from Pro, now on Free — select 1,000 to process") | Users change plans mid-work. No tool does this well. | MODERATE | Out of scope for v7.0 — note as future. |

### Anti-Features (Commonly Built, Actually Bad)

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Separate "Your plan" sidebar/banner** persisting across pages | "Reinforce value" | Clutters the workbench. Researchers want to focus on papers, not billing. | Show tier only in context (extraction dialog, billing page). |
| **Dark-pattern upsells** ("Upgrade NOW for 5x more!" pop-ups after every action) | Growth team pressure | Paywall research: erodes trust, kills retention. Apphud specifically warns about this. | One inline link. No pop-ups. |
| **Hidden pricing** ("Contact sales for enterprise limits") | Enterprise deal customization | Researchers aren't sales-qualified leads. They evaluate in 5 minutes or leave. | Public flat numbers. Even "unlimited" is a number. |
| **Per-page quota displays** (show quota on every page of the app) | "Always keep it in view" | Information noise. Violates "calm & focus" design principle. | Show only on the pages where it's relevant (extraction dialog, billing). |

---

## Category 5: Highlighted Citation / Evidence Display

**The question answered:** How do tools render source snippets with evidence highlighted when a user clicks a citation?

### Context Specific to OpenScholar

v6.0 parsing waterfall produces 5 different content types:

| Parsing Source | Content Type | What's Available for Display |
|---|---|---|
| `pmc-jats` | Parsed XML → plain text | Full text with paragraph/section structure |
| `arxiv-html` | Parsed HTML → plain text | Full text |
| `unpdf` | PDF → plain text via unpdf | Full text, no layout |
| `gemini-pdf` | PDF → plain text via Gemini | Full text, no layout |
| `abstract-only` | Abstract string only | Abstract text |

**Critical constraint:** OpenScholar does NOT store PDFs server-side (v2.5 removed pdfjs-dist). The parsing waterfall extracts text and discards the binary. **Full PDF viewing is architecturally impossible without changing the v6.0 schema.** This means no "click quote → scroll PDF to page" a la Covidence.

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes / Real-World Reference |
|---|---|---|---|
| **Verbatim quote rendered inline in results** (the existing v6.0 `EvidenceQuote` component) | v6.0 Phase 92 already ships this. Non-negotiable. | — | Already exists; just needs workbench integration. |
| **Parsing source badge** (e.g., "From arXiv HTML", "From abstract only") next to each evidence quote | v6.0 stores `parsingSource` but Phase 97 never rendered it (PARSE-07 partial). Users need to know: "AI read the full paper" vs "AI only saw the abstract" — huge trust differential. | TRIVIAL | Small badge next to evidence quote. Color-coded: green for full-text sources, yellow for abstract-only. |
| **Drawer/sheet opens when evidence quote is clicked** (shows full context: surrounding 2-3 sentences, source badge, all other questions' quotes from same paper) | Covidence 2025 launched "click supporting quote → jump to PDF." We can't do PDF, but we can show in-context text. | MODERATE | Shadcn `Sheet` from the right. Pulls from stored `parsedText` string — wait, `parsedText` is NOT currently stored (parsed → extracted → discarded). This REQUIRES RESEARCH in Step 10. |
| **"Insufficient evidence" distinct visual state** (not a quote — explicit "AI couldn't find this") | v6.0's first-class `insufficient_evidence` state is under-utilized in the current results page. | TRIVIAL | Italic greyed-out text: "AI could not locate evidence for this question in the paper." Already rendered by `EvidenceQuote`, just needs workbench integration. |
| **Copy quote button** (clipboard copy with source attribution) | Researchers paste these into their own notes/manuscripts. Missing = "how do I cite this?" | TRIVIAL | Shadcn `Button` with Copy icon + `navigator.clipboard.writeText`. |
| **External link to full paper** (DOI resolver, OpenAlex URL, or PDF URL for `gemini-pdf` sources where available) | When users want to verify beyond what the extraction captured. | TRIVIAL | Link with `rel="noopener noreferrer"`. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---|---|---|---|
| **Highlighted-text rendering within the quote context** — wrap the exact matched evidence with a highlight span inside the surrounding sentence(s) | Covidence's "jump to PDF highlight" is praised as a 2025 differentiator. In-context highlighting at the text level is the non-PDF equivalent. | MODERATE | Use the v3.0 `HighlightedText` component (XSS-safe React-native text splitting). Needs `parsedText` stored — REQUIRES RESEARCH. |
| **All-quotes panel per paper** (list every question's evidence quote for one paper in one view) | When researchers verify extraction quality for a single paper, they want to see all quotes side-by-side. No tool reviewed has this. | LOW | Drawer content: one section per question. |
| **"Low confidence" quote styling** (dashed border or lighter background for non-high confidence) | Visual reinforcement of trust signals. | TRIVIAL | CSS. |

### Anti-Features (Commonly Built, Actually Bad)

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Embedded PDF viewer with server-side storage of original PDFs** | "Users want to read the paper" | (a) Architecturally against v6.0 free-first parsing design. (b) Copyright / licensing concerns for full-text storage. (c) +500KB bundle for PDF.js. (d) PROJECT.md explicitly out-of-scope: "PDF storage and annotation — users have Zotero for this." | External link to DOI or OpenAlex URL. That's it. |
| **Editable evidence quotes** | "Users can correct AI errors" | Breaks the v6.0 invariant that evidence = verbatim slice from parsed source. Once editable, you can no longer call it "grounded." Tier loss of trust. | Read-only. Users flag, don't edit. |
| **Auto-scroll / fancy animations when clicking a quote** | "Feels polished" | Reduced-motion users suffer. v2.2 Framer Motion animations already cover subtle feedback. | Open drawer with instant content. Optional subtle slide-in via `prefers-reduced-motion`. |
| **Multiple conflicting citations per answer** ("Here's quote 1 AND quote 2 AND quote 3") | "More evidence is better" | Violates v6.0 schema (1 answer = 1 evidence range). Would require schema migration. Research shows users prefer one strong quote over three weak ones. | One quote per answer cell. If users want more, they open the drawer and see neighboring text. |

### Dependency Flag: `parsedText` Storage

**REQUIRES RESEARCH (flag for Step 10).** The v6.0 extraction pipeline parses source text (PMC, arXiv, PDF) to a transient string, runs the LLM over it, stores only the extracted answer + evidence slice offsets, and discards the parsed text. For the drawer to show "2 sentences of context around the evidence quote," one of two options:

- **Option A — Store parsed text:** Add `parsedText: string` to `extractionPapers` table. Storage cost: ~50KB/paper × 1,000 papers/job = 50MB/job. Over a year of jobs this adds up. Needs a TTL or manual cleanup strategy.
- **Option B — Store evidence + context window at extraction time:** When v6.0 grounds the citation, also store `evidenceContextBefore: string` (e.g., 200 chars) and `evidenceContextAfter: string` (200 chars). Fixed ~400 bytes/question/paper. Much cheaper.

**Recommendation:** Option B. Avoids unbounded growth, keeps "slim extraction schema" invariant from v6.0 Phase 89, works for all parsing sources uniformly. This is a v7.0 schema addition that needs a forward-only migration.

---

## Feature Dependencies

```
Results Workbench (Category 1)
    └──requires──> v6.0 extractionResults schema (stable)
    └──requires──> v6.0 EvidenceQuote component (exists)
    └──requires──> v2.2 FilterSection primitive (exists)
    └──requires──> Shadcn data-table + TanStack Table (new dependency)
    └──enhances──> Highlighted Citations (Category 5) via drawer integration

Cross-Source Picker (Category 2)
    └──requires──> v6.0 ExtractionDialog shell (exists but empty)
    └──requires──> v2.1 library page query + filters (exists)
    └──requires──> v2.1 collections CRUD (exists)
    └──requires──> v4.0 screening dialog's collection picker pattern (exists — proven)
    └──requires──> v2.4 zoteroConnections table (exists but orphaned)
    └──requires──> Zotero OAuth flow revival (separate v7.0 feature)
    └──enhances──> Paper Limit UX (Category 3) — sticky bar is where the counter lives
    └──conflicts──> Wizard-style multi-step flow (rejected anti-feature)

Paper Limit UX (Category 3)
    └──requires──> Cross-Source Picker (Category 2) — the sticky bar is the display point
    └──requires──> MAX_EXTRACTION_PAPERS_PER_JOB constant bumped from 200 → 1000
    └──requires──> v6.0 createExtractionJob mutation updated with new cap + reject toast
    └──enhances──> Per-Tier Limits (Category 4) — same counter displays tier context

Per-Tier Limits (Category 4)
    └──requires──> Paper Limit UX (Category 3) as the display substrate
    └──requires──> Existing useSubscription() hook (exists)
    └──enhances──> Future per-tier enforcement (not v7.0 scope)

Highlighted Citations (Category 5)
    └──requires──> v6.0 EvidenceQuote + HighlightedText components (exist)
    └──requires──> PARSE-07 gap closed — parsingSource badge rendered
    └──requires──> v7.0 schema addition: evidenceContextBefore/After on extractionResults (NEW, REQUIRES RESEARCH)
    └──enhances──> Results Workbench (Category 1) via drawer integration
```

### Dependency Notes

- **Results Workbench (Cat 1) requires TanStack Table:** v2.2 library uses a custom grid, not TanStack Table. v7.0 introduces TanStack Table as a new dependency. Alternative: hand-rolled table with HTML + sort/filter helpers. TanStack Table wins on "built for this" + shadcn data-table block ships it.
- **Cross-Source Picker (Cat 2) conflicts with Wizard anti-feature:** If the picker becomes a wizard (Step 1/Step 2/Step 3), Cat 2's "persistent basket across tabs" differentiator is impossible.
- **Category 5 requires a schema addition:** The context-window storage on `extractionResults` is a v7.0 schema migration. Nontrivial: must be forward-only, must not break v6.0 jobs.
- **TierSelector wiring is a standalone fix:** It's listed as a v7.0 feature in PROJECT.md but doesn't fit into any of these 5 categories. It's a simple "UI value is discarded; send it to backend." Should be its own requirement (TIER-01 or similar).

---

## MVP Definition

### Launch With (v7.0)

**Phase priority 1 (core results experience):**
- Paper × Question table view with TanStack Table
- Column visibility toggle + URL state
- Status/confidence/answer-value filters
- Full-text search over papers
- Card view (reuses `PaperResultCard`)
- Evidence quote drawer (simple version — just in-context quote + parsing-source badge)
- Export subset (filter-aware)
- Bulk action: delete selected papers from results (for noise cleanup)

**Phase priority 2 (job creation flow restored):**
- Cross-source picker: Library tab, Collections tab, Search tab, Manual IDs tab
- Zotero tab gated behind OAuth connection (if Zotero OAuth revival completes)
- Persistent selection basket in Zustand store
- Sticky action bar with "X / 1,000" counter
- Dedupe by OpenAlex ID
- Hard-cap at 1,000 with warning at 80%, reject at 100%
- Wire `ExtractionDialog.papers` prop from basket state (closes UI-01 gap)

**Phase priority 3 (polish + finish v6.0 gaps):**
- Split view (table + drawer)
- Parsing source badge on evidence quotes (closes PARSE-07 gap)
- TierSelector value wired to backend (closes EXTR-01 integration gap)
- Bulk re-run button (differentiator)
- Save basket as collection (differentiator)

### Add After Validation (v7.1)

- Keyboard shortcuts (Shift+click range, Cmd+A)
- "Review basket" sheet with reordering
- Per-source count display in basket
- `evidenceContextBefore/After` schema addition + in-context highlighting (drawer becomes richer)

### Future Consideration (v8+)

- Comparative tier display on cap-approach
- Save-and-resume drafted jobs (basket persistence across page reloads)
- PDF viewer for `gemini-pdf` parsing sources (separate architectural decision)

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---|---|---|---|
| Paper × Question table view | HIGH | MEDIUM | **P1** |
| Column picker | HIGH | LOW | **P1** |
| Filter bar (status/confidence/year/venue) | HIGH | LOW | **P1** |
| Card view | MEDIUM | LOW | **P1** |
| Cross-source picker (core: Library + Search + Manual) | HIGH | HIGH | **P1** |
| Persistent selection basket | HIGH | MEDIUM | **P1** |
| 1,000-paper hard cap + counter | HIGH | LOW | **P1** |
| Wire ExtractionDialog.papers (UI-01) | HIGH | LOW | **P1** |
| Wire TierSelector to backend | MEDIUM | LOW | **P1** |
| Parsing source badge (PARSE-07) | MEDIUM | LOW | **P1** |
| Collections tab in picker | MEDIUM | LOW | **P2** |
| Zotero tab in picker | MEDIUM | HIGH | **P2** |
| Evidence quote drawer (simple, no context window) | HIGH | MEDIUM | **P1** |
| Evidence drawer with context window (needs schema) | MEDIUM | HIGH | **P2** |
| Split view (table + drawer resizable) | MEDIUM | MEDIUM | **P2** |
| Bulk re-run | MEDIUM | MEDIUM | **P2** |
| Bulk delete from results | MEDIUM | LOW | **P1** |
| Export subset (filter-aware) | MEDIUM | LOW | **P1** |
| Save basket as collection | LOW | LOW | **P3** |
| Keyboard shortcuts | LOW | LOW | **P3** |
| Review basket sheet | LOW | LOW | **P2** |

**Priority Key:**
- **P1** — v7.0 MVP, must ship
- **P2** — v7.0 if time permits, or v7.1
- **P3** — v7.1+ nice-to-have

---

## Competitor Feature Analysis

| Feature | Elicit (2025) | Covidence (2025) | Rayyan (2025) | Consensus.app | OpenScholar v7.0 Plan |
|---|---|---|---|---|---|
| **Paper × Question table view** | Yes — workflow-based tables | Yes — Extraction 1/2 forms | Yes — "data extraction" (launched Aug 2025) | No — search results only | Yes (P1) |
| **Per-cell confidence score** | Via screening scores | Via AI suggestions | Partial | Via "Consensus Meter" on claims | Yes — colored dots (P1) |
| **Click quote → jump to source** | No (modal expand only) | Yes — click quote → PDF location (2025) | Partial — evidence view | **No — explicit gap** | Yes — drawer with in-context text (P1), PDF is architecturally impossible |
| **Max papers per job** | 1,000 (Pro) | No hard cap documented | Varies by plan | N/A — search-only | 1,000 (v7.0) |
| **Multi-source import/selection** | Keyword search across Elicit + PubMed + ClinicalTrials.gov | Multi-database file import (one format per file) | 10 files × 100MB each per import | N/A | Tab-per-source with persistent basket (P1) |
| **Persistent selection basket** | Partial — within workflow | Partial — via Import history | Multi-select with staging | N/A | Yes — Zustand store (P1) |
| **Column customization** | Yes — add/remove columns | Yes — custom forms | Yes — flexible form builder | No | Yes (P1) |
| **Export filtered subset** | Yes (Pro+) | Yes — CSV/RIS | Yes — labeled CSV | Yes — basic | Yes (P1) |
| **Split view (table + detail pane)** | No — full-page modal | Partial — side sheet for entry | No | No | Yes (P2 differentiator) |
| **Bulk re-run extraction** | No | No | No | N/A | Yes (P2 differentiator) |
| **Tier-gated paper limits** | Yes — Free/Plus/Pro | Yes — Essential/Flex/Enterprise | Yes — Free/Pro | Yes — Free/Premium | Yes — shape ready, values flat in v7.0 |

### Observations

- **"Click-to-jump-to-PDF" is the hot 2025 feature** — Covidence shipped it, Consensus is criticized for lacking it, Elicit's workaround is a modal. OpenScholar can't do PDF jumps but CAN do in-context text reveal, which is the semantic equivalent.
- **Elicit's 1,000-paper limit is the direct benchmark** for OpenScholar's cap. Elicit's paper-count display is inline in the workflow — no separate quota page.
- **No reviewed tool has a true multi-source basket with mix-and-match.** This is the genuinely novel piece of v7.0. Zotero has tabs but one source at a time. Rayyan has multi-file import but it's file-level. OpenScholar's "library + search + Zotero + manual in one basket" has no direct competitor.
- **No reviewed tool has split view.** Elicit opens modals, Covidence uses side sheets for entry-time forms not view-time, Rayyan has a separate "view" page. OpenScholar's split view could be a memorable moment.

---

## Sources

### Primary (authoritative, current)

- [Elicit Systematic Reviews — 1,000 paper limit confirmed](https://support.elicit.com/en/articles/7927169) — "You can screen and extract data from 1,000 papers at once in a single table"
- [Elicit Pricing / Workflow FAQ](https://elicit.com/pricing) — Pro tier: 5,000 papers total, 1,000 per search query
- [Elicit Strict Screening / 80-Paper Reports blog](https://elicit.com/blog/introducing-strict-screening-and-80-paper-reports) — Report generation cap
- [Rayyan Data Extraction blog (Aug 2025)](https://blog.rayyan.ai/2025/08/11/data-extraction-in-rayyan/) — Form builder launch, customizable columns
- [Rayyan Multi-Select feature docs](https://help.rayyan.ai/hc/en-us/articles/17756476756881-How-to-Use-the-Multi-Select-Feature-for-Bulk-Management-of-References) — Bulk management pattern
- [Rayyan Import Methods](https://help.rayyan.ai/hc/en-us/articles/17216953358353-How-to-Upload-Articles-References-into-Rayyan) — 10 files × 100MB × 1GB total
- [Covidence 2025 Updates — Ask AI + PDF jump](https://changes.covidence.org/improved-sponsorship-source-suggestions-(extraction-1)-333611) — "Click any supporting quote to jump to its location in the PDF"
- [Consensus.app 2025 review — deep link gap](https://aarontay.substack.com/p/a-2025-deep-dive-of-consensus-promises) — "Doesn't provide deep links into PDFs — other tools now provide deep links"
- [TanStack Table — Virtualized Infinite Scroll example](https://tanstack.com/table/v8/docs/framework/react/examples/virtualized-infinite-scrolling) — Canonical pattern
- [TanStack Table — Column Visibility Guide](https://tanstack.com/table/v8/docs/guide/column-visibility)

### Secondary (design systems, best practices)

- [PatternFly Bulk Selection Pattern](https://www.patternfly.org/patterns/bulk-selection/) — Toolbar positioning, count display
- [NN/G Bulk Actions Video Guidelines](https://www.nngroup.com/videos/bulk-actions-design-guidelines/) — Select All, contextual toolbar, undo
- [Eleken SaaS Bulk Action UX 8 guidelines](https://www.eleken.co/blog-posts/bulk-actions-ux) — Design principles
- [GoodUI Pattern #41 — Sticky CTA](https://goodui.org/patterns/41/) — Sticky action bar conversions
- [GrowthRock Sticky Add-to-Cart A/B Test](https://growthrock.co/sticky-add-to-cart-button-example/) — +7.9% completed orders
- [Smashing Magazine — Frozen Filters](https://www.smashingmagazine.com/2021/07/frustrating-design-patterns-broken-frozen-filters/) — Filter fatigue anti-patterns
- [Smart Interface Design Patterns — Complex Filtering](https://smart-interface-design-patterns.com/articles/complex-filtering/) — Progressive disclosure
- [Orb — Tiered Pricing Examples 2025](https://www.withorb.com/blog/tiered-pricing-examples) — Progressive limit best practices
- [Webstacks SaaS Pricing Page Design](https://www.webstacks.com/blog/saas-pricing-page-design) — 3-tier consensus, CTA placement
- [Appcues — Freemium Upgrade Prompts](https://www.appcues.com/blog/best-freemium-upgrade-prompts) — Spotify "warn before hit" pattern

### Tertiary (implementation libraries)

- [react-pdf-highlighter](https://github.com/agentcooper/react-pdf-highlighter) — Rejected (PDF viewer out of scope)
- [react-pdf-highlighter-extended](https://github.com/DanielArnould/react-pdf-highlighter-extended) — Same reason rejected
- [Shadcn Data Table component](https://www.shadcn.io/ui/data-table) — TanStack wrapper
- [Shadcn Multi-Step Form guide](https://shadcnstudio.com/blocks/dashboard-and-application/multi-step-form) — Rejected in favor of tab pattern
- [github/check-all](https://github.com/github/check-all) — Shift-click range selection helper

### Internal References

- `.planning/PROJECT.md` — v7.0 goal, target features, out-of-scope
- `.planning/milestones/v6.0-MILESTONE-AUDIT.md` — UI-01, PARSE-07, EXTR-01 integration gaps that v7.0 must close
- `.planning/research/ARCHITECTURE.md` (existing v6.0) — Current schema + component inventory

---

*Feature research for v7.0 Extraction Workbench*
*Researched: 2026-04-15*
*Confidence: MEDIUM — Primary sources verified for Elicit/Rayyan/Covidence; secondary for best-practice design patterns; anti-feature calls drawn from NN/G, PatternFly, and Smashing Magazine authoritative guidance.*
