# Integration Summary: Extraction Insights v5.0 Overhaul

**Milestone:** v5.0 Extraction Insights Overhaul
**Date:** 2026-03-10
**Downstream Consumer:** Roadmap & Phase Planning

## Quick Answer

**How do these 6 features integrate?** Entirely through UI refactoring. Zero backend changes needed. All data already exists in existing queries.

**New Components:** 4
**Modified Components:** 3
**New Queries:** 0
**Build Phases:** 8 (component construction → integration → types)

---

## Feature → Integration Mapping

| Feature | Where It Lives | Type | Effort | Query Impact |
|---------|----------------|------|--------|--------------|
| **1. Bar Scaling (max-relative)** | `InsightsQuestionPanel` (3 locations) | Logic refactor | Low | NONE |
| **2. Summary Cards Reframing** | `InsightsOverview` (card grid) | Data restructure | Low | NONE |
| **3. Confidence Display Callout** | `InsightsQuestionPanel` (header) | New component | Low | NONE |
| **4. Question List Progress Bars** | `InsightsOverview` (question list) | Sub-component | Medium | NONE |
| **5. Stacked Horizontal Bars** | `InsightsQuestionPanel` (citation status) | New component | Medium | NONE |
| **6. Answer Semantic Grouping** | `InsightsQuestionPanel` (answer list) | New component | Medium | NONE |

---

## Component Architecture

### New Components Required

```
components/extraction/
├── stacked-horizontal-bar.tsx        ← Render 4-segment bar (grounded/best_effort/insufficient/error)
├── confidence-display.tsx             ← Show raw vs effective confidence with tooltip
├── question-list-item.tsx             ← Question row + progress bar + status dot
└── answer-cluster-group.tsx           ← Expandable answer variant grouping
```

### Modified Components

```
components/extraction/
├── insights-overview.tsx              ← Refactor cards array + use QuestionListItem
├── insights-question-panel.tsx        ← 4 integration points (see below)
└── lib/extraction/insights.ts         ← Add maxCount fields (additive change)
```

### Integration Points in `insights-question-panel.tsx`

```typescript
// 1. Import new components at top
import { StackedHorizontalBar } from "./stacked-horizontal-bar";
import { ConfidenceDisplay } from "./confidence-display";
import { AnswerClusterGroup } from "./answer-cluster-group";

// 2. Update Bar scaling (lines 156, 187, 262)
- <Bar value={count / total} />
+ <Bar value={count / maxCount} />  // maxCount from aggregation

// 3. Replace confidence badge section (lines 122-134)
- <Badge variant="secondary">{Math.round(...)}% {t("effectiveConf")}</Badge>
+ <ConfidenceDisplay
+   rawConfidence={questionInsights.avgConfidence}
+   effectiveConfidence={questionInsights.avgEffectiveConfidence}
+ />

// 4. Replace citation status bars (lines 163-192)
- {["grounded", "best_effort", ...].map((status) => (
-   <Bar value={count / total} />
- ))}
+ <StackedHorizontalBar
+   segments={questionInsights.citationStatusMix}
+   total={total}
+ />

// 5. Wrap answer distribution (lines 195-267)
- {rawAnswerDistribution.map((answer) => (
-   <div key={answer.normalized}>...</div>
- ))}
+ {rawAnswerDistribution.map((answer) => (
+   <AnswerClusterGroup key={answer.normalized} answer={answer} />
+ ))}
```

### Integration Points in `insights-overview.tsx`

```typescript
// 1. Extract summary cards to array (lines 66-83)
const summaryCards = [
  {
    key: "noContent",
    label: tc("noContentPapers"),
    value: summary.noContentCount,
    color: "bg-red-50",
    description: "Papers with no usable PDF or abstract"
  },
  {
    key: "answered",
    label: tc("answered"),
    value: `${pct(summary.answeredRate)}`,
    color: "bg-blue-50",
    description: "Percentage of expected answers provided"
  },
  // ... 2 more cards
];

return (
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {summaryCards.map(card => (
      <Tooltip title={card.description}>
        <div className={`${card.color} ...`}>
          {/* render card */}
        </div>
      </Tooltip>
    ))}
  </div>
);

// 2. Replace question list with sub-component (lines 114-137)
- {questions.map((question) => (
-   <button key={question.key} className={...}>
-     <div>{question.question}</div>
-     <div><Badge>...</Badge>...</div>
-   </button>
- ))}
+ {questions.map((question) => (
+   <QuestionListItem
+     key={question.key}
+     question={question}
+     isSelected={selectedQuestionKey === question.key}
+     onClick={() => onSelectQuestion(question.key)}
+   />
+ ))}
```

---

## Data Flow (Unchanged)

```
getJobInsights query
└─> InsightsOverview uses: summary.*, questions[]
    ├─ summary.answeredRate (Feature 2: card color)
    ├─ summary.groundedRate (Feature 2: card color)
    ├─ questions[].answered (Feature 4: progress bar)
    └─ questions[].total (Feature 4: progress width)

getQuestionInsights query
└─> InsightsQuestionPanel uses:
    ├─ questionInsights.avgConfidence (Feature 3: raw value)
    ├─ questionInsights.avgEffectiveConfidence (Feature 3: adjusted value)
    ├─ questionInsights.confidenceBuckets (Feature 1: max scaling)
    ├─ questionInsights.citationStatusMix (Feature 5: stacked bar)
    └─ questionInsights.topAnswers (Feature 6: semantic grouping)

getQuestionDisagreements query
└─> Used by AnswerClusterGroup for variant expansion
    ├─ clusters (Feature 6: merge variants)
    └─ examples (Feature 6: show top variants)
```

**Key point:** All data is already provided by existing queries. No new query parameters or return types needed. Optional enhancement: compute `maxCount` in backend aggregation.

---

## Build Order & Dependencies

### Phase 1-4: Component Construction (NO dependencies)

```
┌─ StackedHorizontalBar.tsx
│  └─ Input: { grounded, best_effort, insufficient, error, total }
│     Output: Stacked colored bar
│     Tests: Sample data with known distributions
│
├─ ConfidenceDisplay.tsx
│  └─ Input: { rawConfidence, effectiveConfidence }
│     Output: Labeled badge + tooltip
│     Tests: Various confidence values and differences
│
├─ QuestionListItem.tsx
│  └─ Input: { question, isSelected, onClick }
│     Output: Row with progress bar + status dot
│     Tests: Different answer rates, selected states
│
└─ AnswerClusterGroup.tsx
   └─ Input: { answer, isExpanded, onToggle }
      Output: Expandable cluster with variants
      Tests: Cluster state management
```

### Phase 5: InsightsQuestionPanel Integration

1. Add StackedHorizontalBar for citation status (replace 4 separate bars)
2. Add ConfidenceDisplay for confidence header
3. Add Bar max-relative scaling in 3 places
4. Wrap answer distribution with AnswerClusterGroup

**Depends on:** Phase 1-4 components, existing aggregation data

### Phase 6: InsightsOverview Integration

1. Extract summary cards to array with colors/descriptions
2. Replace question list with QuestionListItem components

**Depends on:** Phase 3 component, existing aggregation data

### Phase 7: Backend Types (Optional)

1. Add `maxCount` fields to aggregation return types in `lib/extraction/insights.ts`
2. Compute max values in `aggregateQuestionInsights()`
3. Return computed max from Convex query

**Depends on:** Phase 1-6 complete (can work with client-side max calculation first)

### Phase 8: Internationalization

1. Add new i18n keys for component labels
2. Translate across 6 locales (en, es, fr, de, it, pt)

**Depends on:** Phase 1-7 complete

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Styling inconsistency (new components vs existing) | LOW | Use shadcn/ui components consistently, reuse Tailwind utilities |
| State management complexity (expand/collapse) | LOW | Keep state local to components (useState), avoid Zustand |
| Responsive design breakage | MEDIUM | Test on mobile/tablet; use existing grid/responsive patterns |
| i18n coverage gaps | LOW | Use existing translation keys where possible; create minimal new keys |
| Performance regression from max calculation | LOW | Calculate once in phase 7; use client-side before backend impl |
| Breaking changes to aggregation types | NONE | Phase 7 is additive (new fields), backward compatible |

---

## Testing Strategy

### Unit Tests (New Components)
- `stacked-horizontal-bar.test.ts`: Render various segment distributions
- `confidence-display.test.ts`: Display raw/effective, with/without differences
- `question-list-item.test.ts`: Progress bar width, status dot color
- `answer-cluster-group.test.ts`: Expand/collapse state, variant display

### Integration Tests (Modified Components)
- `insights-overview.test.ts`: Summary cards order/colors, QuestionListItem rendering
- `insights-question-panel.test.ts`: StackedHorizontalBar + ConfidenceDisplay + AnswerClusterGroup wiring
- `insights.test.ts`: Max-relative bar scaling math

### E2E Tests (Manual for now)
- Navigate extraction job → insights tab
- Verify all 6 features render correctly
- Test on mobile/tablet responsive breakpoints
- Test all 6 locales for i18n

---

## Rollout Plan

### Phase 1-2: Foundation (Days 1-2)
- StackedHorizontalBar + ConfidenceDisplay components
- Unit tests
- No UI changes yet

### Phase 3-4: Interaction (Days 3-4)
- QuestionListItem + AnswerClusterGroup components
- Unit tests for state management
- Still no UI changes

### Phase 5: Question Panel Integration (Days 5-7)
- Wire phase 1-2 components into InsightsQuestionPanel
- Update Bar scaling
- Test with real data

### Phase 6: Overview Integration (Days 8-9)
- Wire phase 3-4 into InsightsOverview
- Reframe cards, reorder
- End-to-end functional testing

### Phase 7: Backend Optimization (Days 10-11)
- Optional: Add maxCount to backend
- Test performance

### Phase 8: Localization (Days 12)
- Add i18n keys
- Translate 6 locales
- Final QA

**Total estimated effort:** 12 days (1 engineer, test-first)

---

## Success Criteria

### Feature Completeness
- [ ] Feature 1 (bar scaling): All bars scale 0-100% based on max, not total
- [ ] Feature 2 (card reframing): Cards reordered, colors applied, tooltips present
- [ ] Feature 3 (confidence display): Both raw and effective shown; tooltip explains difference
- [ ] Feature 4 (progress bars): Question list has progress bar + status dot
- [ ] Feature 5 (stacked bars): Citation status shown as single stacked bar, not 4 separate
- [ ] Feature 6 (semantic grouping): Answers group by normalized form; variants expandable

### Code Quality
- [ ] All new components tested (>90% coverage)
- [ ] No TypeScript errors (`tsc --noEmit` clean)
- [ ] No `any` types in new code
- [ ] Follows existing pattern library (shadcn/ui, Tailwind)
- [ ] Backward compatible with existing queries

### User Experience
- [ ] Mobile responsive (all breakpoints)
- [ ] All 6 locales have translations
- [ ] Accessibility: WCAG 2.1 AA (color contrast, keyboard nav)
- [ ] No performance regression (same query count, faster render)

---

## File Manifest

### New Files
```
components/extraction/stacked-horizontal-bar.tsx       (100 LOC)
components/extraction/stacked-horizontal-bar.test.ts   (80 LOC)
components/extraction/confidence-display.tsx            (80 LOC)
components/extraction/confidence-display.test.ts        (60 LOC)
components/extraction/question-list-item.tsx            (120 LOC)
components/extraction/question-list-item.test.ts        (100 LOC)
components/extraction/answer-cluster-group.tsx          (150 LOC)
components/extraction/answer-cluster-group.test.ts      (120 LOC)
```

### Modified Files
```
components/extraction/insights-overview.tsx             (~80 LOC change)
components/extraction/insights-question-panel.tsx       (~150 LOC change)
lib/extraction/insights.ts                              (~30 LOC change — types only)
messages/*.json (i18n)                                  (6 locale files, ~10 keys each)
```

**Total new production code:** ~450 LOC
**Total new test code:** ~360 LOC
**Total modifications:** ~260 LOC

---

## Backward Compatibility

✓ No breaking changes to existing queries
✓ Aggregation types are backward compatible (new fields optional)
✓ Existing components still work if features not fully integrated (phase-by-phase safe)
✓ No schema changes or migrations needed
✓ Zero data loss or corruption risk

---

## Known Gaps & Future Work

1. **Performance optimization:** Currently Bar component re-renders on every data change. Could memoize with `React.memo` or CSS-based scaling.

2. **Accessibility enhancements:** Focus management on expand/collapse, keyboard nav for answer clusters.

3. **Animation polishing:** Could add Framer Motion transitions to stacked bar segments and cluster expansion (following existing pattern in codebase).

4. **Mobile optimization:** Sidebar-style answer cluster list on mobile might be cleaner than inline expandable.

5. **Variant count threshold:** Currently all answer variants shown. Could add limit (e.g., "Show 10 more") for very large distributions.

---

## Related Documents

- **ARCHITECTURE_v5.0_INSIGHTS_OVERHAUL.md** — Detailed technical architecture
- **PROJECT.md** — Project context and requirements
- **lib/extraction/insights.ts** — Source code for aggregation functions
- **components/extraction/insights-overview.tsx** — Current component code
- **components/extraction/insights-question-panel.tsx** — Current component code

