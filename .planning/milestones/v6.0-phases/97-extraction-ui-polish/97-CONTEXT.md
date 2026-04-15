# Phase 97: Extraction UI Polish - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship the user-facing extraction experience on top of the stabilized backend: a dialog-based job creation flow with question builder, model tier selector, and cost preview; a sidebar footer button with progress ring for live job tracking; a dedicated results route with per-paper cards rendering verbatim evidence quotes; CSV/JSON/XLSX export reusing the screening export pattern; i18n strings seeded in all 6 locale files before component development; and brand-aligned Clean/Friendly/Approachable design using OKLCH tokens, Outfit font, spring-based Framer Motion, and WCAG AAA contrast.

</domain>

<decisions>
## Implementation Decisions

### Job Creation Flow (UI-01)
- **D-01:** Job creation uses a **dialog-based flow** (not a dedicated route), consistent with the screening pattern in `components/screening/screening-dialog.tsx`. Users stay in context — the dialog opens from the extraction sidebar/footer button or from within a collection/library view.
- **D-02:** The question builder uses an **inline add/remove/edit list** with text inputs, mirroring screening's local question management pattern. Users build 1-N extraction questions directly in the dialog body.
- **D-03:** Model tier selector is a **radio group with 3 options**: Auto (system picks based on complexity), Cheap (Gemini 2.5 Flash Lite), Accurate (full cascade). Labels are user-friendly — no model names exposed. Maps to the cascade tiers from Phase 91.
- **D-04:** Estimated cost preview displays **inline below the model selector**, updating reactively as paper count and tier change. Reuses the credit balance check pattern from screening (`api.credits.queries.checkBalance`). Shows "Estimated: ~X credits" with a warning state if balance insufficient.
- **D-05:** The dialog calls `api.extraction.mutations.createExtractionJob` on submit, captures PostHog analytics (`extraction_job_created` event), and shows a success toast via `sonner`.

### Live Progress & Job Management (UI-02)
- **D-06:** A **sidebar footer button with circular SVG progress ring** (identical pattern to `ScreeningFooterButton` at `components/app-sidebar.tsx:276-365`) shows extraction status. Clicking opens an `ExtractionJobsDialog` with job history.
- **D-07:** The job history dialog follows the `ScreeningJobHistory` pattern: status dots (color-coded with `animate-pulse` for processing), date formatting via `useFormatter()`, inline progress bars for active jobs, and a link to the results route for completed jobs.
- **D-08:** Per-paper status badges use the existing `Badge` component with OKLCH semantic colors: parsing (blue `oklch(0.55 0.15 250)`), extracting (violet `oklch(0.55 0.15 293)` — matches AI accent), done (green `oklch(0.55 0.15 145)`), failed (red `oklch(0.6 0.15 27)`). These extend the established color patterns from `confidence-badge.tsx` and `critic-verdict-badge.tsx`.
- **D-09:** The cancel button in the progress view calls `api.extraction.mutations.cancelExtractionJob` (Phase 93). Shows a confirmation dialog before cancelling. Disabled for terminal-status jobs.
- **D-10:** Real-time counters consume `api.extraction.queries.getExtractionProgress` (reactive Convex query with cap-at-99% pattern from Phase 93).

### Results Presentation (UI-03)
- **D-11:** Results live on a **dedicated route** at `app/extraction/[jobId]/page.tsx`. Job creation is a quick action (dialog), but results are a primary browsing experience needing full-page real estate for paper-by-paper review.
- **D-12:** Results are **grouped by paper**, with questions nested within each paper card. Each paper card uses the `Card` component and displays: paper title/metadata header, then per-question rows showing the answer, `ConfidenceBadge`, `CriticVerdictBadge`, and `EvidenceQuote` component (all 5 existing extraction components are reused).
- **D-13:** The `EvidenceQuote` component (already built at `components/extraction/evidence-quote.tsx`) renders `bodyText.slice(startChar, endChar)` — never the LLM's `evidenceQuote` field (Phase 92 decision D-14). Clicking highlights scrolls to the quote in context.
- **D-14:** The `InsufficientEvidenceCard` (already built at `components/extraction/insufficient-evidence-card.tsx`) renders for questions with `answer === "insufficient_evidence"` — muted card with dashed border, info icon, reasoning text.
- **D-15:** The `JobMetricsPanel` (already built at `components/extraction/job-metrics-panel.tsx`) displays at the top of the results page: 2x2 metric grid (papers, latency, cost, errors) + SLO progress bars for citation validity and recall.
- **D-16:** A **new Convex query is needed**: `getExtractionResults({ jobId })` that returns per-paper results with nested question answers, joined with paper metadata. This query does not exist yet and must be created as part of Phase 97.

### Export Integration (UI-04)
- **D-17:** Export follows the **screening export pattern** from `lib/screening/export.ts`. Create `lib/extraction/export.ts` with `exportExtractionToCSV`, `exportExtractionToJSON`, `exportExtractionToXLSX` functions adapting the same structure (CSV with dynamic question columns, JSON envelope with metadata, XLSX via dynamic `import('exceljs')`).
- **D-18:** No new export infrastructure — reuses `downloadAsFile` from `lib/utils.ts` and the `exceljs` dependency already installed for screening.
- **D-19:** Export triggers appear in two places: (1) download dropdown on job history items (like screening), (2) export button in the results page header. Both use the `DownloadMenu` component pattern from `components/download-menu.tsx`.
- **D-20:** A **new Convex query is needed**: `getExtractionResultsForExport({ jobId })` returning a flat array suitable for export serialization (denormalized paper + question + answer rows). Modeled after screening's export data query.

### i18n Seeding (UI-05)
- **D-21:** All extraction UI strings are seeded in **6 locale files** BEFORE component development: `en-US.json`, `en-GB.json`, `zh.json`, `fr.json`, `hi.json`, `ja.json`. These are the actual project locales from `i18n/config.ts` — the roadmap's aspirational "en, fr, es, de, ar, zh" does not match the real config.
- **D-22:** Extend the existing `"extraction"` namespace in each locale file (already has ~25 keys for badge/metric components). Add keys for: job creation dialog (title, labels, buttons, validation messages), progress view (status labels, counter labels, cancel confirmation), results page (headers, empty states, grouping labels), export menu (format labels, download text).
- **D-23:** Use `useTranslations("extraction")` in all new components — consistent with existing extraction components. Nested key structure: `extraction.jobCreation.*`, `extraction.progress.*`, `extraction.results.*`, `extraction.export.*`.

### Navigation & Routing (UI-06, design)
- **D-24:** **Dual entry point**: (1) Sidebar footer button with progress ring for quick access to active extraction jobs (opens dialog), (2) Sidebar nav item "Extraction" (Lucide `FlaskConical` or `Sparkles` icon) linking to `/extraction` for browsing job history and results.
- **D-25:** The `/extraction` route (`app/extraction/page.tsx`) shows the job list with creation dialog trigger. The `/extraction/[jobId]` route shows results. The sidebar footer button is for in-progress monitoring without navigating away.
- **D-26:** Add extraction to `getCurrentPage()` function in `app-sidebar.tsx` for active state detection.

### Design & Accessibility (UI-06)
- **D-27:** All new components use **OKLCH color tokens** from `globals.css` — primary orange for actions, violet AI accent for extraction-specific elements, semantic colors for status badges. No hardcoded hex/rgb colors.
- **D-28:** Typography uses **Outfit variable font** (already configured as `--font-outfit`). Headings, body text, and labels follow the existing typographic scale.
- **D-29:** Animations use **spring-based Framer Motion** via `motion/react`, leveraging `lib/animation-config.ts` presets: `subtleSpring` for micro-interactions, `cardEntrance` + `cardEntranceTransition` for result cards loading in. `AnimatePresence mode="wait"` for view transitions.
- **D-30:** **WCAG AAA** compliance (7:1 contrast minimum): all text/background combinations validated against OKLCH tokens in both light and dark modes. Focus indicators use `focus-visible:ring-[3px]` pattern. Motion respects `prefers-reduced-motion` via `motion-safe:` prefix. Screen reader support: `aria-live` for status updates, `sr-only` labels on icon-only buttons, `role="status"` on progress indicators.

### Claude's Discretion
- Exact component file structure within `components/extraction/` — whether to create subdirectories (e.g., `components/extraction/job-creation/`, `components/extraction/results/`) or keep flat.
- Whether the `getExtractionResults` query uses cursor-based pagination or simple `.collect()` with a reasonable bound (likely few enough results per job to collect all).
- Exact Framer Motion animation timings and spring constants for new components — follow `lib/animation-config.ts` presets as baseline, tune if needed.
- Whether the extraction route uses a layout.tsx for shared header/nav or keeps pages self-contained.
- PostHog event names and properties for extraction analytics tracking.
- Exact color tuning for dark mode variants of the per-paper status badges.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Extraction Components (already built)
- `components/extraction/confidence-badge.tsx` — Confidence level badge with OKLCH colors
- `components/extraction/critic-verdict-badge.tsx` — Critic verdict badge with tooltip
- `components/extraction/evidence-quote.tsx` — Verbatim quote renderer using `bodyText.slice(startChar, endChar)`
- `components/extraction/insufficient-evidence-card.tsx` — Muted card for insufficient evidence answers
- `components/extraction/job-metrics-panel.tsx` — 2x2 metrics grid + SLO progress bars

### Screening Reference Pattern (primary reference for UI structure)
- `components/screening/screening-dialog.tsx` — Job creation dialog with question builder, credit check, submit flow
- `components/screening/screening-progress.tsx` — Progress card with badge, progress bar, counters
- `components/screening/screening-jobs-dialog.tsx` — Dialog wrapper for job history
- `components/screening/screening-job-history.tsx` — Job list with status dots, export dropdown, inline progress
- `components/app-sidebar.tsx` lines 276-365 — `ScreeningFooterButton` with circular SVG progress ring
- `components/app-sidebar.tsx` lines 470-514 — Nav items pattern for sidebar
- `components/app-sidebar.tsx` lines 426-434 — `getCurrentPage()` for active state detection

### Export Infrastructure
- `lib/screening/export.ts` — CSV/JSON/XLSX export with dynamic `exceljs` import (reference pattern)
- `lib/utils.ts` lines 144-220 — `downloadAsFile`, `jsonToCSV`, `generateFilename` utilities
- `components/download-menu.tsx` — Generic download dropdown component

### Convex Extraction Backend
- `convex/extraction/queries.ts` — `getExtractionProgress`, `getExtractionJobMetrics`, `listUserExtractionJobs`, `getPaperBodyText`, `getQualityTrend`, `getReviewQueue`
- `convex/extraction/mutations.ts` — `createExtractionJob` (public), `cancelExtractionJob` (public)
- `convex/schema.ts` lines 410-514 — Extraction tables with all indexes

### Design System
- `app/globals.css` — OKLCH color tokens, extraction-specific CSS (`.extraction-results-shell`, `.pdf-viewer-*`, `.citation-highlight`)
- `app/layout.tsx` lines 23-27 — Outfit font configuration
- `lib/animation-config.ts` — Framer Motion presets (`subtleSpring`, `cardEntrance`, `cardEntranceTransition`)

### i18n
- `i18n/config.ts` — Locale configuration: `en-US`, `en-GB`, `zh`, `fr`, `hi`, `ja`
- `messages/en-US.json` lines 1460+ — Existing `extraction.*` namespace with ~25 keys

### Auth & Credits
- `lib/auth/use-auth-query.ts` — `useProtectedQuery` hook for auth-gated queries
- `convex/ai/helpers.ts` — `withUserCreditsBatch` credit wrapper
- `api.credits.queries.checkBalance` — Credit balance check for cost preview

### Requirements
- `.planning/REQUIREMENTS.md` — UI-01 through UI-06 define exact scope
- `convex/_generated/ai/guidelines.md` — Convex API patterns and conventions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- 5 extraction components already built — `ConfidenceBadge`, `CriticVerdictBadge`, `EvidenceQuote`, `InsufficientEvidenceCard`, `JobMetricsPanel`
- `lib/screening/export.ts` — Full CSV/JSON/XLSX export infrastructure to clone for extraction
- `ScreeningFooterButton` — Sidebar progress ring pattern to replicate
- `ScreeningDialog` — Job creation dialog pattern to follow
- `ScreeningJobHistory` — Job list with status dots and export dropdown
- `DownloadMenu` component — Generic download dropdown
- `lib/animation-config.ts` — Spring presets for consistent motion
- `globals.css` extraction CSS classes — `.extraction-results-shell`, `.pdf-viewer-*`, `.citation-highlight` already defined

### Established Patterns
- Dialog-based job creation with `useState` open/close in parent
- Credit balance check inline before submit
- `useProtectedQuery` for auth-gated Convex queries
- `useTranslations("namespace")` for i18n
- PostHog `capture()` for analytics events
- `sonner` + `showStyledToast` for notifications
- `useFormatter()` for locale-aware date formatting
- `motion.div` with `AnimatePresence` for animated transitions
- `focus-visible:ring-[3px]` for keyboard focus indicators
- Staggered `cardEntranceTransition(index)` for list animations

### Integration Points
- `components/app-sidebar.tsx` — Add `ExtractionFooterButton` + `Extraction` nav item
- `app/extraction/page.tsx` — New route for extraction job list
- `app/extraction/[jobId]/page.tsx` — New route for extraction results
- `components/extraction/` — New components for job creation dialog, progress, results
- `lib/extraction/export.ts` — New export module cloning screening pattern
- `convex/extraction/queries.ts` — New `getExtractionResults` and `getExtractionResultsForExport` queries
- `messages/*.json` — Extend `extraction` namespace in all 6 locale files

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond what REQUIREMENTS.md UI-01 through UI-06 prescribe combined with the established patterns. The key insight is that 5 extraction components already exist (built during Phases 92/95), the screening feature provides a complete reference implementation for dialog-based job creation and sidebar progress, and the CSS already has extraction-specific classes prepared. This phase is primarily wiring existing backend queries to new UI surfaces using proven patterns.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 97-extraction-ui-polish*
*Context gathered: 2026-04-15*
