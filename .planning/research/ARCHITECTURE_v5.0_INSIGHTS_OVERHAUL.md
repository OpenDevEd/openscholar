# Architecture: Extraction Insights Overhaul (v5.0)

**Domain:** Academic extraction insights dashboard (data visualization + semantic grouping)
**Researched:** 2026-03-10
**Scope:** 6 features integrating into existing insights page

## Current Extraction Insights Architecture

The extraction job detail page (`app/extraction/[jobId]/page.tsx`) is a **multi-tab React component** using:

- **Layout:** TwoColumnLayout (left: filters/pagination, right: main content area)
- **Tabs:** "results" | "insights" | "review" | "report" | "overview"
- **Insights tab components:**
  - `InsightsOverview` (summary cards + question list)
  - `InsightsQuestionPanel` (detailed question breakdown + disagreement finder)
- **Data source:** Two Convex queries
  - `getJobInsights` — job-level summary + per-question aggregates
  - `getQuestionInsights` — detailed per-question stats (confidence, citations)
  - `getQuestionDisagreements` — semantic clustering of answer variants

### Component Hierarchy

```
JobDetailPage (page.tsx)
├── activeTab = "insights"
├── InsightsOverview
│   ├── Summary cards (answered%, grounded%, bestEffort%, noContent count)
│   ├── No-content diagnostics
│   └── Question list (clickable, shows badges with stats)
│       └── Button: onSelectQuestion(questionKey)
└── InsightsQuestionPanel
    ├── Question header with stats badges
    ├── Confidence distribution (Bar chart)
    ├── Citation status mix (Bar chart)
    ├── Answer distribution or entity distribution (Bar list)
    ├── View mode toggle (entities/raw for array questions)
    └── DisagreementList (shows disagreement clusters)
```

### Data Flow

```
getJobInsights query
├── LoadJobPapersAndResults (loads papers + results + reviews)
├── Per-question aggregation (lib/extraction/insights.ts)
│   └── aggregateQuestionInsights()
├── Returns:
│   ├── summary { answeredRate, groundedRate, bestEffortRate, averageConfidence, ... }
│   └── questions[] { key, question, type, answered, grounded, avgConfidence,
│                     confidenceBuckets, citationStatusMix, topAnswers, ... }
│
getQuestionInsights query
├── Load all results for specific question across all papers
├── aggregateQuestionInsights() + buildDisagreementClusters()
└── Returns detailed per-question breakdown

getQuestionDisagreements query
├── buildDisagreementClusters() or buildArrayAnswerProfileClusters()
└── Returns semantic variant clusters with examples
```

## Feature Integration Points

### Feature 1: Bar Scaling (Max-Relative)

**Current behavior:** Bars scale relative to total answers (visible at 2-4%)
**Desired behavior:** Scale relative to max answer count (makes small values visible)

**Integration:**
- **Component:** `InsightsQuestionPanel` (3 locations: confidence buckets, citation status, answer distribution)
- **Current code:**
  ```typescript
  <Bar value={count / total} />  // total = all answers
  ```
- **Modification:** Change to `value={count / maxCount}`
- **Data required:** Max value per section (already computed in aggregation)
- **New logic needed:** Calculate `maxCount` in aggregation functions

**Files to modify:**
- `/lib/extraction/insights.ts` — add `maxCount` fields to aggregation types
- `components/extraction/insights-question-panel.tsx` — update Bar component logic

**Query impact:** NONE (aggregation already has counts)

---

### Feature 2: Summary Cards Reframing

**Current cards:** Answered%, Grounded%, Best Effort%, No-Content count
**Desired changes:**
- Reorder cards (e.g., No-Content first for importance)
- Add color accents (blue/green/amber per metric)
- Add contextual tooltips explaining what each means

**Integration:**
- **Component:** `InsightsOverview` (summary card grid, lines 66-83)
- **Current code:**
  ```typescript
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {/* 4 static card definitions */}
  </div>
  ```
- **Modification:**
  - Extract card definitions into data structure
  - Add `color`, `description`, `tooltip` fields
  - Reorder array
  - Map over array with Badge + Tooltip components

**Query impact:** NONE (data structure already available)

---

### Feature 3: Confidence Display Contextual Callout

**Current UI:** "Effective Conf" badge with raw % (confusing)
**Desired behavior:**
- Replace confusing "effective confidence" label
- Contextual explanation: "Avg confidence adjusted for grounding"
- Show raw confidence separately when different from effective

**Integration:**
- **Component:** `InsightsQuestionPanel` (lines 122-134)
- **Current code:**
  ```typescript
  <Badge variant="secondary"
    title={t("rawConfidenceTooltip", {...})}
  >
    {Math.round((questionInsights.avgEffectiveConfidence ?? questionInsights.avgConfidence) * 100)}%
    {t("effectiveConf")}
  </Badge>
  ```
- **Modification:**
  - New helper component `ConfidenceDisplay` or inline callout
  - Show both raw + effective with explanation
  - Add Info icon with Tooltip

**Query impact:** NONE (both `avgConfidence` and `avgEffectiveConfidence` already returned)

---

### Feature 4: Question List with Progress Bars

**Current UI:** Question list with badges showing answered/grounded/avgConf
**Desired behavior:**
- Add status dot (grey/yellow/green) indicating completion
- Add mini progress bar showing answer % visually
- Maintain existing click-to-select interaction

**Integration:**
- **Component:** `InsightsOverview` question list (lines 114-137)
- **Current code:**
  ```typescript
  {questions.map((question) => (
    <button key={question.key} ...>
      <div className="flex ... justify-between">
        <div>{question.question}</div>
        <div className="flex ... gap-2">
          <Badge>% answered</Badge>
          <Badge>% grounded</Badge>
          <Badge>% confidence</Badge>
        </div>
      </div>
    </button>
  ))}
  ```
- **Modification:**
  - Extract into new `QuestionListItem` sub-component
  - Add status dot (before question text)
  - Add horizontal progress bar (after question text, before badges)
  - Progress bar width = answeredRate

**Query impact:** NONE (all data available)

---

### Feature 5: Stacked Horizontal Bars for Distributions

**Current UI:** Separate bars for each confidence bucket (4 bars) and citation status (4 bars)
**Desired behavior:**
- Single horizontal bar with stacked segments (grounded vs best_effort vs insufficient vs error)
- Color-coded segments (green/amber/grey/red)
- Hover tooltip showing segment percentages

**Integration:**
- **Component:** `InsightsQuestionPanel` citation status mix section (lines 163-192)
- **Current code:**
  ```typescript
  {["grounded", "best_effort", ...].map((status) => (
    <div>
      <Bar value={count / total} />
    </div>
  ))}
  ```
- **Modification:**
  - Create new `StackedHorizontalBar` component
  - Input: `{ grounded: 150, best_effort: 50, insufficient: 20, error: 5, total: 225 }`
  - Output: Single bar with 4 color-coded segments
  - Maintain existing confidence buckets as separate bars (or also stack?)

**Files needed:**
- New: `components/extraction/stacked-horizontal-bar.tsx`
- Update: `components/extraction/insights-question-panel.tsx` (use new component)

**Query impact:** NONE (data already aggregated)

---

### Feature 6: Answer Semantic Grouping (Merge + Expand)

**Current behavior:** `buildDisagreementClusters()` groups answers by normalized form
**Desired behavior:**
- Show merged cluster (synonyms combined under primary)
- Expandable to show variants
- Examples collapse/expand with visual indicator

**Integration:**
- **Component:** `InsightsQuestionPanel` answer distribution section (lines 195-267)
- **Sub-component involved:** `DisagreementList` (shows clusters already)
- **Current code:**
  - Uses `questionInsights.topAnswers` (top 10 by count)
  - Uses `disagreementData.clusters` from `getQuestionDisagreements`
- **Modification:**
  - Create `AnswerClusterGroup` sub-component
  - Show primary answer (highest count variant)
  - Show "(+2 variants)" badge if multiple
  - Expandable section reveals other variants with counts
  - Reuse `DisagreementList` logic for cluster expansion

**Files needed:**
- New: `components/extraction/answer-cluster-group.tsx`
- Update: `components/extraction/insights-question-panel.tsx` (wrap answer list in new component)

**Query impact:**
- NONE for raw aggregation (already have `topAnswers`)
- BUT: May want to enhance `getQuestionDisagreements` to include variant counts for display

---

## New Components Needed

| Component | Purpose | Dependencies | Props |
|-----------|---------|--------------|-------|
| `StackedHorizontalBar.tsx` | Render citation status as single stacked bar | shadcn/Badge, tailwind | `segments: {grounded, best_effort, ...}`, `total: number`, `color: string` |
| `AnswerClusterGroup.tsx` | Render answer with expandable variants | shadcn/Button, ChevronDown | `cluster: DisagreementCluster`, `isExpanded: boolean`, `onToggle: ()=>void` |
| `QuestionListItem.tsx` | Render question row with progress bar | shadcn/Badge, lucide-react | `question: QuestionInsight`, `isSelected: boolean`, `onClick: ()=>void` |
| `ConfidenceDisplay.tsx` | Render confidence with contextual explanation | shadcn/Tooltip, Info icon | `rawConfidence: number`, `effectiveConfidence: number`, `citationStatus?: string` |

---

## Modified Components

| Component | Changes | Impact |
|-----------|---------|--------|
| `insights-overview.tsx` | Extract card definitions to array; reorder; add colors. Extract question list to `QuestionListItem` sub-component | LOW — structural refactoring only |
| `insights-question-panel.tsx` | Replace Bar components; add ConfidenceDisplay; replace citation status with StackedHorizontalBar; wrap answer list in AnswerClusterGroup | MEDIUM — component nesting changes |
| `lib/extraction/insights.ts` | Add `maxCount` fields to aggregation return types | LOW — additive, backward compatible |

---

## Data Flow Changes

### Summary: Minimal Backend Modifications Required

**No new queries needed.** All 6 features work with existing aggregated data:

```
Existing Query                Data Available
─────────────────────────────────────────────────────
getJobInsights                summary, questions[]
  ├─ summary.answeredRate     ✓ answers/total
  ├─ summary.groundedRate     ✓ grounded/total
  ├─ summary.bestEffortRate   ✓ bestEffort/total
  ├─ questions[].topAnswers   ✓ answer counts
  └─ questions[].type         ✓ for array/scalar detection

getQuestionInsights           question detail
  ├─ confidenceBuckets        ✓ {high, medium, low, unknown}
  ├─ citationStatusMix        ✓ {grounded, best_effort, insufficient, error}
  ├─ topAnswers               ✓ for distribution (already top 10)
  └─ entityDistribution       ✓ for array questions

getQuestionDisagreements      disagreement clusters
  ├─ clusters                 ✓ normalized groups with variants
  └─ examples                 ✓ 5 top examples per cluster
```

### Optional Enhancement: Max Count Caching

**Optimization opportunity** (NOT required for MVP):
- Add `maxCount` fields to aggregation types in `lib/extraction/insights.ts`
- Compute in Convex for one-time calculation (avoid recalc on client)
- Example:
  ```typescript
  // In aggregateQuestionInsights return:
  const maxAnswerCount = Math.max(...topAnswers.map(a => a.count), 1);
  const maxConfidenceBucketCount = Math.max(...Object.values(confidenceBuckets));
  return { ..., maxAnswerCount, maxConfidenceBucketCount }
  ```

---

## Build Order (Dependency Graph)

```
1. StackedHorizontalBar component (no deps)
   └─> InsightsQuestionPanel uses it

2. ConfidenceDisplay component (no deps)
   └─> InsightsQuestionPanel uses it

3. QuestionListItem component (no deps)
   └─> InsightsOverview uses it

4. AnswerClusterGroup component (uses DisagreementList logic)
   └─> InsightsQuestionPanel uses it

5. Update InsightsQuestionPanel
   ├─ Add StackedHorizontalBar for citation status
   ├─ Add ConfidenceDisplay
   ├─ Wrap answers in AnswerClusterGroup
   └─ Update Bar scaling (max-relative)

6. Update InsightsOverview
   ├─ Reframe summary cards (reorder, colors)
   ├─ Replace question list with QuestionListItem
   └─ Add progress bars to questions

7. Update lib/extraction/insights.ts
   ├─ Add maxCount fields to aggregation types
   └─ Compute max values in aggregation functions

8. (Optional) Add i18n translations for new labels
   └─ "adjustedForGrounding", "maxRelative", "variantCount", etc.
```

### Build Rationale

- **Phases 1-4 (new components):** Build in isolation with static props, no data dependency
- **Phase 5-6 (integration):** Wire into existing components, pass real data
- **Phase 7 (types):** Update aggregation types for max-relative scaling
- **Phase 8 (i18n):** Polish translations last

---

## Architecture Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| No new queries | All features fit existing aggregated data | ✓ Simpler, faster implementation |
| Max-relative bars in client | Avoid recomputing max per scroll/filter | ✓ Fast, responsive UX |
| Stacked bar as new component | Reusable for future distribution displays | ✓ DRY, testable |
| Answer cluster expand/collapse state in component | Avoid global state bloat | ✓ Local state sufficient |
| Merge variant grouping in UI only | Don't change aggregation logic | ✓ Backward compatible |

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Recomputing Aggregates on Client
**What goes wrong:** Max values recalculated on every render
**Why it happens:** Tempting to do `Math.max(...answers.map(a => a.count))` inline
**Prevention:** Compute once in aggregation, cache in component or return from query

### Anti-Pattern 2: Infinite Expand/Collapse States
**What goes wrong:** Answer cluster state stored globally, interferes with filters
**Why it happens:** Copied pattern from review queue
**Prevention:** Keep expand state local to component (useState per cluster)

### Anti-Pattern 3: Stacked Bar Visual Complexity
**What goes wrong:** Too many colors, labels overlap, mobile unreadable
**Why it happens:** Trying to show all 4 statuses + percentages + legend
**Prevention:** Limit to 3 visible segments, hide < 2%, hover tooltip for details

---

## Integration Checklist

### Before Starting
- [ ] Read all 6 features from milestone context
- [ ] Understand aggregation functions in `lib/extraction/insights.ts`
- [ ] Verify current component nesting in `page.tsx` and insights components
- [ ] Check i18n keys for existing labels (confidence, grounding, etc.)

### Component Development
- [ ] StackedHorizontalBar tested with sample data
- [ ] ConfidenceDisplay displays both raw + effective clearly
- [ ] QuestionListItem progress bar aligns with list item height
- [ ] AnswerClusterGroup expand/collapse works without global state
- [ ] Bar scaling math verified: `count / maxCount` (not `count / total`)

### Integration Testing
- [ ] InsightsQuestionPanel renders with all 4 changes (stacked bar, confidence, clusters, max scaling)
- [ ] InsightsOverview shows reordered cards with colors
- [ ] Question list items have progress bars + status dots
- [ ] Mobile responsive: cards stack, bars don't overflow
- [ ] All 6 locales have translations for new labels

### Performance
- [ ] No extra queries (verify network tab)
- [ ] Bar scaling doesn't cause re-renders (compare before/after flame graph)
- [ ] Expand/collapse is instant (no loading)

---

## Known Constraints

- **Existing styling:** shadcn/ui + Tailwind CSS (maintain consistency)
- **State management:** Zustand for global, useState for local (existing pattern)
- **i18n:** next-intl 6 locales (all labels must be translated)
- **Responsive:** Mobile-first with tablet/desktop breakpoints
- **Accessibility:** WCAG 2.1 AA (color contrast, keyboard nav, tooltips)

---

## Summary

**Integration type:** UI-only, no backend changes
**New components:** 4 (StackedHorizontalBar, ConfidenceDisplay, QuestionListItem, AnswerClusterGroup)
**Modified components:** 3 (InsightsOverview, InsightsQuestionPanel, insights.ts types)
**Queries unchanged:** getJobInsights, getQuestionInsights, getQuestionDisagreements
**Build phases:** 8 (component → integration → types → i18n)
**Risk:** LOW (self-contained UI changes, extensive existing test coverage for aggregation logic)
