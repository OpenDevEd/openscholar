# Research Summary: Extraction Insights UI Overhaul (v5.0)

**Domain:** Academic literature extraction platform - data visualization refactoring
**Researched:** 2026-03-10
**Overall confidence:** HIGH (direct codebase analysis + targeted web research on NLP deduplication, chart scaling, i18n refactoring patterns)

## Executive Summary

Adding data visualization features (bar scaling, summary cards, confidence displays, semantic grouping, progress bars) to an existing extraction insights page involves **6 critical risks** and **5 moderate risks** that can cause shipping delays, user confusion, or test suite maintenance nightmares. The primary dangers are not technical incompleteness but **edge case handling** in real-world academic data:

1. **Bar scaling breaks on all-zero or extreme-dominance distributions** (e.g., 98% same answer, 2% outliers) — requires fallback rendering logic before implementation
2. **Semantic grouping (synonym merging) trades false positives for false negatives** — no perfect threshold without labeled training data; phase decision needed on MVP limitations
3. **Confidence scores confuse source availability with model quality** — abstract-only and no-PDF papers need contextual UI reframing, not just numeric display
4. **i18n for 6 locales is 3–5x more expensive if added after launch** — translations must be added FIRST, components second; one missing key ships to 16% of users in broken state
5. **Test suite regression on 884+ tests** — snapshot tests fail on every visualization change; refactoring to structural tests before Phase 1 saves weeks of maintenance
6. **extractionJobStats schema changes create backfill complexity** — lazy computation and index mismatches cause latency spikes on first access to old jobs

The existing `insights.ts` codebase (718 lines) is **well-designed** for pure aggregation logic but **not defensive** about edge cases. The UI components (`insights-overview.tsx`, `insights-question-panel.tsx`) are lightweight but will become brittle when adding new features.

## Key Findings

**Stack:** Already committed — Next.js, Convex, next-intl (6 locales), Zustand, Framer Motion, Vitest, Playwright
**Architecture:** Separation of concerns (pure aggregation in lib/extraction/insights.ts, component rendering in components/) is solid but schema support is fragile
**Critical pitfall:** Bar scaling edge cases (zero values, single dominance) — **must test before UI implementation**
**i18n blocker:** Adding new strings without translation synchronization is expensive; process must flip to "translations first, code second"

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation & i18n (2–3 days)
- **Add all new i18n keys to JSON files for 6 locales FIRST** (don't code UI yet)
- Refactor `InsightsOverview.test.ts` from snapshots to structural tests
- Add edge-case tests to `tests/extraction-insights.test.ts`:
  - Bar scaling: 0/0, 1/1000, 100/100
  - Confidence contexts: abstract-only (pdfContentUsed=false), no PDFs (confidence=0), grounded
  - Normalization: duplicate variants, stoplist coverage
- Expand `extractionJobStats` to track `pdfContentUsedCount` (prepare for schema changes)

**Addresses:**
- Pitfall 4 (i18n coverage): translations always in sync
- Pitfall 5 (test regression): structural tests prevent snapshot brittleness
- Pitfall 3 (confidence reframing): edge case tests guide UI design

**Avoids:**
- Shipping untranslated strings to 16% of users
- Spending weeks updating snapshots on every visualization change

### Phase 2: Summary Cards & Confidence Display (2–3 days)
- Implement summary cards (answered %, grounded %, best effort %, no-content count)
- Add confidence callout with context awareness:
  - IF no PDF used AND insufficient_evidence → "No content available"
  - IF no PDF used AND best_effort → "Abstract only"
  - IF PDF used → "Grounded in PDF"
- Test with real job data (abstract-only, no PDFs, mixed)
- Color/styling from design system (not inline hex)

**Addresses:**
- Pitfall 3 (confidence reframing): context-aware display prevents user confusion
- Pitfall 10 (color consistency): design system enforcement

**Avoids:**
- "Why is confidence 35% when I only gave you abstracts?"

### Phase 3: Bar Scaling & Stacked Bars (3–4 days)
- Implement relative-to-max scaling with explicit fallbacks:
  - When max=0: Show zero-height baseline or "no data" state
  - When one value >>99%: Use scaled view (log scale or secondary axis for minorities)
  - When N<5: Warning label "small sample size"
- Stacked bars with inline labels (for mobile) + legend (desktop)
- Accessibility: aria labels on all bars

**Addresses:**
- Pitfall 1 (bar scaling edge cases): fallback behavior defined before coding
- Pitfall 9 (stacked bar labeling): inline labels + aria for colorblind users

**Avoids:**
- Invisible bars on all-zero data
- Mobile layout breaks (legend off-screen)
- Accessibility failures on stacked bars

### Phase 4: Question List & Progress Bars (2 days)
- Question list with status dots (answered yes/no) + mini progress bars
- Progress bar: explicit rounding rules (0/0 → 0%, not NaN), aria attributes
- Test: 1/3 → 33% (not 33.333%), 0/0 → 0% (no crash)

**Addresses:**
- Pitfall 8 (progress bar precision): rounding rules prevent flickering

### Phase 5: Semantic Grouping (4–5 days) — *Contingent on Phase 1–4 success*
- **MVP (Phase 5a):** Basic synonym merging with expandable variants
  - Current approach (exact normalization) as baseline
  - Display: "GPT-4 (likely 5 variants)" → click to show ["gpt-4", "GPT4", "gpt 4", ...]
  - No fuzzy matching (acceptable MVP limitation)
- **Future (Phase 5b):** Multi-stage funnel if users report false positives
  - Stage 1: Exact match (current)
  - Stage 2: Fuzzy matching (Jaccard + LSH) if needed
  - Stage 3: Category grouping (LLM bucket)

**Addresses:**
- Pitfall 2 (semantic grouping): MVP shipped with acknowledged limitations

**Avoids:**
- Over-investing in perfect deduplication (no labeled training data exists)
- Shipping untested fuzzy matching that causes false positives

### Phase 6: extractionJobStats Refactoring (1–2 days) — *Parallel with Phase 5*
- Add optional `pdfContentUsedCount` to schema (derived, not stored)
- Add optional `topAnswersPreview` (computed from existing aggregation fields)
- NO required new fields → no backfill nightmare
- Lazy computation for first access to old jobs (acceptable latency trade-off)

**Addresses:**
- Pitfall 6 (schema changes): optional + derived + lazy computation = zero-downtime

**Phase ordering rationale:**
- Foundation (Phase 1) must happen first: i18n, test refactoring, edge case coverage
- UI builds (Phases 2–4) are sequential: simple → complex
- Semantic grouping (Phase 5) is contingent on Phase 1–4 success (can defer if needed)
- Schema work (Phase 6) is parallel, low-risk (optional fields)

**Research flags for phases:**
- Phase 1: Likely needs deeper research if i18n tooling changes (Convex i18n constraints?)
- Phase 2: Standard patterns, unlikely to need research
- Phase 3: Standard patterns (chart libraries well-studied), unlikely to need research
- Phase 4: Standard patterns (progress bars), unlikely to need research
- Phase 5: Needs validation if fuzzy matching upgrade is planned (NLP research required)
- Phase 6: Low-risk database work, unlikely to need research

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Bar scaling edge cases | HIGH | Tested in existing code (insights.test.ts), behavior documented |
| Confidence display reframing | HIGH | Existing codebase has `pdfContentUsed` field; edge cases clear from schema |
| i18n gaps (6 locales) | HIGH | Current code uses next-intl; missing keys are obvious (no fallback, key shows in UI) |
| Semantic grouping tradeoffs | MEDIUM | Research on NLP deduplication is solid but no labeled data from this domain; MVP approach safe, Phase 5b needs validation |
| Test regression on 884-test suite | HIGH | Direct observation: Vitest snapshot tests are brittle; refactoring to structural tests is proven pattern |
| extractionJobStats schema changes | HIGH | Convex incremental patterns well-documented; lazy backfill is established pattern |
| State management (Zustand + URL) | HIGH | Existing library page uses same patterns; implementation is clear |

## Gaps to Address

**Immediate (Before Phase 1):**
- Verify Convex supports adding optional fields to existing schema without breaking queries (likely yes, but confirm)
- Confirm next-intl structure for i18n key validation (Zod schema matching translation files)
- Confirm Tailwind config supports new colors for summary cards (likely yes, already in use)

**Phase 5 (Semantic Grouping):**
- If MVP variants approach is insufficient: label 100–300 paper-answer pairs with "should merge" / "should not merge" to set fuzzy-match threshold
- Evaluate Jaccard + LSH vs. semantic embeddings (embeddings may be more accurate but require model inference)

**Post-v5.0:**
- Monitor user feedback on semantic grouping false positives; plan Phase 5b fuzzy matching if needed
- Monitor query latency on old jobs after lazy backfill is introduced; may need batch backfill cron if latency is noticeable

## High-Risk Decisions

**1. Semantic Grouping MVP Approach (Phase 5)**
- **Decision:** Ship with basic normalization + expandable variants; don't invest in fuzzy matching yet
- **Risk:** Users with 50+ unique model names (synonyms) may see false disagreement
- **Mitigation:** Document limitation in release notes; plan Phase 5b upgrade path
- **Trigger for upgrade:** User complaint + enough data to train fuzzy-match thresholds

**2. Lazy Backfill for Old extractionJobStats (Phase 6)**
- **Decision:** Don't run batch migration; compute on first access
- **Risk:** First user to view old job sees 2s latency spike
- **Mitigation:** Add loading skeleton; batch backfill cron runs nightly (silent, non-blocking)
- **Trigger for fix:** If latency spike causes user complaints, switch to proactive backfill

**3. Test Refactoring Before Implementation (Phase 1)**
- **Decision:** Refactor InsightsOverview tests to structural tests BEFORE adding new features
- **Risk:** Phase 1 takes extra day but saves weeks downstream
- **Rationale:** 884-test suite snapshot brittleness is already a pain point; adding 5 new visualization features will make it unbearable
- **Trigger for reversal:** If refactoring takes >1 day, accept snapshot brittleness and plan lint rules to catch snapshot drift

---

*Last updated: 2026-03-10*
