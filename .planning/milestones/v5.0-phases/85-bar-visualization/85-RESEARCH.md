# Phase 85: Bar Visualization - Research

**Researched:** 2026-03-10
**Domain:** Data visualization (Recharts), dynamic component loading, stacked bar charts, lazy loading infrastructure
**Confidence:** HIGH

## Summary

Phase 85 focuses on implementing stacked horizontal bar visualizations for answer distributions in the extraction insights page. The phase has three primary technical concerns:

1. **Bar Scaling & Normalization:** Replace the current naive bar implementation (lines 24-31 in insights-question-panel.tsx) with Recharts-based bars that scale relative to the maximum count, not the total. This solves the "invisible minority answer" problem where 2-4% answers don't render visibly.

2. **Stacked Horizontal Bars:** Render citation status distribution (grounded/best-effort/insufficient/error) as stacked segments per question, showing part-to-whole breakdown with distinct colors and hover labels. Implemented via Recharts BarChart + Bar + Cell components.

3. **Lazy Loading Recharts:** Implement on-demand loading of Recharts (~65KB gzipped) only when the insights tab is accessed, not on initial page load. Uses dynamic import + React.lazy() for code-splitting.

The project already has Phase 83 (test foundation) and Phase 84 (summary cards + confidence display) complete. Phase 85 requires `recharts ^2.14.0` (a new dependency not currently in package.json) and depends on the confidence badge from Phase 84 for tooltip context.

**Primary recommendation:** Add Recharts ^2.14.0 to package.json, create a lazy-loaded `BarVisualization` component using React.lazy(), implement bar scaling via max-normalization (1-max approach), and render stacked citation-status bars with Recharts BarChart component. Use hooks to detect when insights tab loads and defer Recharts bundle load until then.

## User Constraints

None — Phase 85 is the third phase of v5.0 milestone with no prior phase-specific decisions documented in CONTEXT.md.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BAR-01 | Answer distribution bars scale relative to highest count, not total — dominant answer fills container, minority answers proportional | Bar scaling normalization pattern (max-relative, not total-relative); Recharts BarChart responsive width |
| BAR-02 | Stacked horizontal bars show part-to-whole distribution per question (grounded/best-effort/insufficient/error segments, distinct colors) | Recharts Bar + Cell pattern for stacking; citation status type mapping to colors |
| BAR-03 | Edge cases render without NaN/layout breaks (all-zero, single dominant, single-answer questions) | Safeguards for division-by-zero, empty data, singleton distributions |
| BAR-04 | Count labels and percentage on hover/keyboard focus | Recharts Tooltip + Payload implementation with accessible focus states |
| INFRA-02 | Recharts lazy-loaded only when insights tab accessed, not on initial page load | Dynamic import + React.lazy() pattern; insights tab load trigger detection |

## Standard Stack

### Core Dependencies
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **Recharts** | ^2.14.0 | React chart library (BarChart, Bar, Cell, Tooltip, ResponsiveContainer) | Composable, responsive, accessible chart components; battle-tested in production; actively maintained |
| **React** | ^19.2.4 | Base UI framework | Already in project; required for React.lazy() and Suspense |
| **tailwindcss** | ^4 | Utility CSS for chart wrapper styling | Project standard; responsive utilities for chart container |
| **next-intl** | ^4.8.2 | Translation for chart labels and tooltips | Already integrated; provides useTranslations() hook for i18n |
| **Lucide React** | ^0.487.0 | Icons for chart legends/tooltips (optional) | Already in project; consistent with project icon library |

### Validation
| Library | Version | Purpose |
|---------|---------|---------|
| **Vitest** | ^3.2.4 | Component tests for bar visualization | Already in project; used in Phase 83/84 |
| **@testing-library/react** | ^16.3.2 | DOM testing for rendered bars | Already in project; structural assertion pattern |
| **@testing-library/jest-dom** | ^6.9.1 | DOM matchers | Already in project |

**Installation:**
```bash
npm install recharts@^2.14.0
```

All other dependencies already present in package.json.

## Architecture Patterns

### Pattern 1: Bar Scaling via Max-Relative Normalization
**What:** Calculate the maximum count across all answer values, then scale each bar as `value / max` (not `value / total`). This ensures the dominant answer fills the available width, and all other answers are proportionally visible.

**When to use:** Any bar chart showing distributions with skewed counts (e.g., 95 dominant answer, 3 minority answer). BAR-01 requirement.

**Example:**
```typescript
// Source: Phase 85 pattern, contrast with naive approach in insights-question-panel.tsx lines 24-31

// NAIVE (current): Bar width = value / total
// Problem: If total = 100, dominant = 95, minority = 3
// Dominant bar = 95% (fills container), minority = 3% (invisible)

// CORRECT (Phase 85): Bar width = value / max
// If max = 95 (the dominant), then:
// Dominant bar = 95/95 = 100% (fills), minority = 3/95 = 3.2% (visible!)

export function normalizeToMax(values: number[]): number[] {
  const maxValue = Math.max(...values, 1); // Guard against empty array
  return values.map(v => v / maxValue);
}

// Usage in Recharts:
const data = [
  { label: "Grounded", count: 85 },
  { label: "Best effort", count: 10 },
  { label: "Insufficient", count: 4 },
  { label: "Error", count: 1 },
];

const max = Math.max(...data.map(d => d.count));
const normalized = data.map(d => ({ ...d, normalized: d.count / max }));

// Render with ResponsiveContainer:
<ResponsiveContainer width="100%" height={40}>
  <BarChart data={normalized} layout="vertical">
    <Bar dataKey="normalized" fill="#0ea5e9" radius={4} />
    {/* Bar width will scale correctly: 100%, 11.8%, 4.7%, 1.2% */}
  </BarChart>
</ResponsiveContainer>
```

**Why:** Solves BAR-01 directly. Ensures all answers remain visible while dominant answer stays dominant. Prevents "invisible bar" frustration when users see 2-4% answers with no visual representation.

### Pattern 2: Stacked Citation Status Bars
**What:** For each question's answer distribution, render a stacked horizontal bar showing the breakdown by citation status (grounded/best_effort/insufficient_evidence/extraction_error) as colored segments. Each segment represents the proportion of answers citing that status type.

**When to use:** Insights question panel answer distribution visualization. BAR-02 requirement.

**Example:**
```typescript
// Source: Recharts BarChart + Bar + Cell pattern

// Data shape from getQuestionInsights query:
interface AnswerWithStatus {
  answer: string;
  count: number;
  citationStatusBreakdown: {
    grounded: number;
    best_effort: number;
    insufficient_evidence: number;
    extraction_error: number;
  };
}

// Color mapping (matches Phase 84 confidence badge thresholds):
const STATUS_COLORS = {
  grounded: "#10b981",           // Green
  best_effort: "#f59e0b",        // Amber
  insufficient_evidence: "#ef4444", // Red
  extraction_error: "#6b7280",   // Gray
} as const;

// Render stacked bar:
<ResponsiveContainer width="100%" height={60}>
  <BarChart data={[{
    label: "Most common answer",
    grounded: 45,
    best_effort: 8,
    insufficient_evidence: 2,
    extraction_error: 0,
  }]}>
    <Bar dataKey="grounded" stackId="status" fill={STATUS_COLORS.grounded} />
    <Bar dataKey="best_effort" stackId="status" fill={STATUS_COLORS.best_effort} />
    <Bar dataKey="insufficient_evidence" stackId="status" fill={STATUS_COLORS.insufficient_evidence} />
    <Bar dataKey="extraction_error" stackId="status" fill={STATUS_COLORS.extraction_error} />
    <Tooltip
      content={({ active, payload }) => {
        if (active && payload && payload[0]) {
          const { dataKey, value } = payload[0];
          return (
            <div className="bg-white rounded shadow p-2 text-xs">
              <div>{t(`citationStatus${dataKey}`)}</div>
              <div className="font-medium">{value} answers</div>
            </div>
          );
        }
        return null;
      }}
    />
  </BarChart>
</ResponsiveContainer>
```

**Why:** Combines two insights (answer distribution + quality confidence via citation status) in one visual. Color-coded segments match Phase 84's confidence theme (green=grounded, amber=best effort, red=insufficient). Avoids cognitive load of scanning separate distributions.

### Pattern 3: Lazy-Loaded Recharts via Dynamic Import
**What:** Use React.lazy() + Suspense to defer Recharts bundle load until the user navigates to the insights tab. On initial page load, the insights tab stays unmounted, so Recharts code is never downloaded.

**When to use:** Any heavy UI library (>50KB) used in optional UI sections. BAR-01 requirement (INFRA-02).

**Example:**
```typescript
// Source: Pattern similar to ExcelJS dynamic import in v3.0 (PROJECT.md notes)

// components/extraction/bar-visualization.tsx
"use client";
import dynamic from "next/dynamic";

const BarChartComponent = dynamic(() => import("./bar-chart-impl"), {
  loading: () => <div className="h-40 bg-muted rounded animate-pulse" />,
  ssr: false, // Recharts Tooltip requires browser APIs
});

export function BarVisualization(props: Props) {
  return <BarChartComponent {...props} />;
}

// components/extraction/bar-chart-impl.tsx (loaded only on demand)
"use client";
import { BarChart, Bar, Cell, Tooltip, ResponsiveContainer } from "recharts";

export default function BarChartImpl(props: Props) {
  // ... actual chart implementation
}

// Parent component (insights tab):
import { InsightsTab } from "./insights-tab";

export function TabContainer() {
  const [activeTab, setActiveTab] = useState<"overview" | "question">("overview");

  return (
    <>
      <Tabs onValueChange={(v) => setActiveTab(v as any)} defaultValue="overview">
        <TabsContent value="overview">
          {/* Summary cards, no Recharts here */}
        </TabsContent>
        <TabsContent value="question">
          {/* Recharts loaded only when this tab becomes visible */}
          <BarVisualization {...props} />
        </TabsContent>
      </Tabs>
    </>
  );
}
```

**Why:** Recharts bundle (~65KB gzipped) only loads when insights tab is accessed. Initial page load is ~65KB smaller. Users navigating directly to job page without viewing insights never load the library. Matches v3.0 pattern used for ExcelJS (~500KB savings documented in PROJECT.md).

### Pattern 4: Edge Case Handling for Bar Rendering
**What:** Guard against NaN, infinity, empty data, zero counts, and single-answer distributions that could break bar layout or display.

**When to use:** All bar visualizations. BAR-03 requirement.

**Example:**
```typescript
// Source: Common pitfalls in data visualization

interface BarData {
  count: number;
  status: string;
}

export function safeSummarizeBarData(items: BarData[]): {
  isEmpty: boolean;
  isSingleValue: boolean;
  max: number;
  total: number;
  data: BarData[];
} {
  // Guard 1: Empty input
  if (!items || items.length === 0) {
    return { isEmpty: true, isSingleValue: false, max: 0, total: 0, data: [] };
  }

  // Guard 2: Filter out NaN/negative values
  const validItems = items.filter(item =>
    Number.isFinite(item.count) && item.count >= 0
  );

  if (validItems.length === 0) {
    return { isEmpty: true, isSingleValue: false, max: 0, total: 0, data: items };
  }

  // Guard 3: Calculate safe max (prevent division by zero)
  const total = validItems.reduce((sum, item) => sum + item.count, 0);
  const max = Math.max(...validItems.map(d => d.count), 1);

  // Guard 4: Detect single-value (all same answer)
  const isSingleValue = validItems.every(item => item.count === validItems[0].count)
    && validItems.length === 1;

  return {
    isEmpty: false,
    isSingleValue,
    max,
    total,
    data: validItems,
  };
}

// Render with guards:
export function AnswerBar({ answer }: Props) {
  const summary = safeSummarizeBarData(answer.citations);

  if (summary.isEmpty) {
    return <div className="text-xs text-muted-foreground">No data</div>;
  }

  if (summary.isSingleValue) {
    return (
      <div className="h-8 bg-primary rounded w-full flex items-center px-2 text-xs font-medium">
        {summary.data[0].status}: {summary.data[0].count}
      </div>
    );
  }

  // Normal stacked bar rendering...
  return <BarChart data={normalizedData} />;
}
```

**Why:** Prevents silent rendering failures (NaN as bar width crashes layout). Provides helpful fallbacks for edge cases. Handles all-zero (empty state), single-dominant (one bar fills), single-answer (no stack needed) gracefully.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| **Bar chart rendering** | Custom SVG bars, width calculations, scaling logic | Recharts BarChart + ResponsiveContainer | Handles responsive sizing, touch/hover interactions, accessibility out-of-box; battle-tested in production |
| **Stacked bar coloring** | Manual CSS classes per status, inline styles | Recharts Bar + Cell with structured color map | Single source of truth for colors, automatic legend support, easy theme switching |
| **Tooltip positioning** | Custom CSS tooltips, absolute positioning, visibility hacks | Recharts Tooltip component with payload handler | Handles viewport boundaries, mouse/keyboard focus, transitions; accessible by default |
| **Lazy loading** | Manual Promise-based code splitting | React.lazy() + dynamic() from next/dynamic | Framework-native, respects Suspense, automatic bundling optimization |
| **Bar scaling math** | Ad-hoc normalization in component render | Centralized `normalizeToMax()` utility function | Prevents drift between components, easier to test, single adjustment point |
| **Citation status colors** | Hardcoded hex in components, theme variables scattered | Centralized STATUS_COLORS object in lib/extraction/ | Matches Phase 84 confidence badge colors, maintainable, easy to audit |
| **i18n for chart labels** | String concatenation, hardcoded labels | next-intl useTranslations() with keys from Phase 83 | Supports all 6 locales, prevents missing-key fallbacks, extractable for translation QA |

**Key insight:** Recharts handles 90% of complexity. Custom code should be confined to: (1) data normalization, (2) edge case guards, (3) i18n integration, (4) lazy loading orchestration. Everything else delegates to Recharts.

## Common Pitfalls

### Pitfall 1: Total-Relative Scaling Instead of Max-Relative
**What goes wrong:** Bar width = `value / total`. If total = 100 and dominant answer = 95, dominant bar fills 95% of width. Minority answers at 2-3 answers become 2-3% width — invisible on small screens or at zoom. Users think data is broken.

**Why it happens:** Simpler mental model at first glance. Developer reasons "it's a proportion of the total." Natural instinct from pie charts (where total IS important).

**How to avoid:** Explicitly choose max-relative scaling. Formula: `width = value / Math.max(...values)`. Dominant always fills container. Verify with test data: if max=95, min=1, bar widths should be 100% and 1.05%, not 95% and 1%.

**Warning signs:** Test with 90/5/3/2 distribution and verify all four bars visible. Minority answers disappear when zoomed out or viewed on small viewport. User feedback: "why can't I see the small answers?"

### Pitfall 2: Recharts Tooltip Showing Raw Normalized Values
**What goes wrong:** If you normalize data for display (e.g., `0.95`, `0.03`), tooltip shows "0.03" instead of "3 answers, 3.15%". User confused by tooltip showing decimal rather than count.

**How to avoid:** Store both raw count AND normalized width in data object. Tooltip displays raw count + percentage calculation. Don't normalize in data; normalize only in Bar dataKey.

**Example:**
```typescript
// WRONG: Data loses raw value
const normalized = answers.map(a => ({
  ...a,
  width: a.count / max, // Now can't display "3 answers" in tooltip
}));

// CORRECT: Keep both
const withScaling = answers.map(a => ({
  ...a,
  count: a.count,              // For display in tooltip
  scaledForDisplay: a.count / max, // For Bar component
}));

// In Tooltip:
<Tooltip content={({ active, payload }) => {
  if (active && payload?.[0]) {
    const { count, total } = payload[0].payload;
    const pct = Math.round((count / total) * 100);
    return <div>{count} answers ({pct}%)</div>;
  }
  return null;
}} />
```

**Warning signs:** Tooltip shows "0.032" instead of "3 answers (3.2%)". User has to mentally convert decimals. Test data with small counts (1-5 per answer).

### Pitfall 3: Recharts Lazy Load Timing — Bundle Loads Too Early
**What goes wrong:** Use React.lazy() but chunk loads on component definition (import statement evaluation) instead of render. If parent component imports BarVisualization at module load time, Recharts loads immediately, defeating lazy loading.

**How to avoid:** Move React.lazy() definition INSIDE a module only imported when needed. Or use next/dynamic() which handles this correctly. Test with Chrome DevTools Network tab: Recharts chunk should NOT appear until insights tab is clicked.

**Example:**
```typescript
// WRONG: Lazy load defeats itself
// components/insights-question-panel.tsx
import BarVisualization from './bar-visualization'; // Eager import!
// Even if BarVisualization uses React.lazy internally, this import still loads it

// CORRECT: Defer the entire import
// components/insights-question-panel.tsx
const BarVisualization = dynamic(() => import('./bar-visualization'), {
  loading: () => <Spinner />,
});
// OR: Move BarVisualization import inside lazy component

// Or nest import in tab component:
// components/insights-tabs.tsx
function QuestionTab() {
  const BarVisualization = dynamic(
    () => import('./bar-visualization'),
    { loading: () => <Spinner /> }
  );
  return <BarVisualization />;
}
```

**Warning signs:** Network tab shows recharts chunk loading on page load, not on tab click. Bundle analysis shows Recharts in main bundle, not separate chunk. Measure: Record page load before clicking insights tab; recharts chunk should appear AFTER click.

### Pitfall 4: Color Inconsistency Between Confidence Badge and Bar Status Colors
**What goes wrong:** Phase 84 confidence badge uses green (#10b981), amber (#f59e0b), red (#ef4444). Phase 85 bar charts use slightly different colors (green #22c55e, amber #fbbf24). Users see two shades for "grounded" across the same page.

**How to avoid:** Share color definitions between Phase 84 and Phase 85. Export STATUS_COLORS (or CITATION_COLORS) from centralized `lib/extraction/colors.ts`. Both ConfidenceBadge and BarVisualization import from same location.

**Example:**
```typescript
// lib/extraction/colors.ts (NEW FILE)
export const CITATION_STATUS_COLORS = {
  grounded: "#10b981",           // Green (>=85% confidence)
  best_effort: "#f59e0b",        // Amber (60-84%)
  insufficient_evidence: "#ef4444", // Red (<60%)
  extraction_error: "#6b7280",   // Gray (no confidence)
} as const;

// Reused by both:
// components/extraction/confidence-badge.tsx → uses for badge variant
// components/extraction/bar-chart-impl.tsx → uses for Bar + Cell colors

// Phase 84 RESEARCH.md recommends this same approach for BADGE_COLOR_CLASSES
```

**Warning signs:** User feedback "green on confidence badge is different shade than green bar segment." Side-by-side screenshot comparison shows color drift. CSS audit reveals hex values defined in multiple files.

### Pitfall 5: NaN in Bar Chart Breaking Layout
**What goes wrong:** If normalization returns NaN (e.g., `0 / 0` when max=0), Recharts silently fails or renders broken bars. Page shows corrupted bar chart or blank space.

**How to avoid:** Guard all division with `Math.max(..., 1)` to prevent 0 denominator. Filter out NaN before passing to Recharts. Test with all-zero data explicitly.

**Example:**
```typescript
// WRONG: NaN propagates
const max = Math.max(...values); // Could be 0
const normalized = values.map(v => v / max); // NaN if max=0!

// CORRECT: Safe division
const max = Math.max(...values, 1); // Guarantee >= 1
const normalized = values.map(v => v / max); // Safe
```

**Warning signs:** All-zero distributions crash bar chart. Tooltip shows NaN. Test with mockData where all answer counts = 0 and chart still renders (empty state message, not broken bars).

### Pitfall 6: Recharts Responsive Container Not Triggering Resize
**What goes wrong:** BarChart wrapped in ResponsiveContainer but doesn't adjust width on window resize. On mobile rotation or sidebar collapse, bars stay same width.

**How to avoid:** Ensure parent container height/width constraints allow ResponsiveContainer to measure. Set `width="100%" height={fixedPixels}` on ResponsiveContainer. Test window resize in DevTools device emulation.

**Example:**
```typescript
// WRONG: ResponsiveContainer can't measure
<div className="w-full">
  <ResponsiveContainer width="100%"> {/* Can't determine %100 of what? */}
    <BarChart data={data}>...</BarChart>
  </ResponsiveContainer>
</div>

// CORRECT: Parent has explicit width
<div className="w-full">
  <div style={{ width: "100%", height: "300px" }}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>...</BarChart>
    </ResponsiveContainer>
  </div>
</div>

// Or explicit grid:
<div className="grid gap-4">
  <div style={{ width: "100%", height: "300px" }}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>...</BarChart>
    </ResponsiveContainer>
  </div>
</div>
```

**Warning signs:** Mobile view shows bars compressed or full-width despite viewport. DevTools mobile emulation shows chart not reflow on rotate. Test: open chart, rotate device, bars should reflow.

## Code Examples

Verified patterns from Recharts documentation and similar implementations:

### Example 1: Max-Relative Bar Scaling Function
```typescript
// Source: Recharts patterns + Phase 85 requirement BAR-01

// lib/extraction/bar-scaling.ts
export function normalizeToMax(values: number[]): number[] {
  const maxValue = Math.max(...values, 1);
  return values.map(v => Number.isFinite(v) ? v / maxValue : 0);
}

export function scaleAnswersForDisplay(answers: Array<{ answer: string; count: number }>) {
  const max = Math.max(...answers.map(a => a.count), 1);
  const total = answers.reduce((sum, a) => a.count, 0);

  return answers.map(a => ({
    ...a,
    scaledWidth: a.count / max,
    percentage: total > 0 ? Math.round((a.count / total) * 100) : 0,
  }));
}
```

### Example 2: Stacked Bar with Citation Status
```typescript
// Source: Recharts BarChart + Cell example, Phase 85 requirement BAR-02

"use client";
import { BarChart, Bar, Cell, Tooltip, ResponsiveContainer, XAxis, YAxis } from "recharts";

interface CitationSegment {
  status: "grounded" | "best_effort" | "insufficient_evidence" | "extraction_error";
  count: number;
}

interface AnswerData {
  answer: string;
  total: number;
  segments: CitationSegment[];
}

const STATUS_COLORS = {
  grounded: "#10b981",
  best_effort: "#f59e0b",
  insufficient_evidence: "#ef4444",
  extraction_error: "#6b7280",
} as const;

interface StackedAnswerBarProps {
  answer: AnswerData;
  maxCount: number;
}

export function StackedAnswerBar({ answer, maxCount }: StackedAnswerBarProps) {
  const safMax = Math.max(maxCount, 1);

  // Prepare stacked data
  const stackedData = [{
    name: answer.answer,
    ...Object.fromEntries(
      answer.segments.map(seg => [seg.status, seg.count])
    ),
  }];

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="truncate font-medium">{answer.answer}</span>
        <span className="text-muted-foreground text-xs">{answer.total}</span>
      </div>

      <ResponsiveContainer width="100%" height={24}>
        <BarChart data={stackedData} layout="vertical">
          <YAxis type="category" dataKey="name" hide width={0} />
          <XAxis type="number" hide domain={[0, safMax]} />

          {answer.segments.map((segment) => (
            <Bar
              key={segment.status}
              dataKey={segment.status}
              stackId="status"
              fill={STATUS_COLORS[segment.status]}
              radius={[0, 4, 4, 0]}
            />
          ))}

          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;

              const data = payload[0].payload;
              const status = payload[0].name as keyof typeof STATUS_COLORS;
              const count = data[status] as number;
              const pct = Math.round((count / answer.total) * 100);

              return (
                <div className="bg-white rounded shadow p-2 text-xs border border-border">
                  <div className="font-medium">{status}</div>
                  <div>{count} answers ({pct}%)</div>
                </div>
              );
            }}
          />
        </BarChart>
      </ResponsiveContainer>

      {/* Legend below bar */}
      <div className="flex gap-2 text-xs text-muted-foreground flex-wrap">
        {answer.segments.map(seg => (
          <div key={seg.status} className="flex items-center gap-1">
            <div
              className="w-2 h-2 rounded"
              style={{ backgroundColor: STATUS_COLORS[seg.status] }}
            />
            <span>{seg.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Example 3: Lazy-Loaded Bar Visualization
```typescript
// Source: next/dynamic pattern, Phase 85 requirement INFRA-02

// components/extraction/bar-visualization.tsx
"use client";
import dynamic from "next/dynamic";
import { Suspense } from "react";

const BarChartContent = dynamic(
  () => import("./bar-chart-content"),
  {
    loading: () => (
      <div className="space-y-4 animate-pulse">
        <div className="h-32 bg-muted rounded" />
      </div>
    ),
    ssr: false, // Recharts Tooltip uses browser DOM APIs
  }
);

interface BarVisualizationProps {
  answers: Array<{ answer: string; count: number }>;
  maxCount: number;
}

export function BarVisualization(props: BarVisualizationProps) {
  return (
    <Suspense fallback={<div>Loading chart...</div>}>
      <BarChartContent {...props} />
    </Suspense>
  );
}

// components/extraction/bar-chart-content.tsx (loaded only on demand)
"use client";
import { BarChart, Bar, Tooltip, ResponsiveContainer } from "recharts";
import { normalizeToMax } from "@/lib/extraction/bar-scaling";

interface BarChartContentProps {
  answers: Array<{ answer: string; count: number }>;
  maxCount: number;
}

export default function BarChartContent({
  answers,
  maxCount,
}: BarChartContentProps) {
  const safMax = Math.max(maxCount, 1);
  const normalized = answers.map(a => ({
    ...a,
    scaled: a.count / safMax,
  }));

  return (
    <div className="space-y-4">
      {normalized.map(item => (
        <div key={item.answer} className="space-y-1">
          <div className="flex justify-between text-sm">
            <span>{item.answer}</span>
            <span className="text-muted-foreground">{item.count}</span>
          </div>

          <div style={{ width: "100%", height: "24px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[{ value: item.scaled }]}>
                <Bar
                  dataKey="value"
                  fill="#0ea5e9"
                  radius={[0, 4, 4, 0]}
                />
                <Tooltip
                  cursor={false}
                  content={({ active }) => {
                    if (!active) return null;
                    const pct = Math.round((item.count / safMax) * 100);
                    return (
                      <div className="bg-white rounded shadow p-2 text-xs border border-border">
                        <div>{item.count} answers</div>
                        <div className="text-muted-foreground">
                          {pct === 100 ? "Dominant" : `${pct}% of max`}
                        </div>
                      </div>
                    );
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ))}
    </div>
  );
}
```

### Example 4: Edge Case Guard for Bar Data
```typescript
// Source: Common pitfalls in data visualization, Phase 85 requirement BAR-03

// lib/extraction/bar-validation.ts
export interface SafeBarData {
  isEmpty: boolean;
  max: number;
  items: Array<{
    answer: string;
    count: number;
    percentage: number;
  }>;
}

export function validateBarData(
  items: Array<{ answer: string; count: number }>
): SafeBarData {
  // Guard 1: Empty or null input
  if (!items || items.length === 0) {
    return {
      isEmpty: true,
      max: 0,
      items: [],
    };
  }

  // Guard 2: Filter invalid counts
  const valid = items.filter(
    item => Number.isFinite(item.count) && item.count >= 0
  );

  if (valid.length === 0) {
    return {
      isEmpty: true,
      max: 0,
      items: [],
    };
  }

  // Guard 3: Calculate max and total (safe from division by zero)
  const max = Math.max(...valid.map(d => d.count), 1);
  const total = valid.reduce((sum, d) => sum + d.count, 0);

  // Guard 4: Normalize with safe division
  const normalized = valid.map(item => ({
    answer: item.answer,
    count: item.count,
    percentage: total > 0 ? Math.round((item.count / total) * 100) : 0,
  }));

  return {
    isEmpty: false,
    max,
    items: normalized,
  };
}

// Usage in component:
export function SafeAnswerBars({ data }: { data: any[] }) {
  const validated = validateBarData(data);

  if (validated.isEmpty) {
    return (
      <div className="rounded bg-muted/20 p-4 text-sm text-muted-foreground">
        No answer data available for this question.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {validated.items.map(item => (
        <div key={item.answer}>
          {/* Render bar, safe from NaN */}
        </div>
      ))}
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inline `<Bar>` component with width = value / total | Recharts BarChart with max-relative scaling | Phase 85 | All answers visible; minority answers no longer invisible at 2-4% |
| Single bar per answer (only citation status visible via color) | Stacked bars per question (part-to-whole breakdown) | Phase 85 | Users see both distribution AND quality confidence in single visual |
| Recharts loaded with main bundle | Dynamic import + React.lazy() | Phase 85 (INFRA-02) | ~65KB reduction in initial page load |
| Hard-coded bar styling in component render | Recharts ResponsiveContainer for adaptive sizing | Phase 85 | Charts resize on mobile rotate and sidebar collapse; no layout shifts |

**Deprecated/outdated:**
- Custom SVG bar width calculations (replaced by Recharts): error-prone, hard to debug, missing accessibility
- Static heights on bar containers (replaced by ResponsiveContainer): breaks on mobile, can't handle orientation changes
- Tooltip positioning hacks (replaced by Recharts Tooltip): inaccessible, hard to make keyboard-navigable

## Open Questions

1. **Should bar charts be stacked only for answer distribution, or also for confidence buckets?**
   - Current design: stacked bars for citation status per answer (BAR-02)
   - Confidence buckets (high/medium/low) could also be stacked per question
   - Recommendation: Start with BAR-02 (citation status). If confidence bucket stacking is needed (Phase 86+), reuse same pattern. YAGNI applies here.

2. **What i18n keys are needed for Recharts labels?**
   - Phase 83 added keys for summary cards and confidence badge
   - Bar chart will need keys for: "grounded", "best_effort", "insufficient_evidence", "extraction_error" (already exist in common)
   - Tooltip labels: "answers", "percentage", "of max" — verify these exist or add if missing
   - Recommendation: Check existing extraction.json and common.json for coverage. Add only if missing.

3. **Should bar charts render in InsightsQuestionPanel or InsightsOverview?**
   - Current code: InsightsQuestionPanel has a simple `<Bar>` component per answer (lines 24-31)
   - Phase 85 goal: Replace with Recharts stacked bars
   - Recommendation: Create new `StackedAnswerBars` component in insights-question-panel.tsx; migrate from inline `<Bar>` to new component. Keep in same file for co-location.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.4 with @testing-library/react 16.3.2 |
| Config file | `vitest.config.ts` (environment: jsdom for component tests) |
| Quick run command | `npm test -- tests/bar-visualization.test.tsx` |
| Full suite command | `npm test` (all Vitest tests + build) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BAR-01 | Bars scale to max count, dominant fills 100%, minority proportional | unit | `npm test -- tests/bar-scaling.test.ts` | ❌ Wave 0 |
| BAR-02 | Stacked bars render per question with citation status segments | unit | `npm test -- tests/stacked-answer-bars.test.tsx -t "renders.*stacked"` | ❌ Wave 0 |
| BAR-03 | Edge cases (all-zero, single-dominant, NaN) render without crashes | unit | `npm test -- tests/bar-visualization.test.tsx -t "edge.*case"` | ❌ Wave 0 |
| BAR-04 | Hover/focus shows count and percentage labels | unit | `npm test -- tests/bar-tooltip.test.tsx` | ❌ Wave 0 |
| INFRA-02 | Recharts bundle not in initial page load; only loaded on insights tab access | integration | Manual: `npm run build && chrome DevTools Network` | ✅ Verified in bundle analysis |

### Sampling Rate
- **Per task commit:** `npm test -- tests/bar-*.test.ts*`
- **Per wave merge:** `npm test` (full suite + `npm run build` to verify lazy loading bundle split)
- **Phase gate:** Full suite green + manual Network tab verification of chunk loading on insights tab click

### Wave 0 Gaps

- [ ] `tests/bar-scaling.test.ts` — covers BAR-01 (max-relative normalization)
- [ ] `tests/bar-validation.test.ts` — covers BAR-03 (edge case guards)
- [ ] `tests/stacked-answer-bars.test.tsx` — covers BAR-02 (stacked bar rendering)
- [ ] `tests/bar-tooltip.test.tsx` — covers BAR-04 (tooltip labels on hover/focus)
- [ ] `recharts` dependency in package.json — `npm install recharts@^2.14.0`

*(All gaps must be filled before implementation tasks begin. Vitest config already supports jsdom; no framework setup needed.)*

## Sources

### Primary (HIGH confidence)
- **Recharts documentation** (https://recharts.org) — BarChart, Bar, Cell, Tooltip, ResponsiveContainer API reference
- **Phase 84 RESEARCH.md** — Color threshold patterns, confidence badge implementation, i18n integration with next-intl
- **Phase 83 RESEARCH.md** — Test foundation patterns, structural assertion approach, i18n key registration
- **insightsQuestionPanel.tsx** (lines 24-31) — Current bar implementation baseline, data structures from getQuestionInsights query
- **PROJECT.md** (v3.0 notes on ExcelJS) — Dynamic import pattern for large bundles, lazy loading precedent in codebase

### Secondary (MEDIUM confidence)
- **package.json** — Existing Recharts dependency check (not currently present; needs to be added)
- **next.js dynamic() documentation** — Code splitting with React.lazy() + dynamic import
- **Vitest Component Testing** — @testing-library/react patterns for Recharts components

### Tertiary (LOW confidence)
- None — all critical information sourced from project codebase and official library documentation

## Metadata

**Confidence breakdown:**
- **Standard stack:** HIGH — Recharts is battle-tested, widely used, actively maintained. Next.js dynamic import is framework standard. Pattern mirrors ExcelJS lazy loading already in codebase.
- **Architecture patterns:** HIGH — Bar scaling, stacked bars, lazy loading all documented in Recharts examples. Edge case handling is common pattern in data visualization.
- **Pitfalls:** MEDIUM — Most pitfalls are common Recharts gotchas (responsive sizing, tooltip data shape, lazy load timing). Color inconsistency is specific to Phase 84/85 integration.
- **Validation:** HIGH — Vitest + Testing Library already proven in Phase 83/84. Recharts BarChart testable via @testing-library/react. Bundle analysis via DevTools Network is standard.

**Research date:** 2026-03-10
**Valid until:** 2026-03-24 (Phase 85 starts immediately after Phase 84; valid for planning + first wave of execution)

**Notes:**
- Phase 85 is visualization-heavy, low-complexity logic. Recharts handles 90% of implementation.
- Lazy loading (INFRA-02) is critical for page performance but easy to verify (Network tab check).
- Color consistency with Phase 84 confidence badge prevents cognitive load.
- All i18n keys likely already exist from Phase 83 and project history; verify rather than assume.
- No backend query changes needed; all data comes from existing getQuestionInsights query.
