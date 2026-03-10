# Domain Pitfalls: Extraction Insights UI Overhaul (v5.0)

**Domain:** Academic literature extraction platform - data visualization refactoring
**Researched:** 2026-03-10
**Focus:** Adding bar scaling, summary cards, confidence display, semantic grouping, progress bars, and stacked bars to existing extraction insights page

## Critical Pitfalls

### Pitfall 1: Bar Scaling Edge Cases (Zero Values and Dominance)

**What goes wrong:**
When refactoring bar scaling from absolute to relative-to-max scaling, visualization breaks in edge cases:
- All values are 0 → division by zero, NaN, or invisible bars
- Single value dominates (e.g., 98% of papers have one answer, 2% have another) → other bars become invisible microdots
- Very small sample sizes → noise gets amplified by relative scaling
- Confidence distribution with 90% "unknown" confidence → confidence buckets collapse to one bar

**Why it happens:**
Relative scaling (`value / Math.max(...values)`) is mathematically sound but assumes diverse non-zero data. Academic extraction has legitimate edge cases (no PDFs → no grounded answers, abstract-only papers → specific confidence patterns).

**Consequences:**
- UI appears broken or deceptive
- Users can't see minority answers that may be valuable
- Test assertions fail when expected bars don't render
- 884+ existing tests may catch issues late in development

**Prevention:**
1. **Define fallback behavior explicitly:**
   - When max=0: Show either zero-height baseline or "no data" state
   - When one value >>99%: Use auxiliary scale (e.g., log scale, secondary y-axis for minority values)
   - When N<5: Display warning "small sample size" instead of confident percentages

2. **Test edge cases first (before implementing UI):**
   ```typescript
   // Test: abstract-only job (always 70% confidence ceiling)
   aggregateQuestionInsights([
     { answer: "yes", confidence: 0.7, citationStatus: "best_effort" },
     { answer: "yes", confidence: 0.7, citationStatus: "best_effort" },
     // ... all 0.7, all best_effort
   ])
   // Expect: confidenceBuckets.high=0, .medium=100%, charts don't overflow

   // Test: no PDFs (all "insufficient_evidence", confidence=0)
   aggregateQuestionInsights([
     { answer: null, confidence: 0, citationStatus: "insufficient_evidence" },
     // ...
   ])
   // Expect: graceful zero-state, not NaN
   ```

3. **Implement soft min/max in charting library:**
   - Ensure bars always start at 0 (foundation principle)
   - For confidence buckets: min scale 0, max scale 1.0 (percentage)
   - For answer distributions: min scale 0, max scale Math.max(counts) or Math.max(counts, 1)

**Detection:**
- Snapshot test fails when bar width becomes `width: NaN%` or `width: 0px` unexpectedly
- Playwright visual test shows empty bars when data exists
- Manual QA: job with all same answers → bars vanish
- Manual QA: abstract-only extraction → confidence bars all in "medium" bucket

**Integration point:** Phase where bar charts are implemented (likely Phase 2 of v5.0)

---

### Pitfall 2: Semantic Grouping False Positives vs False Negatives

**What goes wrong:**
Synonym merging via `normalizeAnswer()` + clustering creates two failure modes:
1. **False negatives (missed duplicates):** "GPT-4" and "gpt 4" and "GPT4" should merge; slight variations don't
2. **False positives (over-merging):** "model A" and "model B" both normalize to "model" → incorrectly grouped
3. **Context loss:** Merging "increase" + "increased" is correct; merging "increase 5%" + "increase 10%" loses magnitude information

**Why it happens:**
Current normalization in `insights.ts` (lines 179-245):
```typescript
normalizeText(value): value.trim().toLowerCase().replace(/[^\w\s%.-]/g, "")
// Removes punctuation but preserves structure
// Result: "GPT-4" → "gpt4" ✓
// But: "machine learning" stoplist catches "ai" but not "artificial intelligence (AI)"
```

This is a classic NLP deduplication problem: strict matching = false negatives, loose matching = false positives. There's no universal threshold (see research: 100–300 labeled samples needed to set thresholds).

**Consequences:**
- Answer buckets have duplicate-looking entries: "github copilot" appears once, "Copilot" appears separately
- Users see false disagreement when semantically there's consensus
- Reports show ~12 unique models when there are really ~6
- Test suite doesn't catch this (tests use canonical inputs, not messy real-world variants)

**Prevention:**
1. **Multi-stage funnel approach (recommended):**
   - Stage 1: Exact match after normalization (current approach) → HIGH precision
   - Stage 2: If clusters < expected: fuzzy matching (Jaccard similarity + LSH) → catches "model a" vs "model-a"
   - Stage 3: If still uncertain: fallback to category grouping (e.g., all LLM models under "Language Models")

2. **Confidence scoring for merges:**
   - Track `mergeProbability: number` on each cluster
   - Display expandable variants when probability < 0.8
   - UI: "GPT-4 (likely 5 variants)" → click to show ["gpt-4", "GPT4", "gpt 4", ...]

3. **Domain-specific stoplists (not generic):**
   Current: `GENERIC_ARRAY_ENTITY_STOPLIST` (line 158) catches AI/ML terms
   Problem: Fails on domain names ("BERT" is a model, not "best effort result type"), acronyms ("XGBoost" normalized wrong)

4. **Test strategy:**
   - Keep real-world test data: extract 20 papers with human-reviewed answer variants
   - Test: variants merge correctly, non-variants don't
   - Regression: re-run when merging logic changes

**Detection:**
- Manual review: extract job → insights → answer buckets → spot duplicate display
- Automated: compute answer cluster count, compare against expected count
- User reports: "Why does my report show 12 models when I only used 3?"

**Phase-specific warning:**
This is acceptable to ship in Phase 1 (MVP) with **acknowledged limitations** (docs: "Synonym grouping is basic; variants may appear as separate entries"). Upgrade to multi-stage in Phase 2 if users report issues.

---

### Pitfall 3: Confidence Display Reframing (Abstract-Only and No-PDF Edge Cases)

**What goes wrong:**
Current implementation: `avgEffectiveConfidence = avgConfidence * confidenceMultiplier(citationStatus)`
- Abstract-only papers → AI sees abstract only → always 70% confidence ceiling (best_effort multiplier=0.55 → effective ≈35%)
- No PDFs available → All insufficient_evidence → confidence=0 → effective=0
- But UI says "35% grounded" which implies PDFs were available and just low quality

**Why it happens:**
Confidence is relative to **source availability**, not model quality. The UI conflates:
- Model uncertainty ("I'm 95% sure the answer is X")
- Grounding uncertainty ("I found evidence on page 15 vs only abstract")

When no PDFs exist, users misinterpret 0% grounded as "the AI failed" rather than "no source material existed."

**Consequences:**
- Users trust confidence scores incorrectly → extract from abstract-only papers and assume answers are unreliable when actually PDF access was missing
- Reports show "effectiveness: 35%" for abstract-only jobs and "effectiveness: 0%" for no-content papers → looks like different quality when it's different input
- Confidence callouts need context (field: `pdfContentUsed: boolean`) to display correctly

**Prevention:**
1. **Context-aware confidence display:**
   ```typescript
   // Pseudocode
   if (!pdfContentUsed && citationStatus === "insufficient_evidence") {
     display: "No content available"
     callout: "Papers lack PDF access or content. Confidence scores unavailable."
   } else if (!pdfContentUsed && citationStatus === "best_effort") {
     display: `${confidence * 100}% (abstract only)`
     callout: "Based on abstract text only. May improve with full PDF access."
   } else {
     display: `${confidence * 100}% grounded`
     callout: "Supported by in-text citations from PDF."
   }
   ```

2. **Schema validation in extractionJobStats:**
   - Add `pdfContentUsedCount: number` (count of papers with PDF used)
   - Compute `avgConfidenceWhenPdfUsed` separately
   - Surface both in UI for comparison

3. **Test the boundary:**
   ```typescript
   it("confidence=0.7 with no PDF is labeled as abstract-only, not effective", () => {
     const aggregate = aggregateQuestionInsights([
       { answer: "yes", confidence: 0.7, citationStatus: "best_effort", pdfContentUsed: false },
       // ...
     ]);
     // Expect: UI shows "Abstract-only extraction" not "70% effective confidence"
     expect(displayLabel).toContain("abstract");
   });
   ```

4. **Document in i18n:**
   - Add translation key: `extraction.confidenceAbstractOnly`
   - Add translation key: `extraction.confidenceNoContent`
   - Prevents hard-coded strings in components

**Detection:**
- Manual: extract abstract-only job, check confidence display, verify it says "abstract-only"
- Regression: add to extraction-insights.test.ts edge case suite
- User feedback: "Why is confidence 35% when I only gave you abstracts?"

**Integration point:** Phase 1 or 2 of v5.0 (confidence display refactoring)

---

### Pitfall 4: i18n Coverage Gaps (6 Locales, New UI Strings)

**What goes wrong:**
Adding 15+ new UI strings (bar chart labels, summary card titles, confidence callouts, progress indicators, semantic grouping labels) without synchronizing across 6 locales:
- English has "Average Confidence (Grounded)" but French/Spanish missing translation
- English callout explains 0.7 confidence on abstract; German translation is outdated/wrong
- Progress bar shows "3 / 5 answered" in English but French shows "3 / 5 répondus" (wrong grammatical context)

**Why it happens:**
i18n refactoring pitfall: adding strings in code BEFORE adding to translation files. Current setup uses `next-intl` with JSON files per locale (common practice), but lacks automation to catch missing keys.

Research finding: Adding i18n after launch is **3–5x more expensive**. Even in-codebase additions are expensive if translation system isn't strict.

**Consequences:**
- Fallback translation shows translation key: "extraction.confidenceAbstractOnly" instead of French text
- Users in non-English locales see English text mixed with French (jarring UX)
- QA must manually verify all 6 locales for new features (slow)
- Missing translations shipped to production undetected

**Prevention:**
1. **Type-safe translation key detection (Zod):**
   Create a validator that checks all `useTranslations()` calls against translation file schema:
   ```typescript
   // convex/lib/i18n-keys.ts
   const EXTRACTION_KEYS = z.enum([
     "answered",
     "grounded",
     "confidenceAbstractOnly",
     "confidenceNoContent",
     // ... all keys
   ]);

   // In component: t(EXTRACTION_KEYS.parse("confidenceAbstractOnly"))
   // Fails compile-time if key doesn't exist
   ```

2. **Translation completeness test:**
   ```typescript
   // tests/i18n-coverage.test.ts
   it("all extraction translation keys exist in all 6 locales", () => {
     const locales = ["en", "fr", "es", "de", "pt", "zh"];
     const enKeys = Object.keys(EN_TRANSLATIONS["extraction"]);

     for (const locale of locales) {
       const localeKeys = Object.keys(TRANSLATIONS[locale]["extraction"]);
       const missing = enKeys.filter(k => !localeKeys.includes(k));
       expect(missing).toHaveLength(0, `${locale} missing: ${missing.join(", ")}`);
     }
   });
   ```

3. **Forced-locale manual verification (pre-merge):**
   - CI script: build and test with `NEXT_LOCALE=fr` for each locale
   - Catch missing translations before merge

4. **Add translations FIRST in PR:**
   - Update all 6 translation JSON files
   - Add UI component second
   - Easier to review, less likely to miss locale

**Detection:**
- Build with `NEXT_LOCALE=fr` and search for fallback keys in browser console
- i18n test suite fails
- User report: "The insights page shows English strings in French interface"

**Integration point:** Must happen in Phase 1 or 2 (any phase that adds UI strings)

---

### Pitfall 5: Test Regression on 884+ Test Suite (Snapshot/Behavioral)

**What goes wrong:**
When refactoring insights components (insights-overview.tsx uses aggregateQuestionInsights), changes break existing tests:
1. **Snapshot test brittleness:** Component render snapshot includes bar widths, colors, labels → one number change fails snapshot
2. **Behavioral regression:** Change `topAnswers.slice(0, 10)` to `topAnswers.slice(0, 20)` → downstream tests expect ≤10 answers
3. **Edge case exposure:** New UI exposes edge cases old UI hid (e.g., all values = 0 → bars invisible → test expects visible bars)

**Why it happens:**
Large test suite (884+ tests across 87+ files) is powerful for catching regressions but expensive to update. Current strategy uses Vitest with structured test files, but component snapshot tests are notorious for flakiness.

**Consequences:**
- Every component-level change requires snapshot regeneration
- Easy to accidentally approve wrong snapshot (visual regression undetected)
- Tests fail for legitimate improvements (noise makes devs ignore test failures)
- CI pipeline gets flaky: 50% of builds fail due to unrelated snapshot invalidation

**Prevention:**
1. **Use structural tests instead of snapshots for insights:**
   ```typescript
   // Instead of: expect(component).toMatchSnapshot()
   // Use: expect(component rendering data structure)
   it("renders summary cards with correct percentages", () => {
     const aggregate = aggregateQuestionInsights([...]);
     const { container } = render(<InsightsOverview insights={aggregate} />);

     const answeredCard = container.querySelector('[data-testid="summary-answered"]');
     expect(answeredCard).toHaveTextContent(/\d+%\s+answered/);
     // ✓ Tests behavior, not exact pixel rendering
   });
   ```

2. **Regression test only aggregation logic (not rendering):**
   - insights.ts functions are pure → test only them
   - Components render those functions → test rendering separately with data-driven tests
   - Decouple logic from UI

3. **Bounded test updates (pre-defined scope):**
   - Define: "Changing from 10 to 20 topAnswers is a feature change; requires snapshot update + approval"
   - Define: "Changing color from #fff to #fafafa is a style fix; no test impact"
   - Explicit list in PR: "Expected test updates"

4. **Playwright E2E for critical paths only:**
   - Unit tests: insights.ts aggregation (fast, stable)
   - Integration tests: extraction job → insights query → aggregation (medium)
   - E2E (Playwright): User extracts papers → views insights → filters questions (slow, manual)
   - Don't E2E every feature

**Detection:**
- `npm test` fails with snapshot mismatch
- Pre-merge: review ALL snapshot diffs (visual inspection for legitimacy)
- CI: track test failure rate; if >20% of runs fail due to snapshots, refactor to structural tests

**Phase-specific action:**
Before Phase 1 of v5.0, refactor InsightsOverview.test.ts from snapshots to structural tests. Saves weeks of maintenance pain.

---

### Pitfall 6: extractionJobStats Schema Changes (Incremental Aggregation)

**What goes wrong:**
Adding new fields to `extractionJobStats` (e.g., `topAnswersPreview: string[]` for stacked bars) requires careful schema migration:
1. **Backfill dilemma:** Existing 500+ jobs have no `topAnswersPreview` → query must handle undefined
2. **Lazy computation overhead:** Computing top answers on every read (not stored) → O(N) query complexity
3. **Index obsolescence:** Current index `by_job_question` optimized for old schema → new queries use different filters → slow scans

**Why it happens:**
Convex uses **expand-and-contract pattern** for zero-downtime migrations. Schema is additive (optional new fields), but:
- Reader must handle both old (missing field) and new (field exists) documents
- Writes go to new schema only
- Backfill is deferred (lazy or batched)

Research finding: Incremental aggregation models can become problematic if schema changes alter what data is accessible for aggregation.

**Consequences:**
- Query (getJobInsights) becomes complex with fallbacks: `stat.topAnswersPreview ?? computeTopAnswersLive()`
- Lazy backfill creates latency spikes: first access to old job triggers computation, 2s query delay
- Index mismatch: queries using new fields don't use optimal indexes → queries N times slower

**Prevention:**
1. **Define new fields as optional and derived, not authoritative:**
   ```typescript
   // BAD: Add topAnswersPreview as required new field → backfill nightmare
   // GOOD: Compute topAnswersPreview dynamically from existing confidenceSum, count fields

   interface ExtractedJobStats {
     totalPapers: number;
     // ... existing fields
     // NEW (v5.0): computed, not stored
     topAnswersPreview?: AnswerBucket[]; // Derive from aggregation, not store
   }
   ```

2. **Lazy computation only for expensive ops:**
   ```typescript
   // getJobInsights mutation: fetch stat by job
   const stat = await ctx.db
     .query("extractionJobStats")
     .withIndex("by_job_question", q => q.eq("jobId", jobId).eq("questionKey", key))
     .unique();

   // If stat exists, use it. If not, recompute live (acceptable for first access)
   const aggregate = stat
     ? reconstructFromStat(stat)
     : await computeAggregateFromResults(jobId, key);
   ```

3. **Index planning before schema changes:**
   - Current: `by_job` (query all stats for a job), `by_job_question` (query one Q/A per job)
   - New feature needs: filter by `topAnswerCount > 5` → need `by_job_topAnswerCount`
   - Add index in Convex schema BEFORE adding reads that use it

4. **Batch backfill (not migration):**
   ```typescript
   // cron: compute missing topAnswersPreview for old jobs
   export const backfillJobStatsTopAnswers = cronJob(
     { periodicityMs: 24 * 60 * 60 * 1000 }, // daily
     async (ctx) => {
       const needsBackfill = await ctx.db
         .query("extractionJobStats")
         .filter(q => q.eq(q.field("topAnswersPreview"), undefined))
         .take(100); // Batch limit

       for (const stat of needsBackfill) {
         const updated = await computeTopAnswers(stat);
         await ctx.db.patch(stat._id, { topAnswersPreview: updated });
       }
     }
   );
   ```

**Detection:**
- Query performance regression: insights page loads 2s slower after schema change
- Logs show backfill computation on hot path (first user to view old job pays latency)
- Schema validation error: reader expects field, document missing it

**Integration point:** Phase 1 of v5.0 (when extractionJobStats schema is modified)

---

## Moderate Pitfalls

### Pitfall 7: State Management Complexity (Zustand + URL State + Convex)

**What goes wrong:**
Insights page needs to track: selected question, filter state (status), sort order. Three state sources collide:
- Zustand store (sidebar filter state, reusable across library page)
- URL state via nuqs (bookmarkable filters)
- Convex query (job insights data, reactive)

When adding new filters (e.g., "show only grounded answers"), unclear which store owns it:
```typescript
// Confusion: three places to store state
const [questionFilter] = useInsightsStore(); // Zustand
const [status, setStatus] = useQueryState("status"); // URL
const insights = useQuery(api.extraction.queries.getJobInsights, { jobId }); // Convex
```

**Consequences:**
- Filter state loses sync: URL says "status=grounded" but Zustand store says "status=all" → UI shows wrong results
- Bookmarks break: user shares URL, second user loads with URL filters, Zustand hasn't synced
- Multiple sources of truth → bugs during rapid feature iteration

**Prevention:**
1. **Single source of truth: URL state**
   - URL is bookmarkable, shareable, browser-native
   - Derive Zustand from URL on mount
   - Rule: `useQueryState("questionKey")` for all filter state
   - Zustand only for transient UI state (modal open/close, animation flags)

2. **Explicit sync on mount:**
   ```typescript
   export function InsightsPage() {
     const [selectedQuestion, setSelectedQuestion] = useQueryState("question");
     const [statusFilter, setStatusFilter] = useQueryState("status"); // "grounded" | "all"

     useEffect(() => {
       // On mount, URL state is canonical. Zustand is read-only.
       // Don't write to Zustand from URL; just read.
     }, []);

     // ✓ Single source: URL drives queries
     const insights = useQuery(api.extraction.queries.getJobInsights, {
       jobId,
       statusFilter,
     });
   }
   ```

3. **Type-safe filter state:**
   ```typescript
   const StatusFilter = z.enum(["all", "grounded", "best_effort", "insufficient_evidence"]);
   const querySchema = z.object({
     question: z.string().optional(),
     status: StatusFilter.optional().default("all"),
   });

   // useQueryState validates type
   const [status] = useQueryState("status", { /* validation */ });
   ```

**Detection:**
- Manual: extract job → filter by grounded → reload page → filter doesn't persist
- Automated: integration test for URL sync
- Bug report: "My filter settings reset when I click back"

---

### Pitfall 8: Progress Bar Precision (Percentages vs Counts)

**What goes wrong:**
Question list with "progress bar" shows: "3 of 5 papers answered" → 60% bar width.

Edge cases break display logic:
- 1 of 3 → 33.33...% → bar width is `width: 33.333333%` (looks wrong)
- 0 of 5 → 0% → bar invisible (expected)
- 0 of 0 → NaN% → crashes

**Why it happens:**
Percentage calculation: `answered / total` is naive. Rounding, integer division, zero-division edge cases.

**Consequences:**
- Progress bar widths flicker due to floating-point rendering differences
- Zero-total edge case crashes render
- Accessibility: aria-valuenow doesn't match visible width (confuses screen readers)

**Prevention:**
1. **Define explicit rounding rules:**
   ```typescript
   function progressPercent(answered: number, total: number): number {
     if (total === 0) return 0; // No-data state
     const percent = (answered / total) * 100;
     return Math.round(percent); // Round to nearest integer
   }
   ```

2. **Use counts in aria attributes:**
   ```typescript
   <div
     role="progressbar"
     aria-valuenow={answered}
     aria-valuemin={0}
     aria-valuemax={total}
     aria-label={`${answered} of ${total} papers answered`}
     style={{ width: `${progressPercent(answered, total)}%` }}
   />
   ```

3. **Test edge cases:**
   ```typescript
   it("progress bar handles 0/0 and 1/3", () => {
     expect(progressPercent(0, 0)).toBe(0); // No crash
     expect(progressPercent(1, 3)).toBe(33); // Rounded
     expect(progressPercent(0, 5)).toBe(0);  // Invisible bar is correct
   });
   ```

---

### Pitfall 9: Stacked Bar Distribution Labeling (Which is which?)

**What goes wrong:**
Stacked bar shows: [grounded: 40%] [best_effort: 35%] [insufficient_evidence: 25%]

User sees colored bar, but doesn't know which color = which status:
- Color legend missing or far from bar
- Mobile viewport: legend off-screen, bar visible
- Accessibility: colors only, no text → colorblind users see nothing

**Prevention:**
1. **Inline labels for mobile:**
   ```typescript
   // Desktop: separate legend
   // Mobile: labels on bar segments if >15% width
   <div className="flex h-4">
     {segments.map(seg => (
       <div
         key={seg.status}
         style={{ width: `${seg.percent}%` }}
         className={`${colors[seg.status]} relative`}
       >
         {seg.percent > 15 && (
           <span className="text-xs text-white absolute left-1">
             {seg.status.slice(0, 3)}
           </span>
         )}
       </div>
     ))}
   </div>
   ```

2. **Aria labels:**
   ```typescript
   <div
     role="progressbar"
     aria-label={`Citation status: ${segments.map(s => `${s.status} ${s.percent}%`).join(", ")}`}
   >
   ```

---

## Minor Pitfalls

### Pitfall 10: Color Consistency Across New Components

**What goes wrong:**
New summary cards and bars use colors not defined in existing Tailwind config → developer adds inline `bg-blue-500` instead of design system color.

**Prevention:**
- Add new colors to `components.json` Tailwind config FIRST
- Use only named colors from config in components
- Enforce with lint rule: no hardcoded hex values in JSX

---

### Pitfall 11: Loading States and Skeleton Screens

**What goes wrong:**
New insights page takes 1.5s to load (new query complexity). No skeleton → UI appears frozen.

**Prevention:**
- Add skeleton loaders for all new components (summary cards, question list, stacked bars)
- Use Framer Motion shimmer or Radix UI skeleton

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Phase 1: Summary cards + confidence callouts | Confidence display reframing (abstract-only edge cases) | Test with abstract-only job first |
| Phase 1: i18n strings | Missing translations in 5 locales | Add translations BEFORE components |
| Phase 2: Bar scaling | Zero-value and dominance edge cases | Test edge cases on insights.ts first |
| Phase 2: Stacked horizontal bars | Color legend accessibility | Inline labels + aria attributes |
| Phase 2: Question list progress bars | Percentage calculation edge cases (0/0 → NaN) | Define rounding behavior in code |
| Phase 3: Semantic grouping (answer variants) | False positives (over-merging) vs false negatives (missed duplicates) | Multi-stage funnel; expandable variants |
| Phase 3: extractionJobStats schema changes | Backfill complexity, index mismatch | Optional computed fields, lazy backfill |
| Throughout: Test regression | Snapshot brittleness on 884-test suite | Refactor to structural tests, avoid snapshots |

---

## Testing Strategy

### Unit Tests (existing confidence)
- `lib/extraction/insights.ts` → pure functions, edge cases, normalization
- Expand existing `tests/extraction-insights.test.ts` with:
  - Bar scaling edge cases (0/0, 100/101, 1/1000)
  - Confidence display contexts (abstract-only, no PDF, grounded)
  - Semantic grouping precision (false positives, stoplist coverage)

### Integration Tests (new)
- Extract job → save results → stats aggregation → query returns correct aggregate
- i18n: render with each locale, verify no missing keys
- URL state sync: apply filter via URL → Zustand reads it → component renders correct data

### Playwright E2E (selective)
- Extract 5-paper job → view insights → select question → verify bars scale correctly
- Abstract-only job → verify confidence callout says "abstract only"
- No PDFs → verify UI shows "no content available"

---

## Sources

- [7 Pitfalls to Avoid in Application Refactoring Projects](https://vfunction.com/blog/7-pitfalls-to-avoid-in-application-refactoring-projects/)
- [Data Visualization Pitfalls: Decoration Trap and Clutter](https://www.techment.com/blogs/data-visualization-best-practices-enterprise/)
- [Semantic Deduplication and False Positive Tradeoffs](https://futuresearch.ai/semantic-deduplication/)
- [NLP Duplicate Detection: Setting Similarity Thresholds](https://www.tesserblu.com/post/reducing-false-positives-in-literature-screening-using-nlp)
- [Chart Scaling Best Practices (Zero Baseline)](https://clauswilke.com/dataviz/proportional-ink.html)
- [6 Tips for Understanding and Designing Chart Scales](https://www.quanthub.com/understanding-and-designing-chart-scales/)
- [Handling Chart Edge Cases (Zero Values, Single Values)](https://docs.anychart.com/Axes_and_Grids/Scales)
- [i18n Retrofitting Cost: 3–5x More Expensive Than Upfront](https://www.locize.com/blog/what-is-i18n/)
- [i18n Refactoring Pitfalls in Existing Applications](https://www.smartling.com/blog/i18n)
- [Regression Testing with UI Refactoring](https://katalon.com/resources-center/blog/regression-test-strategy)
- [Visual Regression Testing Best Practices](https://medium.com/@ss-tech/the-ui-visual-regression-testing-best-practices-playbook-dc27db61ebe0)
- [Database Refactoring: Expand-and-Contract Pattern](https://medium.com/@jasminfluri/expand-and-contract-method-for-database-changes-414d236f236f)
- [Incremental Models and Schema Change Handling](https://docs.getdbt.com/docs/build/incremental-models)
- [Zustand State Management: Pitfalls and Patterns](https://tkdodo.eu/blog/zustand-and-react-context)
- [React State Management: Context Loss with Zustand](https://www.developerway.com/posts/react-state-management-2025)
