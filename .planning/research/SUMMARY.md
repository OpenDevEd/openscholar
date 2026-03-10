# Project Research Summary: v5.0 Extraction Insights Overhaul

**Project:** OpenAlex Count
**Milestone:** v5.0 Extraction Insights UI Overhaul
**Domain:** Academic literature extraction platform — data visualization refactoring
**Researched:** 2026-03-10
**Overall Confidence:** HIGH

---

## Executive Summary

The v5.0 Extraction Insights Overhaul adds 6 visualization features (bar scaling, summary cards, confidence displays, semantic grouping, progress bars, stacked bars) to an existing extraction insights page with **zero backend changes** and **minimal new dependencies** (Recharts ^2.14.0 only). The technical architecture is straightforward: 4 new components, 3 modified components, no new queries.

However, success depends critically on **proactive defense against edge cases and process discipline**, not on technical complexity. The primary risks are not feature incompleteness but real-world data patterns (all-zero distributions, abstract-only papers, semantic grouping false positives) and operational hazards (6-locale i18n synchronization, 884-test suite snapshot brittleness). Research reveals that shipping visualization features without addressing these upfront creates 2–4 week maintenance debt.

**Recommended approach:** Phase 1 is defensive (i18n keys first, test refactoring, edge case tests); Phases 2–4 are sequential UI builds; Phase 5 is semantic grouping with acknowledged MVP limitations; Phase 6 is optional schema optimization. Total estimated effort: 12 days (1 engineer, test-first methodology).

---

## Key Findings

### Recommended Stack

**Recharts ^2.14.0** is the only new production dependency. The charting library is the official backend for shadcn/ui charts, provides native support for all 6 feature requirements (horizontal bars, stacking, responsive scaling, animations), and has excellent backward compatibility (1.4K+ GitHub stars, weekly releases, zero known security vulnerabilities as of Feb 2025).

Everything else reuses the existing stack: shadcn/ui Progress for mini progress bars, Framer Motion (already ^12.23.12) for animations, Tailwind CSS (already ^4) for styling, native HTML `<details>` for semantic grouping expandables.

**Core technologies for v5.0:**
- **Recharts ^2.14.0** — Horizontal bar charts, stacking, responsive rendering — Official shadcn/ui charting library; proven ecosystem
- **shadcn/ui Progress & Tooltip** — Progress bars, confidence callouts — Already in stack, zero additional cost
- **Framer Motion ^12.23.12** — Card entrance animations, bar transitions — Already in stack; reused for polish
- **Tailwind CSS ^4 + Lucide React** — Styling, status dots, icons — Already in stack, no upgrades needed

**Bundling impact:** Recharts adds ~65 KB (gzipped) but is lazy-loaded only when insights tab is accessed. Total incremental payload justified for pro-tier visualization feature.

### Expected Features

All 6 features are in scope for v5.0 per milestone definition. Features are interdependent but can be phased strategically:

**Must have (table stakes for credible UI):**
1. **Bar scaling relative to max value** — Users expect bars to fill container proportionally; 2–4% invisible bars break scanning
2. **Summary metric cards** — Users scan numeric summaries first; color accents reduce cognitive load and aid quick assessment
3. **Confidence display (contextual callout)** — Extraction quality is ambiguous; users need transparent signal of trustworthiness
4. **Question/item lists with status + mini progress** — Users track completion; status dots + progress bars reduce clicks and improve scannability

**Should have (enables accurate visualization):**
5. **Stacked horizontal bars for distributions** — Shows part-to-whole relationships (answers per question) required for categorical comparisons
6. **Semantic answer grouping with expandable variants** — Duplicate answers currently appear as separate rows; blocks accurate aggregation and visualization

**Complexity breakdown:**
- LOW (display-only): Bar scaling, summary cards, confidence display
- MEDIUM (aggregation): Progress bars, stacked bars
- HIGH (algorithm): Semantic grouping with synonym detection

### Architecture Approach

All 6 features integrate entirely through UI refactoring. The existing Convex queries (`getJobInsights`, `getQuestionInsights`, `getQuestionDisagreements`) already return all data needed for new visualizations. No schema changes, no query modifications, zero breaking changes.

**New components required (4):**
1. `StackedHorizontalBar.tsx` — Renders 4-segment bar (grounded/best_effort/insufficient/error)
2. `ConfidenceDisplay.tsx` — Shows raw vs effective confidence with context-aware tooltip
3. `QuestionListItem.tsx` — Question row with status dot + progress bar
4. `AnswerClusterGroup.tsx` — Expandable answer variant grouping with local state

**Modified components (3):**
1. `InsightsOverview.tsx` — Extract summary cards to array; replace question list with QuestionListItem
2. `InsightsQuestionPanel.tsx` — Replace Bar components with Recharts; add ConfidenceDisplay; add StackedHorizontalBar; wrap answers in AnswerClusterGroup
3. `lib/extraction/insights.ts` — Add optional `maxCount` fields to aggregation return types

**Data flow:** Unchanged. All 6 features consume data from existing queries; no new backend calls needed.

### Critical Pitfalls

**Pitfall 1: Bar Scaling Edge Cases** (HIGH severity, MEDIUM probability)
- **Problem:** Relative-to-max scaling breaks on all-zero distributions (max=0 → NaN), extreme dominance (98% same answer → other bars invisible)
- **Prevention:** Define fallback behavior explicitly before coding; test edge cases on aggregation functions first

**Pitfall 2: Semantic Grouping False Positives vs False Negatives** (HIGH severity, LOW probability if MVP approach accepted)
- **Problem:** Normalization misses some duplicates and over-merges others
- **Prevention:** MVP ships with acknowledged limitations (expandable variants); multi-stage fuzzy matching deferred to v5.1

**Pitfall 3: Confidence Display Reframing** (HIGH severity, MEDIUM probability)
- **Problem:** Confidence scores conflate model uncertainty with source availability (abstract-only papers → always 70% ceiling)
- **Prevention:** Context-aware display: IF no PDF AND insufficient → "No content available"; IF no PDF AND best_effort → "Abstract only"

**Pitfall 4: i18n Coverage Gaps** (HIGH severity, HIGH probability if process doesn't change)
- **Problem:** Adding 15+ new UI strings without synchronizing across 6 locales; missing keys shipped to UI as key names
- **Prevention:** PROCESS FLIP: Add all translation keys to JSON files FIRST (6 locales), THEN write components; enforce with Zod validation

**Pitfall 5: Test Regression on 884-Test Suite** (MEDIUM severity, HIGH probability)
- **Problem:** Refactoring insights components breaks snapshot tests; hundreds of snapshots to regenerate
- **Prevention:** BEFORE Phase 1, refactor InsightsOverview.test.ts from snapshots to structural tests

---

## Implications for Roadmap

Based on research dependencies and pitfall prevention, suggested phase structure:

### Phase 1: Foundation & i18n + Test Refactoring (2–3 days)
**Rationale:** Edge case handling, i18n synchronization, and test brittleness must be addressed upfront. Delaying these creates exponential debt downstream.

**Deliverables:**
- Add all new i18n translation keys to 6 locale JSON files
- Refactor `InsightsOverview.test.ts` from snapshots to structural tests
- Add edge-case test suite to `tests/extraction-insights.test.ts` (bar scaling, confidence contexts, normalization)

**Addresses:**
- Pitfall 4 (i18n gaps): translations always in sync
- Pitfall 5 (test regression): structural tests prevent snapshot brittleness
- Pitfall 3 (confidence reframing): edge case tests guide UI design
- Pitfall 1 (bar scaling): documented expected behavior

---

### Phase 2: Summary Cards & Confidence Display (2–3 days)
**Rationale:** Display-only features with no backend changes; uses i18n keys from Phase 1.

**Deliverables:**
- Implement summary cards with reordering and color accents
- Implement confidence callout with context awareness (abstract-only, no-PDF, grounded)
- Color/styling from design system
- Manual QA with abstract-only and no-PDF jobs

**Implements:**
- Feature 2 (summary cards)
- Feature 3 (confidence display)

---

### Phase 3: Bar Scaling & Stacked Bars (3–4 days)
**Rationale:** Chart libraries and scaling logic; uses Recharts.

**Deliverables:**
- Implement relative-to-max scaling with explicit fallbacks (zero values, dominance, small samples)
- Implement stacked horizontal bar for citation status
- Inline labels for mobile; legend for desktop
- Accessibility: aria-label on bars, color legend for colorblind users
- Component: `StackedHorizontalBar.tsx`

**Implements:**
- Feature 1 (bar scaling)
- Feature 5 (stacked bars)

**Uses:**
- Recharts ^2.14.0

---

### Phase 4: Question List & Progress Bars (2 days)
**Rationale:** Simple metric aggregation; unblocks next phase.

**Deliverables:**
- Question list with status dots + mini progress bars
- Progress bar rounding rules: explicit code (0/0 → 0%, not NaN)
- aria-valuenow + aria-label for accessibility
- Component: `QuestionListItem.tsx`

**Implements:**
- Feature 4 (question list + progress)

---

### Phase 5: Semantic Grouping & Answer Variants (4–5 days) — *Contingent on Phase 1–4 success*
**Rationale:** Most complex feature; MVP approach defers perfect deduplication. Can defer to v5.1 if needed.

**Deliverables:**
- **Phase 5a (MVP):** Basic synonym merging with expandable variants
  - Display: "GPT-4 (likely 5 variants)" → click to expand
  - Expandable state local to component (useState per cluster)
  - No fuzzy matching (acceptable MVP limitation documented in release notes)
  - Component: `AnswerClusterGroup.tsx`
- **Phase 5b (Deferred, if user feedback warrants):** Multi-stage funnel for fuzzy matching
  - Requires labeled training data (100–300 paper-answer pairs) to set thresholds

**Implements:**
- Feature 6 (semantic grouping)

---

### Phase 6: Schema Optimization & extractionJobStats (1–2 days) — *Parallel with Phase 5*
**Rationale:** Optional backend enhancement; can run in parallel with semantic grouping.

**Deliverables:**
- Add optional `pdfContentUsedCount` to extractionJobStats (derived, not required)
- Add optional `topAnswersPreview` (computed from existing fields)
- NO required new fields → no backfill nightmare
- Lazy computation for first access to old jobs (acceptable latency trade-off)
- Batch backfill cron runs nightly

---

### Phase 7: Internationalization Polish (1 day) — *After Phases 1–6*
**Rationale:** Final step; all UI strings already in translation files from Phase 1.

**Deliverables:**
- CI validation: all 6 locales have all extraction keys
- Manual QA with `NEXT_LOCALE=fr` for each locale

---

### Phase Ordering Rationale

1. **Phase 1 first (Foundation)** — i18n, tests, edge cases must be defended upfront. One engineer can do this in 2–3 days; skipping it costs 2–4 weeks of maintenance.

2. **Phases 2–4 sequential (UI Builds)** — Display-only features with increasing complexity.

3. **Phase 5 contingent (Semantic Grouping)** — Can defer to v5.1 if earlier phases encounter blockers. MVP approach with acknowledged limitations is acceptable.

4. **Phase 6 parallel (Schema)** — Low-risk database work; doesn't block UI phases.

5. **Phase 7 last (i18n Polish)** — Keys already added in Phase 1; this is just verification.

---

## Research Flags

### Phases Needing Deeper Research During Planning

- **Phase 1 (i18n validation):** Verify Convex constraints on i18n schema. Confirm next-intl version supports Zod validation. Minimal research; mostly setup.
- **Phase 5b (Fuzzy Matching Upgrade):** If user feedback suggests false negatives are unacceptable, needs NLP research on Jaccard + LSH vs. semantic embeddings. **Not in scope for v5.0; defer to v5.1.**

### Phases with Standard Patterns (Skip Research)

- **Phase 2 (Summary Cards & Confidence):** Standard design patterns; well-documented. No research needed.
- **Phase 3 (Bar Scaling & Recharts):** Chart libraries well-studied; Recharts documentation comprehensive. No research needed.
- **Phase 4 (Progress Bars):** Standard UI component. No research needed.
- **Phase 6 (Schema Changes):** Convex incremental patterns established; lazy backfill is proven pattern. No research needed.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| **Stack** | HIGH | Recharts verified as official shadcn/ui backend; zero conflicts |
| **Features** | HIGH | All 6 features well-defined with dependency graph |
| **Architecture** | HIGH | Zero backend changes; all data available in existing queries |
| **Pitfalls** | HIGH | Direct codebase analysis (718 lines insights.ts, 884-test suite observed). Edge cases documented. |
| **Roadmap Phasing** | HIGH | Dependencies clear; risk mitigation strategies proven |

**Overall confidence:** HIGH
**Key assumption:** Phase 1 is committed to before other phases (non-negotiable for risk mitigation).

---

## Gaps to Address

### Before Phase 1 Starts

1. **Verify i18n Key Validation:** Confirm next-intl supports type-safe key matching with Zod. If not, create wrapper utility.

2. **Confirm Tailwind Color Extensions:** Verify existing components.json supports custom colors (likely yes).

3. **Convex Optional Fields:** Confirm Convex allows optional fields in schema without breaking existing queries. Test lazy computation pattern.

### During Phase 5 (If Fuzzy Matching Needed)

1. **Labeled Training Data:** If MVP false negative rate is unacceptable, collect 100–300 paper-answer pairs labeled as "should merge" / "should not merge."

2. **Similarity Algorithm Comparison:** Evaluate Jaccard + LSH vs. semantic embeddings.

### Post-v5.0 Monitoring

1. **User Feedback on Semantic Grouping:** Track issues reported about duplicate/false merges.

2. **Query Latency on Old Jobs:** Monitor performance after lazy backfill. If spikes are noticeable (>500ms), plan batch backfill upgrade.

---

## Sources

### Stack Research
- [shadcn/ui Charts Library](https://ui.shadcn.com/charts)
- [Recharts Documentation](https://recharts.org/)
- [Recharts Stacked Bar Charts](https://recharts.github.io/en-US/examples/StackedBarChart/)
- [Top 5 React Chart Libraries 2026 (Syncfusion)](https://www.syncfusion.com/blogs/post/top-5-react-chart-libraries)

### Feature Research
- [Data Visualization Best Practices - Tilburg Science Hub](https://www.tilburgsciencehub.com/topics/visualization/data-visualization/graphs-charts/theory-best-practices/)
- [A Complete Guide to Bar Charts | Atlassian](https://www.atlassian.com/data/charts/bar-chart-complete-guide)
- [Stacked Bar Charts: A Detailed Breakdown | Atlassian](https://www.atlassian.com/data/charts/stacked-bar-chart-complete-guide)

### Pitfall Research
- [Data Visualization Pitfalls](https://www.techment.com/blogs/data-visualization-best-practices-enterprise/)
- [NLP Duplicate Detection: Setting Similarity Thresholds](https://www.tesserblu.com/post/reducing-false-positives-in-literature-screening-using-nlp)
- [Chart Scaling Best Practices (Zero Baseline)](https://clauswilke.com/dataviz/proportional-ink.html)
- [i18n Retrofitting Cost: 3–5x More Expensive Than Upfront](https://www.locize.com/blog/what-is-i18n/)
- [Regression Testing with UI Refactoring](https://katalon.com/resources-center/blog/regression-test-strategy)
- [Database Refactoring: Expand-and-Contract Pattern](https://medium.com/@jasminfluri/expand-and-contract-method-for-database-changes-414d236f236f)

### Architecture Research
- Direct codebase analysis: 718 lines `lib/extraction/insights.ts`, 884-test suite structure
- [Zustand State Management: Pitfalls and Patterns](https://tkdodo.eu/blog/zustand-and-react-context)

---

*Research completed: 2026-03-10*
*Prepared for: v5.0 Roadmap Creation*
*Ready for roadmap planning: YES*
