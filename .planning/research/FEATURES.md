# Extraction Insights UI — Feature Research

**Domain:** Data visualization and analytics UI for AI extraction results
**Researched:** 2026-03-10
**Confidence:** MEDIUM (industry patterns verified, context-specific tradeoffs need validation with actual data)

## Feature Landscape

### Table Stakes (Users Expect These)

Features essential for credible data visualization in analytics UIs. Missing these = product feels broken or misleading.

| Feature | Why Expected | Complexity | Existing Support | Notes |
|---------|--------------|-----------|------------------|-------|
| **Bar scaling relative to max** | Users expect bars to fill container proportionally; 2–4% invisible bars are unreadable and break scanning | LOW | Partial — bars exist but scale to total, not max | Zero-baseline bar charts are standard in analytics; industry best practice starts axis at zero for accurate visual comparison |
| **Summary metric cards** | Users scan numeric summaries first; missing = no quick answer | LOW | Yes — summary cards exist | Color accents on cards reduce cognitive load; 60-30-10 color principle for accent placement |
| **Confidence display (contextual callout)** | Extraction quality is ambiguous; users need transparent signal of trustworthiness | MEDIUM | Partial — "effective conf" tooltip exists but confusing | Replaces confusing dual-display (raw + effective) with single, contextual indicator; color-coded (green ≥85%, yellow 60–84%, red <60%) per current UI patterns |
| **Question/item lists with status + mini progress** | Users track which questions are done; missing = no sense of completion | MEDIUM | Partial — list exists, no status indicators | Status dots + progress mini-bar per item reduce clicks and improve scannability; icon indicators (checkmark/question mark) standard in modern UIs |
| **Stacked horizontal bars for category distribution** | Showing part-to-whole relationships (e.g., answers per question); required for categorical comparisons | MEDIUM | No — currently answer bars are unscaled vertical distribution | Horizontal layout preferred when categories have long labels; excellent for ranking/comparing across many questions |
| **Semantic answer grouping with drill-down** | Duplicate answers (synonyms, case variants, whitespace) appear as separate rows; users can't see true distribution | HIGH | No — basic lowercase/whitespace normalization only | Expandable accordion pattern; nested categories enable progressive disclosure; required for accurate aggregation |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable for extraction insights.

| Feature | Value Proposition | Complexity | Existing Support | Notes |
|---------|-------------------|-----------|------------------|-------|
| **Semantic grouping with edit/ungroup actions** | Allow users to merge/unmerge synonyms interactively on the fly | HIGH | No | Goes beyond standard analytics; enables correction without re-running extraction |
| **Confidence thresholds with filtering** | Hide low-confidence answers, show only confident extractions | MEDIUM | No — confidence display exists but no filtering | Lets users validate quality before exporting; differs from standard "display only" approach |
| **Answer variant visualization (inline)** | Show grouped variants next to main answer in expandable detail | MEDIUM | No — would require accordions or popovers | Standard semantic drilldown pattern applied to answer variants |
| **Progress by question type** | Segment progress by question category (MCQ vs text vs numeric) | MEDIUM | No | Adds dimension to progress view; requires question metadata |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems for this specific context.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Automatic synonym merging (AI-based)** | "Group answers automatically instead of showing variants" | Adds extraction re-dependency; risk of over-merging (false positives); breaks user trust if grouping is wrong | Manual grouping with UI helpers; provide high-confidence suggestions but let user decide |
| **Real-time progress updates (WebSocket)** | "Show progress as extraction runs" | Extraction jobs are async/background; adds server complexity; polling/manual refresh sufficient for user patience window | Simple "refresh" button; lazy-load stats on page open; user initiates updates |
| **Custom confidence formula (user-configurable)** | "Let users adjust confidence calculation" | Extraction confidence is model-dependent; custom formulas create support burden; different models have different confidence ranges | Provide **raw vs effective confidence** with clear tooltip; accept feedback for model tuning, not per-user customization |
| **Multi-select filtering across dimensions** | "Filter by confidence AND answer AND question" | Combinatorial explosion of filters; extraction insights are typically single-job view; users don't need AND logic | Single dimension filters (confidence threshold) sufficient; full AND/OR logic deferred to future analytics layer |

## Feature Dependencies

```
Bar scaling (readability)
    └──requires──> Answer distribution data (already have)
                       └──requires──> Question metrics (already have)

Summary metric cards (overview)
    ├──independent──> Bar scaling (both display concerns)
    └──enhanced by──> Confidence contextual callout (quality signal)

Confidence contextual callout (trust)
    └──requires──> Confidence calculation (already have; ABSTRACT_ONLY_CONFIDENCE_CAP = 0.7)
                       └──enhanced by──> Tooltip with raw confidence explanation

Question/item list with status + mini progress (tracking)
    ├──requires──> Per-question completion metrics (requires aggregation)
    └──enhanced by──> Stacked bars (visual confirmation)

Stacked horizontal bars (distribution visualization)
    ├──requires──> Category grouping per question (need to define "category" — confidence, answer type, etc.)
    └──requires──> Answer counts per category (requires aggregation)

Semantic answer grouping + drill-down (data quality)
    ├──requires──> Synonym detection/suggestion (phrase similarity, Levenshtein distance, model-based)
    ├──requires──> User merge/ungroup mutations (backend support needed)
    └──enables──> Accurate stacked bar visualization (can't show true distribution without grouping)
    └──enables──> Confidence grouping (answers grouped → can aggregate confidence per group)
```

### Dependency Notes

- **Bar scaling + Summary cards:** Both display-only; no backend changes needed.
- **Confidence callout depends on existing calculation:** Reframe existing "effective conf" data; no new backend work.
- **Question/item lists require aggregation:** Need per-question completion counts; likely need new query or mutation.
- **Stacked bars require answer grouping:** Can't show meaningful distribution without first merging synonyms.
- **Semantic grouping is blocking:** Without this, all other visualization features are either incomplete (can't aggregate accurately) or misleading (synonyms count as separate answers).

## Complexity Breakdown

### LOW complexity (no new queries/backend changes)
1. **Bar scaling:** CSS/math-only; scale bars to max value instead of total width
2. **Summary cards:** Reorder/reframe existing data; add color accents
3. **Confidence callout:** Replace tooltip text; add color coding (green/yellow/red)

### MEDIUM complexity (new queries or aggregation)
4. **Question/item list with status + mini progress:** New per-question aggregation; requires query or computed field
5. **Stacked horizontal bars:** Requires answer grouping first (see HIGH below); then group-by aggregation

### HIGH complexity (new backend features)
6. **Semantic answer grouping + drill-down:** Synonym detection algorithm; user mutations for merge/ungroup; display component

## MVP Definition

### Prioritized for v5.0 (Extraction Insights Overhaul)

All 6 features are in scope per milestone brief; prioritize by dependency order:

1. **Phase 1: Foundation (display fixes)**
   - [ ] Bar scaling relative to max (LOW complexity, unblocks visualization)
   - [ ] Summary card reframing + color accents (LOW complexity, improves overview)
   - [ ] Confidence contextual callout with color coding (LOW, improves trust)

2. **Phase 2: Data aggregation (enables visualization)**
   - [ ] Question/item list with status indicators + mini progress bars (MEDIUM, requires new aggregation)
   - [ ] Stacked horizontal bars for distributions (MEDIUM, depends on grouping)

3. **Phase 3: Data quality (semantic grouping)**
   - [ ] Semantic answer grouping with expandable drill-down (HIGH, blocks accurate aggregation)
   - [ ] Optional: Merge/ungroup mutations (if time permits)

### Why This Order

1. **Foundation phase** is low-risk display changes; unblock frontend work while backend research happens for grouping
2. **Aggregation phase** assumes basic grouping (lowercase/whitespace only for now); visualize current data without perfect accuracy
3. **Semantic grouping phase** addresses root cause of data duplication; enables re-aggregation with accurate numbers

### Defer to v5.1+ (if blocked)

- Automatic synonym merging (complexity spike; start with manual grouping)
- Confidence thresholds with filtering (nice-to-have after grouping works)
- Answer variant visualization with inline details (depends on grouping stability)

## Feature Interaction Matrix

| Feature | Works With | Conflicts | Enhances | Blocked By |
|---------|------------|-----------|----------|-----------|
| Bar scaling | All others | None | Summary cards, stacked bars | None |
| Summary cards | All others | None | Confidence callout | None |
| Confidence callout | Bar scaling, summary | None | Trust/credibility | None |
| Status + progress | Question lists | None | Summary completion | Aggregation queries |
| Stacked bars | Status + progress | None | Seeing full distribution | Semantic grouping |
| Semantic grouping | Stacked bars, status | None (blocks mis-aggregation) | All aggregation | None (enables others) |

## Pattern Reference: Expected Behaviors

### 1. Bar Scaling Relative to Max

**Standard behavior:**
- Find max value across all bars in group (e.g., max count for answers to a question)
- Scale each bar width to `(value / max) * 100%`
- Axis label shows max value (e.g., "Max: 42 responses")
- Zero baseline implicit (width 0 = no responses)

**UI pattern:** Horizontal bars with no y-axis; category labels on left, numeric value on right (or hover tooltip)

**Example:**
```
Question: "Is this open access?"
  Yes:     42 responses  [████████████████████████] 100%
  No:      15 responses  [████████                 ]  36%
  Unknown:  8 responses  [████                     ]  19%
```

**Accessibility:** Include numeric labels (42/42) or aria-label for screen readers

---

### 2. Summary/Metric Cards with Color Accents

**Standard behavior:**
- Large number (36pt+ font), label below, optional sparkline
- Color accent (left border, background tint, or badge) signals category or status
- 60-30-10 color ratio: 60% neutral (white/gray), 30% accent (primary color), 10% dopamine (bold alert color)
- Subtle shadow or elevation distinguishes from page background

**UI pattern:** Card grid (1–4 columns depending on screen), each card self-contained

**Example:**
```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│▐ 94 papers      │  │▐ 7.2/10         │  │▐ 2,341 answers  │
│  Extracted      │  │  Avg confidence │  │  Total          │
└─────────────────┘  └─────────────────┘  └─────────────────┘
(green accent)      (yellow accent)      (blue accent)
```

**Color coding:**
- Green (≥85% confidence, extracted/complete): Trust signal
- Yellow (60–84%, warning, attention needed): Caution signal
- Red (<60%, error, high uncertainty): Problem signal

**Accessibility:** Each card is semantically a `<article>` or `<section>`; color not sole indicator (include icon + label)

---

### 3. Confidence Display (Contextual Callout)

**Standard behavior:**
- Replace confusing "effective confidence" tooltip with single, scannable number
- Single metric: **Confidence: 85%** (not dual raw/effective)
- Color-coded background or left border (green/yellow/red per threshold)
- Optional tooltip on hover: "Confidence is X% because extraction was based on [abstract only] / [full text]"

**UI pattern:** Inline badge or card callout near question or answer

**Example:**
```
Question: "Funding source?"
┌────────────────────────────────┐
│ Confidence: 94% ✓              │  (green background, checkmark)
│ Extracted from full text       │  (explanation in smaller text)
└────────────────────────────────┘

vs. High uncertainty answer:

┌────────────────────────────────┐
│ Confidence: 61% ⚠              │  (yellow background, warning icon)
│ Extracted from abstract only   │
└────────────────────────────────┘
```

**Accessibility:** Aria-label: "Confidence is 94%, indicated by green color and checkmark"

---

### 4. Question/Item List with Status Indicators + Mini Progress Bars

**Standard behavior:**
- Vertical list of questions; each row shows:
  - Status dot (green checkmark = complete/high conf, yellow ? = uncertain, gray — = no data)
  - Question title
  - Mini progress bar (or percentage) showing answer distribution (e.g., "3/5 questions answered")
  - Optional: count badge (e.g., "42 papers")

**UI pattern:** Table row or list item; status dot left-aligned, bar right-aligned or below title

**Example:**
```
✓ "Is this open access?"
  Progress: ████████████░░░░░░ 60% (answered for 15/25 papers)

⚠ "Funding source?"
  Progress: ██████░░░░░░░░░░░░░ 20% (answered for 5/25 papers)

— "Author affiliations?"
  Progress: ░░░░░░░░░░░░░░░░░░░░  0% (no extractions)
```

**Color coding:**
- ✓ green: 85%+ confidence or 80%+ papers answered
- ⚠ yellow: 60–84% confidence or 50–79% papers answered
- — gray: <60% confidence or <50% papers answered

**Accessibility:** Aria-label: "Question: Is this open access? Complete. Progress: 60% answered."

---

### 5. Stacked Horizontal Bars for Distributions

**Standard behavior:**
- One bar per question
- Bar divided into segments (each segment = one grouped answer)
- Segment color = answer category (or confidence level if stacking by confidence)
- Segment width = count or percentage
- Labels on bar or in legend; totals shown (e.g., "25 papers")

**UI pattern:** Left axis = question labels (long labels benefit from horizontal layout), bars extend right

**Example:**
```
Is this open access?    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  25 papers
                        [████████] [███████] [██]
                        Yes: 13   No: 10   Unknown: 2

Funding source?         ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  25 papers
                        [████] [██] [███████████████████]
                        Gov: 4  Priv: 2  No funding: 19
```

**Segment coloring:**
- Option A: By answer (each grouped answer type gets a color)
- Option B: By confidence (segments colored green/yellow/red by conf)
- Recommended: By answer type; use consistent palette across questions

**Accessibility:** Tooltip on hover shows exact count and percentage; legend identifies colors

---

### 6. Semantic Answer Grouping with Expandable Drill-Down

**Standard behavior:**
- Group similar answers (synonyms, case variants, whitespace variations)
- Show main/canonical answer; click/toggle to expand and see variants
- Display count per variant (e.g., "Open Access (3 papers)", "open access (2 papers)", "Open access (1 paper)")
- Optional: Merge/ungroup buttons to reclassify

**UI pattern:** Accordion rows or disclosure triangles; nested list of variants under main

**Example:**
```
Question: "Open Access Status?"

[▼] Open Access (6 papers) — canonical answer
    └─ Open access (2 papers)
    └─ open access (1 paper)
    └─ OPEN ACCESS (1 paper)
    └─ "open access" (1 paper) — variant with quotes
    └─ OpenAccess (1 paper) — typo variant
    [Merge all] [Ungroup]

[▶] Subscription Required (12 papers)
[▶] Unknown (7 papers)
```

**Interaction:**
- Click "Merge all" → all variants count as main answer in aggregations and stacked bars
- Click "Ungroup" → revert to showing variants separately (useful if wrong grouping)
- Expandable shows variant count and optionally papers where each variant appeared

**Accessibility:** Aria-expanded=true/false on accordion button; keyboard navigation (arrow keys expand/collapse)

---

## Implementation Notes

### Technology Assumptions
- Frontend: React components with Tailwind CSS or similar
- Backend: Convex queries for aggregation (per-question summaries, answer grouping)
- No new libraries required; use existing `<details>/<summary>` or Radix accordion

### Validation Hooks
- **Bar scaling:** Verify max value is non-zero (empty question = width 0, label "No extractions")
- **Summary cards:** Verify confidence calculation accounts for ABSTRACT_ONLY_CONFIDENCE_CAP
- **Confidence callout:** Test with very low conf (e.g., <50%) to ensure yellow/red prominence
- **Status indicators:** Validate color contrast (4.5:1 min) for WCAG AA compliance
- **Stacked bars:** Test with 5+ answer categories per question; ensure label readability
- **Semantic grouping:** Test merge/ungroup with real extraction data; validate that counts update in stacked bars

### Backward Compatibility
- Existing queries must return grouping-agnostic data (raw answers) until semantic layer is added
- Summary cards can reframe existing metrics (no schema change)
- Confidence callout uses existing `confidence` field (no new field needed)

---

## Sources

- [Data Visualization Best Practices - Tilburg Science Hub](https://www.tilburgsciencehub.com/topics/visualization/data-visualization/graphs-charts/theory-best-practices/)
- [A Complete Guide to Bar Charts | Atlassian](https://www.atlassian.com/data/charts/bar-chart-complete-guide)
- [Stacked Bar Charts: A Detailed Breakdown | Atlassian](https://www.atlassian.com/data/charts/stacked-bar-chart-complete-guide)
- [Curated Dashboard Design Examples for UI Inspiration (2026) | Muzli Blog](https://muz.li/blog/best-dashboard-design-examples-inspirations-for-2026/)
- [Effective Dashboard Color Scheme for Analytics](https://insightsoftware.com/blog/effective-color-schemes-for-analytics-dashboards/)
- [Confidence Visualization UI Patterns (CVP) - Agentic Design](https://agentic-design.ai/patterns/ui-ux-patterns/confidence-visualization-patterns)
- [Confidence Visualization | AI Design Patterns](https://www.aiuxdesign.guide/patterns/confidence-visualization)
- [Progress Trackers and Indicators – With 6 Examples To Do It Right](https://userguiding.com/blog/progress-trackers-and-indicators)
- [Status indicators | Carbon Design System](https://carbondesignsystem.com/patterns/status-indicator-pattern/)
- [The Ultimate Accordion Design Playbook | Muzli Blog](https://muz.li/blog/the-ultimate-accordion-design-playbook/)
- [Accordion UI Examples: Best Practices & Real-World Designs](https://www.eleken.co/blog-posts/accordion-ui)
- [Tooltip UI design: Practical tips and real examples](https://www.eleken.co/blog-posts/tooltip-ui)

---

*Feature research for: Extraction insights UI visualization and analytics patterns*
*Researched: 2026-03-10*
*Confidence: MEDIUM — Industry patterns verified; context-specific tradeoffs (semantic grouping complexity, aggregation scope) need phase-specific validation*
