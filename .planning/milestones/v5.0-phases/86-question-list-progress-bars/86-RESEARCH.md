# Phase 86: Question List & Progress Bars - Research

**Researched:** 2026-03-10
**Domain:** React component patterns, accessibility, progress visualization, Radix UI
**Confidence:** HIGH

## Summary

Phase 86 adds visual progress indicators to the question list in the Insights Overview component. Each question item requires two non-interactive visual layers: a status dot (complete/partial/empty) and a mini progress bar with percentage text. The requirement is to make the question list scannable without expanding individual questions. All data is already available from the existing `getJobInsights` query; this phase is pure UI composition.

Key finding: The InsightsOverview component renders questions as button elements with badge metadata. Phase 86 enhances each button with a status dot (colored circle) positioned left of the question name and a mini progress bar (similar to the existing Radix Progress component) positioned after the badges. No backend changes or query modifications are required.

**Primary recommendation:** Create a reusable `<QuestionListItem>` component that accepts the question data object and emits the status dot and progress bar as part of the collapsed list view. Use the Radix Progress component (already in dependencies) for accessibility. Define a `statusFromCompletion()` utility function to map answered/total ratios to 'complete' | 'partial' | 'empty' states.

## User Constraints

None — no CONTEXT.md exists for this phase, so all decisions are within Claude's discretion.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| QLIST-01 | Status dot (complete/partial/empty) visible without expanding | Question data already has answered/total counts; status determinable via `answered === total` (complete), `answered > 0` (partial), `answered === 0` (empty) |
| QLIST-02 | Mini progress bar with percentage text alongside | Radix Progress component available; percentage = `(answered / Math.max(total, 1)) * 100`; handle 0% case with aria attributes |
| QLIST-03 | List is scannable end-to-end without expand/collapse | Pure visual enhancement to existing button-based question list; requires no restructuring |

## Standard Stack

### Core UI Components
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Radix UI (Progress) | v1.0+ | Accessible progress bar primitive | Already used in codebase via `components/ui/progress.tsx`; provides aria-valuenow, aria-label, aria-valuemin/max out of the box |
| Tailwind CSS | ^4 | Styling (dots, spacing, layout) | Established utility framework; integrates with existing design system |
| Lucide React | ^0.487.0 | Icons (if needed for status indicator) | Already a dependency; clean SVG icons |
| React | ^18 | Component rendering | Established framework |

### Data Source
| Source | Version | Purpose | Already Available |
|--------|---------|---------|-------------------|
| getJobInsights query | Existing | Question array with answered/total per question | YES — query returns `questions[]` with `answered`, `total`, `grounded` fields |

### Supporting Utilities
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| next-intl | ^4.8.2 | i18n keys for status dot labels and accessibility text | For aria-label and title attributes on status dots |

**Installation:** No new packages required. All dependencies already in package.json.

## Architecture Patterns

### Recommended Project Structure

The question list enhancement integrates into the existing InsightsOverview component:

```
components/extraction/
├── insights-overview.tsx          # Main component — question list container
├── question-list-item.tsx         # NEW: Status dot + progress bar component
└── ... (other components)

lib/extraction/
├── question-status.ts             # NEW: statusFromCompletion() utility
└── bar-scaling.ts                 # Existing scaling utilities
```

### Pattern 1: Status Dot Rendering

**What:** A small colored circle positioned left of the question name, indicating completion state.

**When to use:** Always visible on each question item; no hover/interaction required.

**Implementation:**
```typescript
// lib/extraction/question-status.ts
export type QuestionStatus = 'complete' | 'partial' | 'empty';

export function statusFromCompletion(answered: number, total: number): QuestionStatus {
  if (total === 0) return 'empty';
  if (answered === total) return 'complete';
  if (answered > 0) return 'partial';
  return 'empty';
}

export const STATUS_DOT_COLORS: Record<QuestionStatus, string> = {
  complete: '#10b981',  // green (matches CITATION_STATUS_COLORS.grounded)
  partial: '#f59e0b',   // yellow (matches CITATION_STATUS_COLORS.best_effort)
  empty: '#d1d5db',     // grey (matches muted-foreground)
} as const;

export const STATUS_DOT_LABELS: Record<QuestionStatus, string> = {
  complete: 'statusDotComplete',     // "All papers answered"
  partial: 'statusDotPartial',       // "Partial answers"
  empty: 'statusDotEmpty',           // "No answers"
} as const;
```

**Why this works:**
- Color palette is already defined in Phase 85 (`CITATION_STATUS_COLORS`)
- i18n keys already exist in `messages/en-US.json` (lines 598-600)
- Status logic is deterministic from query data (no client-side state needed)

### Pattern 2: Mini Progress Bar Component

**What:** A compact horizontal progress bar showing answer coverage percentage, with percentage text displayed right of the bar.

**When to use:** Alongside the status dot on each question item in the collapsed list.

**Implementation:**
```typescript
// components/extraction/question-list-item.tsx
import { Progress } from "@/components/ui/progress";
import { useTranslations } from "next-intl";
import { statusFromCompletion, STATUS_DOT_COLORS } from "@/lib/extraction/question-status";

interface QuestionListItemProps {
  questionKey: string;
  question: string;
  answered: number;
  total: number;
  isSelected?: boolean;
  onClick?: () => void;
}

export function QuestionListItem({
  questionKey,
  question,
  answered,
  total,
  isSelected,
  onClick,
}: QuestionListItemProps) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");

  const status = statusFromCompletion(answered, total);
  const percentage = Math.round((answered / Math.max(total, 1)) * 100);
  const safeTotal = Math.max(total, 1);

  return (
    <button
      className={`w-full px-4 py-3 text-left hover:bg-muted/20 transition-colors flex items-center gap-3 ${
        isSelected ? "bg-primary/5" : ""
      }`}
      onClick={onClick}
      aria-label={`${question}, ${percentage}% complete`}
    >
      {/* Status dot */}
      <div
        className="w-3 h-3 rounded-full shrink-0"
        style={{ backgroundColor: STATUS_DOT_COLORS[status] }}
        title={t(STATUS_DOT_LABELS[status])}
        aria-hidden="true"
      />

      {/* Question text and badges (existing) */}
      <div className="flex-1 min-w-0">
        <div className="font-medium">{question}</div>
      </div>

      {/* Progress bar + percentage (new) */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-24" style={{ minWidth: '100px' }}>
          <Progress
            value={percentage}
            aria-label={`Answer coverage for ${question}`}
            aria-valuenow={answered}
            aria-valuemin={0}
            aria-valuemax={safeTotal}
          />
        </div>
        <span className="text-xs font-mono text-muted-foreground w-10 text-right">
          {percentage}%
        </span>
      </div>
    </button>
  );
}
```

**Why this works:**
- Progress component is accessible (Radix UI primitive)
- Uses existing Progress component from `components/ui/progress.tsx`
- aria-valuenow/valuemin/valuemax provide ARIA 1.0 semantics
- Percentage text is never NaN (uses Math.max guard)
- 0% displays correctly when answered=0

### Pattern 3: InsightsOverview Integration

**What:** Replace the existing question button loop with a call to the new QuestionListItem component.

**Current code (lines 111-128 of insights-overview.tsx):**
```typescript
{questions.map((question) => (
  <button
    key={question.key}
    className={`w-full px-4 py-3 text-left hover:bg-muted/20 transition-colors ${
      selectedQuestionKey === question.key ? "bg-primary/5" : ""
    }`}
    onClick={() => onSelectQuestion(question.key)}
  >
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="font-medium">{question.question}</div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {/* existing badges */}
      </div>
    </div>
  </button>
))}
```

**Refactored approach:**
```typescript
{questions.map((question) => (
  <QuestionListItem
    key={question.key}
    questionKey={question.key}
    question={question.question}
    answered={question.answered}
    total={question.total}
    isSelected={selectedQuestionKey === question.key}
    onClick={() => onSelectQuestion(question.key)}
  />
))}
```

### Anti-Patterns to Avoid

- **Don't put the progress bar in a separate popover:** Users should see the progress bar in the collapsed state, not require hover/click interaction.
- **Don't round 0% to 1%:** When a question has zero answers, display 0% exactly (not a fallback like "—" or a minimum width of 1%).
- **Don't use CSS-only progress bars without ARIA:** The Radix Progress component ensures screen reader compatibility; hand-rolling a bar risks missing accessibility.
- **Don't calculate percentage in the parent:** Extract percentage calculation into QuestionListItem so the component is self-contained and testable.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Accessible progress bar | Custom div-based bar with width styling | Radix UI Progress component | Radix handles aria-valuenow, aria-valuemin, aria-valuemax, and focus management automatically |
| Status dot color logic | Magic hex strings scattered in component | Centralized STATUS_DOT_COLORS object in question-status.ts | Single source of truth; matches design system colors from Phase 85 |
| I18n labels for status | Hardcoded English strings | Use next-intl with STATUS_DOT_LABELS key map | Ensures translations exist across all 6 locales; i18n keys already added in Phase 83 |
| Progress percentage calculation | Inline `(answered / total) * 100` | Wrap in `statusFromCompletion()` + percentage utility | Guards against division by zero, rounding, and NaN edge cases |

**Key insight:** The progress bar visualization is complex enough to require ARIA attributes and percentage edge-case handling, but simple enough that the existing Radix Progress primitive handles it. The only custom code needed is status determination and layout composition.

## Common Pitfalls

### Pitfall 1: Percentage Showing NaN When Question Has Zero Total Papers

**What goes wrong:** If a question has `total === 0` or `total` is undefined, the percentage calculation `(answered / total) * 100` produces NaN or Infinity, which breaks the progress bar and ARIA attributes.

**Why it happens:** The query data might include questions with zero papers in edge cases, or a race condition during data loading.

**How to avoid:** Always use `Math.max(total, 1)` as the divisor, and validate percentage is finite before passing to Progress component.

**Warning signs:** Browser console shows NaN or Infinity; progress bar doesn't render or renders at full width unexpectedly; aria-valuemax shows NaN.

**Verification command (in tests):**
```typescript
const answered = 0, total = 0;
const percentage = Math.round((answered / Math.max(total, 1)) * 100);
expect(percentage).toBe(0); // not NaN
expect(Number.isFinite(percentage)).toBe(true);
```

### Pitfall 2: Status Dot Color Drift

**What goes wrong:** The status dot uses a slightly different green (#10b980) than the bar visualization (#10b981), causing a visual inconsistency.

**Why it happens:** Hex values are copied from different sources without sharing a single constant.

**How to avoid:** Define STATUS_DOT_COLORS and CITATION_STATUS_COLORS in the same file or import one from the other. Phase 85 already defines CITATION_STATUS_COLORS in `lib/extraction/bar-scaling.ts`; reuse it.

**Warning signs:** The status dot green looks slightly different from grounded-status bar green; design QA flag it during review.

**Verification command (in tests):**
```typescript
import { CITATION_STATUS_COLORS } from "@/lib/extraction/bar-scaling";
import { STATUS_DOT_COLORS } from "@/lib/extraction/question-status";
expect(STATUS_DOT_COLORS.complete).toBe(CITATION_STATUS_COLORS.grounded);
```

### Pitfall 3: Progress Bar Width Overflow in Tight Layouts

**What goes wrong:** The mini progress bar + percentage text extends beyond the button width, pushing the question text off-screen or creating horizontal scroll.

**Why it happens:** The progress bar and percentage are wrapped in a flex container that doesn't shrink, and the parent button doesn't have enough space.

**How to avoid:** Use `shrink-0` on the progress bar + percentage container to prevent flex growth, and set a fixed width (e.g., `w-32` or `w-40`). Test on small viewports (mobile).

**Warning signs:** Horizontal scrollbar appears on question list; text is cut off; responsive design breaks below 768px.

**Verification command (in visual tests):**
```typescript
// Render at different widths
const { rerender } = render(<InsightsOverview ... />);
// Inspect <button> width at 320px, 768px, 1024px viewports
// Verify progress bar + percentage don't overflow
```

### Pitfall 4: Aria-valuenow Shows answered Count, Not Percentage

**What goes wrong:** The aria-valuenow attribute shows the raw `answered` count (e.g., 5) instead of the percentage (e.g., 50), confusing screen readers.

**Why it happens:** Copy-paste from tooltip code where raw counts are appropriate, or misunderstanding ARIA attributes.

**How to avoid:** Pass `aria-valuenow={answered}` (the actual count), not the percentage. The screen reader will announce "5 of 10", not "50%". Separately set `aria-valuemin` and `aria-valuemax` for context.

**Warning signs:** Screen reader announces "50 out of 100" when there are only 10 papers; percentage doesn't match ARIA announcement.

**Verification command (in a11y tests):**
```typescript
const bar = screen.getByRole("progressbar", { name: /Answer coverage/ });
expect(bar).toHaveAttribute("aria-valuenow", "5");
expect(bar).toHaveAttribute("aria-valuemax", "10");
// Screen reader announces: "5 of 10" (or similar)
```

## Code Examples

Verified patterns from official sources:

### Example 1: Status Utility Module

```typescript
// lib/extraction/question-status.ts
// Source: Phase 85 bar-scaling.ts pattern; Radix UI documentation

export type QuestionStatus = 'complete' | 'partial' | 'empty';

/**
 * Determines question completion status based on answered/total ratio.
 *
 * - complete: all papers answered (answered === total)
 * - partial: some papers answered (0 < answered < total)
 * - empty: no papers answered (answered === 0)
 */
export function statusFromCompletion(answered: number, total: number): QuestionStatus {
  if (total === 0) return 'empty';
  if (answered === total) return 'complete';
  if (answered > 0) return 'partial';
  return 'empty';
}

/** Centralized colors matching Phase 85 CITATION_STATUS_COLORS */
export const STATUS_DOT_COLORS: Record<QuestionStatus, string> = {
  complete: '#10b981',  // green
  partial: '#f59e0b',   // yellow
  empty: '#d1d5db',     // grey
} as const;

/** I18n key map for ARIA labels and tooltips */
export const STATUS_DOT_LABELS: Record<QuestionStatus, string> = {
  complete: 'statusDotComplete',
  partial: 'statusDotPartial',
  empty: 'statusDotEmpty',
} as const;

/**
 * Calculates percentage of papers answered, always returning a finite number.
 * Guards against division by zero and NaN.
 */
export function getAnswerPercentage(answered: number, total: number): number {
  const safeDivisor = Math.max(total, 1);
  return Math.round((answered / safeDivisor) * 100);
}
```

### Example 2: Progress Bar Radix Integration

```typescript
// components/extraction/question-list-item.tsx
// Source: components/ui/progress.tsx (existing Radix wrapper) + Phase 85 patterns

import { Progress } from "@/components/ui/progress";
import { useTranslations } from "next-intl";
import {
  statusFromCompletion,
  STATUS_DOT_COLORS,
  STATUS_DOT_LABELS,
  getAnswerPercentage,
} from "@/lib/extraction/question-status";

interface QuestionListItemProps {
  questionKey: string;
  question: string;
  answered: number;
  total: number;
  isSelected?: boolean;
  onClick?: () => void;
}

export function QuestionListItem({
  questionKey,
  question,
  answered,
  total,
  isSelected = false,
  onClick,
}: QuestionListItemProps) {
  const t = useTranslations("extraction");

  const status = statusFromCompletion(answered, total);
  const percentage = getAnswerPercentage(answered, total);
  const safeTotal = Math.max(total, 1);

  return (
    <button
      key={questionKey}
      className={`w-full px-4 py-3 text-left hover:bg-muted/20 transition-colors flex items-center gap-3 ${
        isSelected ? "bg-primary/5" : ""
      }`}
      onClick={onClick}
    >
      {/* Status dot */}
      <div
        className="w-3 h-3 rounded-full shrink-0"
        style={{ backgroundColor: STATUS_DOT_COLORS[status] }}
        title={t(STATUS_DOT_LABELS[status])}
        aria-hidden="true"
      />

      {/* Question name */}
      <div className="flex-1 min-w-0 font-medium">{question}</div>

      {/* Progress bar + percentage text (Phase 86 new) */}
      <div className="flex items-center gap-2 shrink-0 w-40">
        <div className="flex-1">
          <Progress
            value={percentage}
            aria-valuenow={answered}
            aria-valuemin={0}
            aria-valuemax={safeTotal}
            aria-label={`Answer coverage: ${percentage}%`}
          />
        </div>
        <span className="text-xs font-mono text-muted-foreground w-10 text-right">
          {percentage}%
        </span>
      </div>
    </button>
  );
}
```

### Example 3: InsightsOverview Refactoring

```typescript
// components/extraction/insights-overview.tsx (snippet)
// Source: Phase 86 refactoring of existing question list

import { QuestionListItem } from "./question-list-item";

export function InsightsOverview({
  jobId,
  selectedQuestionKey,
  onSelectQuestion,
  // ...
}: InsightsOverviewProps) {
  // ... existing code ...

  return (
    <div className="space-y-4">
      {/* ... SummaryCards, diagnostics ... */}

      <div className="rounded-lg border border-border/50 bg-card">
        <div className="border-b border-border/50 px-4 py-3 text-sm font-medium">
          {t("questionLevelInsights")}
        </div>
        <div className="divide-y divide-border/40">
          {questions.map((question) => (
            <QuestionListItem
              key={question.key}
              questionKey={question.key}
              question={question.question}
              answered={question.answered}
              total={question.total}
              isSelected={selectedQuestionKey === question.key}
              onClick={() => onSelectQuestion(question.key)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Badge-only metrics on questions | Status dots + progress bars on collapsed items | Phase 86 | Improves scannability — users see progress at a glance without expanding |
| Full badge metrics per question | Minimal badges + visual indicators | Phase 86 | Reduces visual clutter while improving information density |
| Manual HTML progress bars | Radix UI Progress primitive | Phase 85+ | Better accessibility, consistent ARIA; no custom implementation needed |

**Deprecated/outdated:**
- None — this is a new feature.

## Open Questions

1. **Progress bar width on mobile**
   - What we know: Progress bar + percentage should fit in collapsed question list on mobile screens
   - What's unclear: Is 100px fixed width sufficient for all screen sizes, or should it be responsive?
   - Recommendation: Default to w-24 (96px) with a media query breakpoint; test at 320px, 768px, 1024px viewports before final approval

2. **Status dot accessibility vs. visual design**
   - What we know: Status dot should be aria-hidden (visual indicator only); ARIA label on the button itself describes the status
   - What's unclear: Should the tooltip (title attribute) on the dot say "Complete" or full text like "All papers answered"?
   - Recommendation: Use short label (e.g., "Complete") on title, full label in button aria-label; avoid redundancy

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.4 + @testing-library/react |
| Config file | vitest.config.ts |
| Quick run command | `npm test -- question-status.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QLIST-01 | Status dot shows correct color for complete/partial/empty state | unit | `npm test -- question-status.test.ts -t "statusFromCompletion"` | ❌ Wave 0 |
| QLIST-01 | Status dot renders on question list item | unit | `npm test -- question-list-item.test.tsx -t "renders status dot"` | ❌ Wave 0 |
| QLIST-02 | Progress bar renders with correct percentage value | unit | `npm test -- question-list-item.test.tsx -t "renders progress bar"` | ❌ Wave 0 |
| QLIST-02 | Progress bar shows 0% (not NaN) when answered=0 | unit | `npm test -- question-status.test.ts -t "handles zero answered"` | ❌ Wave 0 |
| QLIST-02 | aria-valuenow, aria-valuemin, aria-valuemax present on progress | a11y | `npm test -- question-list-item.test.tsx -t "aria attributes"` | ❌ Wave 0 |
| QLIST-03 | Question list renders without expand/collapse controls | integration | `npm test -- extraction-insights-overview.test.tsx -t "question list scannable"` | ❌ Wave 0 |
| QLIST-03 | Progress bar and status dot visible in collapsed state | integration | `npm test -- extraction-insights-overview.test.tsx -t "visual indicators visible"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- question-status.test.ts && npm test -- question-list-item.test.tsx`
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green + visual regression check before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/question-status.test.ts` — utility functions and edge cases for statusFromCompletion, getAnswerPercentage
- [ ] `tests/question-list-item.test.tsx` — component rendering, ARIA attributes, responsive layout
- [ ] Update `tests/extraction-insights-overview.test.tsx` — verify new QuestionListItem integration, remove old badge assertions
- [ ] No additional framework install needed — vitest and @testing-library/react already in place

## Sources

### Primary (HIGH confidence)
- **Phase 85 research & implementation** — status dot colors align with CITATION_STATUS_COLORS hex values (verified in bar-scaling.ts)
- **Radix UI Progress component** (components/ui/progress.tsx) — already integrated; tested in codebase
- **existing i18n keys** (messages/en-US.json lines 598-600) — statusDotComplete, statusDotPartial, statusDotEmpty already defined in Phase 83

### Secondary (MEDIUM confidence)
- **Radix UI documentation** — Progress component ARIA attributes (aria-valuenow, aria-valuemin, aria-valuemax)
- **Existing component patterns** (InsightsOverview, InsightsQuestionPanel, StackedAnswerBars) — testing patterns via vi.mock, component structure

### Tertiary (LOW confidence)
- None — all critical findings verified against codebase and official documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies already in package.json; Radix Progress and Tailwind CSS established
- Architecture: HIGH — integrates cleanly into existing InsightsOverview without query changes
- Pitfalls: HIGH — edge cases (NaN, color drift, layout overflow, ARIA values) documented with verification commands
- i18n: HIGH — keys already defined in Phase 83; no missing translations

**Research date:** 2026-03-10
**Valid until:** 2026-03-20 (stable domain, no breaking changes expected in Radix UI or Tailwind within 10 days)
