# Phase 84: Summary Cards & Confidence Display - Research

**Researched:** 2026-03-10
**Domain:** React component refactoring, color-coded threshold displays, tooltip UX patterns, i18n integration
**Confidence:** HIGH

## Summary

Phase 84 focuses on refactoring the extraction insights overview to improve scannability and fix data representation issues. The phase involves two primary UI changes:

1. **Summary Cards Reordering & Theming:** Reorder the 4 summary metric cards from current layout (answered, grounded, best effort, no content) to prioritize actionable metrics (completion + quality before secondary metrics), add color accents (green/yellow/red) based on metric thresholds, and contextualize misleading metrics.

2. **Confidence Display Refactoring:** Replace the confusing "effective confidence" metric with a single contextual confidence badge that clearly explains why the value is what it is (abstract-only cap, full-text available, or no content). The badge uses color thresholds (green >=85%, yellow 60-84%, red <60%) to signal quality at a glance.

Both changes build on Phase 83 foundation: i18n keys are pre-defined, component tests are refactored to structural assertions, and the extraction insights data model provides all necessary metrics. The implementation uses existing Radix UI + Tailwind patterns with no new dependencies.

**Primary recommendation:** Reorder cards by impact (completion % first, then quality metrics), add threshold-based color accents using a compact threshold lookup, and implement confidence badge as a dual-element component (percentage + tooltip explaining source). Use existing i18n infrastructure with keys from Phase 83.

## User Constraints

None — Phase 84 is the second phase of v5.0 milestone with no prior phase-specific decisions documented in CONTEXT.md.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CARD-01 | Summary cards reordered to prioritize actionable metrics (completion, quality) | Card reordering pattern, threshold-based priority ranking |
| CARD-02 | Cards display color accents (green/yellow/red) based on value thresholds, visible without interaction | Threshold lookup pattern, Tailwind color utilities, visual indicator best practices |
| CARD-03 | Misleading metrics contextualized or hidden based on data source | Abstract-only and no-content detection from query data, conditional rendering |
| CONF-01 | "Effective confidence" replaced with single contextual confidence badge | Badge component pattern, tooltip implementation, confidence calculation source |
| CONF-02 | Badge tooltip explains source (abstract-only cap, full-text, no content) | i18n message formatting, tooltip trigger patterns, citation status mapping |
| CONF-03 | Badge color-coded: green >=85%, yellow 60-84%, red <60% | Threshold color mapping, re-use pattern from CARD-02 |

## Standard Stack

### Core UI Components
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **Radix UI** | ^1.4.3 | Headless component primitives (Tooltip, Popover) | Already used throughout codebase; accessible by default |
| **Tailwind CSS** | ^4 | Utility CSS framework | Project standard; color palette, responsive utilities |
| **next-intl** | ^4.8.2 | Translation framework | Already integrated; provides useTranslations() hook |
| **Lucide React** | ^0.487.0 | Icon library | Already used; HelpCircle icon for confidence tooltip trigger |

### Component Library Files
| Component | Path | Exports | Why Use |
|-----------|------|---------|---------|
| **Card** | `components/ui/card.tsx` | Card, CardContent, CardHeader, CardTitle | Styled wrapper for metric cards |
| **Badge** | `components/ui/badge.tsx` | Badge with variants | Existing pattern for summary metrics |
| **Tooltip** | `components/ui/tooltip.tsx` | Tooltip provider, Tooltip, TooltipTrigger, TooltipContent | Radix-based, handles positioning and accessibility |
| **Button** | `components/ui/button.tsx` | Button with variants and sizes | Existing pattern for interactive elements |

### Data & Testing
| Library | Version | Purpose | Existing Patterns |
|---------|---------|---------|------------------|
| **Vitest** | ^3.2.4 | Test runner | Used in Phase 83; structural assertion pattern |
| **@testing-library/react** | ^16.3.2 | DOM testing | Phase 83 pattern; render + screen queries |
| **@testing-library/jest-dom** | ^6.9.1 | DOM matchers | Phase 83 pattern; toBeInTheDocument, toHaveClass |

### i18n Keys (from Phase 83)
| Key | Value (en-US) | Purpose |
|-----|---------------|---------|
| `confidenceAbstractOnly` | "Abstract-only extraction" | Label when all papers are abstract-only |
| `confidenceNoContent` | "No content available" | Label when papers have no content |
| `confidenceCapExplained` | "Confidence is capped at 70% for abstract-only papers — full-text access improves accuracy" | Tooltip text explaining confidence ceiling |
| `barScalingWarning` | "Small sample" | (Phase 85, included for context) |
| (existing keys) | Various | answered, grounded, bestEffort, noContentPapers, etc. |

**Installation:** All dependencies already present in package.json; no new `npm install` needed.

## Architecture Patterns

### Pattern 1: Threshold-Based Color Mapping
**What:** Map numeric values to color accents (green/yellow/red) using threshold comparisons. Used for summary card accents and confidence badge color.

**When to use:** Whenever metric values need visual urgency indicators without requiring interaction.

**Example:**
```typescript
// lib/extraction/card-thresholds.ts (NEW FILE)
export const CONFIDENCE_THRESHOLDS = {
  green: 0.85,   // >= 85%
  yellow: 0.6,   // 60-84%
  red: 0,        // < 60%
} as const;

export type ThresholdColor = "green" | "yellow" | "red";

export function getConfidenceColor(value: number): ThresholdColor {
  if (value >= CONFIDENCE_THRESHOLDS.green) return "green";
  if (value >= CONFIDENCE_THRESHOLDS.yellow) return "yellow";
  return "red";
}

export const CARD_THRESHOLDS = {
  completion: { green: 0.75, yellow: 0.5, red: 0 },      // answered rate
  quality: { green: 0.7, yellow: 0.5, red: 0 },           // grounded + best effort rate
  groundedness: { green: 0.6, yellow: 0.3, red: 0 },      // grounded rate only
} as const;

export function getCardColor(metricType: keyof typeof CARD_THRESHOLDS, value: number): ThresholdColor {
  const thresholds = CARD_THRESHOLDS[metricType];
  if (value >= thresholds.green) return "green";
  if (value >= thresholds.yellow) return "yellow";
  return "red";
}
```

**Why:** Centralized threshold logic prevents duplication. Constants are easily testable and adjustable. Pattern used in screening jobs (STATE.md notes minScore thresholds follow same principle).

### Pattern 2: Confidence Contextual Badge Component
**What:** Single component that renders confidence percentage + color + tooltip explaining source. Tooltip content varies based on citation status mix (grounded, best_effort, insufficient_evidence, extraction_error).

**When to use:** Display overall job confidence in insights overview, replacing previous "effective confidence" metric.

**Example:**
```typescript
// components/extraction/confidence-badge.tsx (NEW FILE)
"use client";

import { useTranslations } from "next-intl";
import { HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export interface ConfidenceBadgeProps {
  value: number; // 0-1
  abstractOnlyCount: number;
  noContentCount: number;
  totalPapers: number;
}

export function ConfidenceBadge({
  value,
  abstractOnlyCount,
  noContentCount,
  totalPapers,
}: ConfidenceBadgeProps) {
  const t = useTranslations("extraction");

  // Determine tooltip message based on data composition
  let tooltipKey: "confidenceAbstractOnly" | "confidenceNoContent" | "confidence";
  if (abstractOnlyCount === totalPapers && abstractOnlyCount > 0) {
    tooltipKey = "confidenceAbstractOnly";
  } else if (noContentCount === totalPapers && noContentCount > 0) {
    tooltipKey = "confidenceNoContent";
  } else {
    // Mixed or full-text available
    tooltipKey = "confidence"; // Falls back to existing key or uses cap-explanation
  }

  const color = getConfidenceColor(value);
  const variant = color === "green" ? "default" : color === "yellow" ? "outline" : "destructive";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={variant} className="cursor-help flex items-center gap-1">
          {Math.round(value * 100)}%
          <HelpCircle className="h-3 w-3" />
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <div className="max-w-xs">
          {tooltipKey === "confidenceAbstractOnly" && (
            <>
              <p className="font-medium">{t("confidenceAbstractOnly")}</p>
              <p className="text-xs text-muted-foreground mt-1">{t("confidenceCapExplained")}</p>
            </>
          )}
          {tooltipKey === "confidenceNoContent" && (
            <p className="font-medium">{t("confidenceNoContent")}</p>
          )}
          {tooltipKey === "confidence" && (
            <p className="text-sm">{t("confidenceCapExplained")}</p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
```

**Why:** Combines two concerns (display + explanation) into single component. Tooltip avoids cluttering layout while providing context for confusing metric. Message varies contextually so users understand why confidence is capped.

### Pattern 3: Metric Card Reordering with Conditional Rendering
**What:** Grid layout with cards in prioritized order: (1) answered % (completion), (2) grounded % (quality), (3) best effort % (secondary quality), (4) no content count (diagnostic). Optionally hide "no content" if zero, or conditionally show confidence badge instead of "effective confidence" metric.

**When to use:** Refactoring summary card section; Phase 84 focus.

**Example:**
```typescript
// components/extraction/summary-cards.tsx (NEW FILE)
"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { ConfidenceBadge } from "./confidence-badge";

export interface SummaryCardsProps {
  answeredRate: number;
  groundedRate: number;
  bestEffortRate: number;
  noContentCount: number;
  totalPapers: number;
  abstractOnlyCount: number;
  averageConfidence: number;
  averageEffectiveConfidence: number;
}

export function SummaryCards({
  answeredRate,
  groundedRate,
  bestEffortRate,
  noContentCount,
  totalPapers,
  abstractOnlyCount,
  averageConfidence,
  averageEffectiveConfidence,
}: SummaryCardsProps) {
  const t = useTranslations("common");
  const te = useTranslations("extraction");

  // Card order: completion → quality → secondary → diagnostic
  const cards = [
    {
      label: t("answered"),
      value: `${Math.round(answeredRate * 100)}%`,
      priority: 1,
      visible: true,
    },
    {
      label: t("grounded"),
      value: `${Math.round(groundedRate * 100)}%`,
      priority: 2,
      visible: true,
    },
    {
      label: te("bestEffort"),
      value: `${Math.round(bestEffortRate * 100)}%`,
      priority: 3,
      visible: bestEffortRate > 0, // Hide if zero
    },
    {
      label: t("noContentPapers"),
      value: String(noContentCount),
      priority: 4,
      visible: noContentCount > 0, // Hide if zero
    },
  ].sort((a, b) => a.priority - b.priority).filter((c) => c.visible);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className={`border-l-4 ${getCardBorderColor(...)}`}>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">{card.label}</div>
            <div className="text-xl font-semibold mt-2">{card.value}</div>
          </CardContent>
        </Card>
      ))}
      {/* Confidence badge replaces "effective confidence" card */}
      <Card className="border-l-4 border-blue-400">
        <CardContent className="pt-4">
          <div className="text-xs text-muted-foreground">{te("confidence")}</div>
          <div className="mt-2">
            <ConfidenceBadge
              value={averageConfidence}
              abstractOnlyCount={abstractOnlyCount}
              noContentCount={noContentCount}
              totalPapers={totalPapers}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function getCardBorderColor(value: number, metricType: string): string {
  const color = getCardColor(metricType, value);
  return {
    green: "border-green-400",
    yellow: "border-yellow-400",
    red: "border-red-400",
  }[color];
}
```

**Why:** Establishes clear visual hierarchy (most actionable metrics first). Border accents provide quick visual scan without slowing reading. Conditional rendering removes zero-value metrics to reduce clutter. Confidence badge consolidates two related metrics (average + effective) into one contextual display.

### Pattern 4: Citation Status → Tooltip Message Mapping
**What:** Map the citation status mix (grounded, best_effort, insufficient_evidence, extraction_error) to human-friendly tooltip explanations without requiring component logic to know the details.

**When to use:** Explaining why confidence is low or capped.

**Example:**
```typescript
// lib/extraction/confidence-messages.ts (NEW FILE)
import type { CitationStatusMix } from "./insights";

export function getConfidenceTooltipKey(
  citationMix: CitationStatusMix,
  abstractOnlyCount: number,
  noContentCount: number,
  totalPapers: number
): "confidenceAbstractOnly" | "confidenceNoContent" | "confidence" {
  // All abstract-only → explain the 70% cap
  if (abstractOnlyCount === totalPapers && abstractOnlyCount > 0) {
    return "confidenceAbstractOnly";
  }

  // All no-content → explain lack of evidence
  if (noContentCount === totalPapers && noContentCount > 0) {
    return "confidenceNoContent";
  }

  // Mixed sources → use general explanation (cap for abstract-only subset)
  if (abstractOnlyCount > 0) {
    return "confidenceAbstractOnly"; // Warn that subset is capped
  }

  // All full-text or error → explain basis
  return "confidence";
}
```

**Why:** Separates data analysis from UI rendering. Tooltip logic is pure function, testable without components. Message keys align with i18n keys from Phase 83, ensuring translations stay in sync.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| **Color threshold logic** | Custom conditionals in every card component | Centralized `getCardColor()` and `getConfidenceColor()` functions in `lib/extraction/card-thresholds.ts` | Prevents threshold drift; single source of truth for color decisions |
| **Tooltip positioning** | Custom CSS/JS for tooltip placement | Radix UI Tooltip (already in components/ui/) | Handles viewport boundaries, focus management, animation; accessible by default |
| **Icon for confidence help** | Custom SVG or generic icon | Lucide React HelpCircle (already in package.json) | Consistent with project icon library; small, clear, universally understood |
| **Badge color variants** | Custom className logic | Existing Badge component from components/ui/badge.tsx with variant prop | DRY; enforces color consistency with rest of app |
| **i18n message formatting** | String concatenation or template literals | next-intl useTranslations() + ICU message syntax in JSON files | Supports pluralization, dynamic values, future RTL; Phase 83 keys already prepared |
| **Conditional rendering based on metrics** | Ternary operators scattered in JSX | Pure functions like `shouldHideZeroMetrics()`, `getVisibleCards()` | Easier to test; clearer intent; parameters explicit |

**Key insight:** Phase 83 and existing component library provide 90% of infrastructure. Phase 84 is primarily composition + conditional rendering. The only "new" piece is threshold logic, which is 20 lines of pure functions.

## Common Pitfalls

### Pitfall 1: Hard-Coding Confidence Thresholds in Multiple Files
**What goes wrong:** Confidence color thresholds (>=85% green, 60-84% yellow, <60% red) get hard-coded in multiple card components. Later, if threshold changes (e.g., move yellow to 70%), developers must find and update every location. Colors drift and become inconsistent.

**Why it happens:** Threshold logic is small enough to write inline in each component. Feels simpler than extracting to a utility function.

**How to avoid:** Define all thresholds in `lib/extraction/card-thresholds.ts`. Export as constants and pure functions. Import the functions in components, never re-implement the logic.

**Warning signs:** Finding different threshold numbers in different files. Git history showing threshold changes in multiple unrelated files. Test failures after threshold adjustment in one place but not others.

### Pitfall 2: Confusing "Confidence" with "Effective Confidence"
**What goes wrong:** The query returns both `averageConfidence` and `averageEffectiveConfidence`. Developer displays both or mixes them up. UI shows two nearly identical percentages with different meanings. Users think the data is wrong or redundant.

**Why it happens:** Query exposes both metrics; unclear which one is "right" for display. Effective confidence adjusts base confidence by citation status (grounded=1x, best_effort=0.55x, insufficient=0x). Easy to assume both should be visible.

**How to avoid:** Phase 84 scope: display only base `averageConfidence` (not effective). Confidence badge tooltip explains why it might be lower (abstract-only cap). Effective confidence is used internally for scoring/filtering in future phases (Phase 85+); Phase 84 UI doesn't surface it.

**Warning signs:** Test showing both metrics side-by-side in the component. Metric card repeating same percentage twice. User feedback saying "why are there two confidence numbers?"

### Pitfall 3: Color Accents Too Subtle to Notice
**What goes wrong:** Implemented color accents on cards as a 1px border or faint background. Users don't see them; cards still look monochrome. Accessibility feature (color urgency cue) fails to function.

**How to avoid:** Left border accent (4-6px thick, full card height) or card background tint. Border approach is less visually heavy; background approach works for dark mode. Test with grayscale vision simulator (Chrome DevTools > Rendering > Emulate vision deficiency).

**Warning signs:** Color changes on cards not visible in small preview. Users report "I didn't notice the colors." Cards with yellow vs red warning don't feel different.

### Pitfall 4: Tooltip Explaining "Effective Confidence" Instead of Data Source
**What goes wrong:** Tooltip says "Effective confidence accounts for citation status" (explaining the metric) instead of "Your papers are all abstract-only; confidence capped at 70%" (explaining the context). User reads tooltip and is still confused why their 95% raw confidence shows as 70%.

**How to avoid:** Tooltip focuses on WHY the value is what it is, not what confidence means. Use the citation status mix and abstract-only count to choose appropriate message. Phase 83 provides i18n key `confidenceCapExplained` for this exact purpose.

**Warning signs:** Tooltip uses jargon like "multiplier," "grounded," "best effort." User feedback saying tooltip didn't help. Test assertions checking that tooltip says "confidence is capped at" (correct) vs "effective confidence multiplier is" (wrong).

### Pitfall 5: Hidden Metrics Breaking Accessibility or Scannability
**What goes wrong:** Hide zero-value cards (e.g., no bestEffort answers means no best effort card). Layout becomes ragged; users can't rely on card position. On mobile, grid collapses unpredictably. Screenreaders skip cards without DOM elements.

**How to avoid:** Hide via CSS display:none (semantic grid still has 4 cards, some hidden) or conditionally render (truly removes DOM). Choose consistently. Test both with and without zero values. Ensure order is always: answered, grounded, best effort, no content. Never let conditional rendering reorder cards.

**Warning signs:** Desktop shows 3 cards wide, mobile shows 4. Clicking to sort or re-order shows different card positions. Screenreader tests fail due to missing elements.

### Pitfall 6: Not Accounting for All-Error Papers
**What goes wrong:** Query has `citationStatusMix` with `extraction_error` count. Phase 84 UI assumes data comes from "grounded" or "best_effort". If a run fails and all papers are extraction_error, the confidence badge tooltip doesn't match reality (not abstract-only, not no-content, not full-text). Shows generic message.

**How to avoid:** Citation message function should handle all four status types. If `extraction_error` > 50% of total, explain that extraction failed (different message than abstract-only cap). Test with mock data where all papers have extraction_error.

**Warning signs:** Tooltip doesn't explain why confidence is 0% when all papers are errors. Missing `extraction_error` handling in confidence-messages.ts. Test with only error papers shows unexpected tooltip text.

## Code Examples

Verified patterns from existing codebase and Phase 83 foundations:

### Example 1: Basic Threshold Color Function
```typescript
// Source: Phase 84 research, pattern similar to minScore threshold logic in v4.1 (STATE.md)

// lib/extraction/card-thresholds.ts
export const CONFIDENCE_THRESHOLDS = {
  green: 0.85,
  yellow: 0.6,
  red: 0,
} as const;

export type ThresholdColor = keyof typeof CONFIDENCE_COLORS;

export const CONFIDENCE_COLORS = {
  green: "bg-green-50 border-l-4 border-green-400 text-green-900",
  yellow: "bg-yellow-50 border-l-4 border-yellow-400 text-yellow-900",
  red: "bg-red-50 border-l-4 border-red-400 text-red-900",
} as const;

export function getConfidenceColor(value: number): ThresholdColor {
  if (value >= CONFIDENCE_THRESHOLDS.green) return "green";
  if (value >= CONFIDENCE_THRESHOLDS.yellow) return "yellow";
  return "red";
}

// Usage in component:
const color = getConfidenceColor(0.75); // Returns "yellow"
const className = CONFIDENCE_COLORS[color]; // Returns class string
<div className={className}>75% Confidence</div>
```

### Example 2: Structural Component Test (Pattern from Phase 83)
```typescript
// Source: Phase 83 extraction-insights-overview.test.tsx pattern

// tests/summary-cards.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SummaryCards } from "@/components/extraction/summary-cards";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("SummaryCards", () => {
  it("renders all visible metric cards in correct order", () => {
    const { container } = render(
      <SummaryCards
        answeredRate={0.8}
        groundedRate={0.6}
        bestEffortRate={0.15}
        noContentCount={2}
        totalPapers={10}
        abstractOnlyCount={0}
        averageConfidence={0.75}
        averageEffectiveConfidence={0.65}
      />
    );

    // Should have at least 4 cards (answered, grounded, bestEffort, noContent)
    const cards = container.querySelectorAll('[role="article"]'); // Card is article-like
    expect(cards.length).toBeGreaterThanOrEqual(4);

    // Check order: answered first, then grounded
    const textContent = container.textContent;
    const answeredIndex = textContent.indexOf("answered");
    const groundedIndex = textContent.indexOf("grounded");
    expect(answeredIndex).toBeLessThan(groundedIndex);
  });

  it("hides zero-value best effort card", () => {
    const { container } = render(
      <SummaryCards
        answeredRate={0.8}
        groundedRate={0.6}
        bestEffortRate={0}
        noContentCount={0}
        totalPapers={10}
        abstractOnlyCount={0}
        averageConfidence={0.75}
        averageEffectiveConfidence={0.65}
      />
    );

    // Should only have 2 cards: answered, grounded (best effort and no content hidden)
    const cards = container.querySelectorAll('[role="article"]');
    expect(cards.length).toBe(2);
  });

  it("renders confidence badge with correct color class", () => {
    render(
      <SummaryCards
        answeredRate={0.8}
        groundedRate={0.6}
        bestEffortRate={0.15}
        noContentCount={0}
        totalPapers={10}
        abstractOnlyCount={5} // Abstract only
        averageConfidence={0.7}
        averageEffectiveConfidence={0.55}
      />
    );

    const badge = screen.getByText(/70%/);
    expect(badge).toHaveClass("bg-yellow-50"); // 70% is in yellow range (60-84%)
  });
});
```

### Example 3: Confidence Badge Component with Tooltip
```typescript
// Source: Tooltip pattern from components/ui/tooltip.tsx (Radix UI)

// components/extraction/confidence-badge.tsx
"use client";

import { useTranslations } from "next-intl";
import { HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { getConfidenceColor } from "@/lib/extraction/card-thresholds";
import { getConfidenceTooltipKey } from "@/lib/extraction/confidence-messages";

export interface ConfidenceBadgeProps {
  value: number; // 0-1
  abstractOnlyCount: number;
  noContentCount: number;
  totalPapers: number;
}

export function ConfidenceBadge({
  value,
  abstractOnlyCount,
  noContentCount,
  totalPapers,
}: ConfidenceBadgeProps) {
  const t = useTranslations("extraction");

  const color = getConfidenceColor(value);
  const tooltipKey = getConfidenceTooltipKey(
    value,
    abstractOnlyCount,
    noContentCount,
    totalPapers
  );

  const badgeVariants = {
    green: "bg-green-100 text-green-900",
    yellow: "bg-yellow-100 text-yellow-900",
    red: "bg-red-100 text-red-900",
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          className={`${badgeVariants[color]} cursor-help flex items-center gap-1.5 px-3 py-1.5`}
        >
          <span className="text-sm font-semibold">{Math.round(value * 100)}%</span>
          <HelpCircle className="h-3.5 w-3.5 opacity-70" />
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="space-y-1">
          {tooltipKey === "confidenceAbstractOnly" && (
            <>
              <p className="font-medium text-sm">{t("confidenceAbstractOnly")}</p>
              <p className="text-xs text-muted-foreground">{t("confidenceCapExplained")}</p>
            </>
          )}
          {tooltipKey === "confidenceNoContent" && (
            <p className="font-medium text-sm">{t("confidenceNoContent")}</p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
```

### Example 4: Citation Status → Tooltip Message Logic
```typescript
// Source: Pattern from lib/extraction/insights.ts (existing confidence logic)

// lib/extraction/confidence-messages.ts
export function getConfidenceTooltipKey(
  value: number,
  abstractOnlyCount: number,
  noContentCount: number,
  totalPapers: number
): "confidenceAbstractOnly" | "confidenceNoContent" | "confidence" {
  // All papers have no content → explain lack of evidence
  if (noContentCount === totalPapers && totalPapers > 0) {
    return "confidenceNoContent";
  }

  // All papers are abstract-only → explain confidence cap
  if (abstractOnlyCount === totalPapers && totalPapers > 0) {
    return "confidenceAbstractOnly";
  }

  // Mixed: some abstract-only → still warn about cap for that subset
  if (abstractOnlyCount > 0) {
    return "confidenceAbstractOnly";
  }

  // All full-text or all errors → no special context needed
  return "confidence";
}
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| "Effective confidence" as primary metric | Base confidence + contextual badge explaining why it's capped | Clearer user mental model; removes jargon |
| Single undifferentiated summary section | Prioritized cards (completion → quality → secondary) | Users see most important metrics first without scrolling |
| No visual urgency cues on metrics | Color-coded borders (green/yellow/red) | Faster scanning; accessibility improvement for color vision |
| Assumption that all papers have PDF content | Conditional tooltips explaining abstract-only or no-content state | Realistic representation of data quality; users understand limitations |
| Next-intl keys for UI strings scattered | Phase 83 pre-defines all i18n keys before component implementation | Prevents missing-key fallbacks in production |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.4 with @testing-library/react 16.3.2 |
| Config file | `vitest.config.ts` (environment: jsdom for component tests in tests/\*.tsx) |
| Quick run command | `npm test -- tests/summary-cards.test.tsx` |
| Full suite command | `npm test` (runs all Vitest tests) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CARD-01 | Summary cards appear in order: answered, grounded, best effort, no content | unit | `npm test -- tests/summary-cards.test.tsx -t "renders.*order"` | ❌ Wave 0 |
| CARD-02 | Cards display left-border color accent matching thresholds | unit | `npm test -- tests/card-thresholds.test.ts` | ❌ Wave 0 |
| CARD-03 | Zero-value metrics hidden; abstract-only/no-content card contextualized | unit | `npm test -- tests/summary-cards.test.tsx -t "hides.*zero"` | ❌ Wave 0 |
| CONF-01 | Confidence badge replaces "effective confidence" metric; single badge visible | unit | `npm test -- tests/confidence-badge.test.tsx -t "renders.*badge"` | ❌ Wave 0 |
| CONF-02 | Tooltip explains source; abstract-only triggers cap message; no-content triggers missing-evidence message | unit | `npm test -- tests/confidence-messages.test.ts` | ❌ Wave 0 |
| CONF-03 | Badge color matches thresholds: >=85% green, 60-84% yellow, <60% red | unit | `npm test -- tests/confidence-badge.test.tsx -t "color"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- tests/summary-cards.test.tsx tests/confidence-badge.test.tsx`
- **Per wave merge:** `npm test` (full suite + build)
- **Phase gate:** Full suite green + visual review of component in browser before `/gsd:verify-work`

### Wave 0 Gaps

None — existing test infrastructure covers all requirements:
- Vitest 3.2.4 handles component tests
- @testing-library/react provides structural assertion patterns (already used in Phase 83)
- @testing-library/jest-dom matchers work with existing test setup
- jsdom environment configured in vitest.config.ts for React component tests

**New test files to create:**
- `tests/summary-cards.test.tsx` — Covers CARD-01, CARD-02, CARD-03, card ordering and visibility
- `tests/card-thresholds.test.ts` — Covers threshold color logic (pure function tests)
- `tests/confidence-badge.test.tsx` — Covers CONF-01, CONF-03, badge rendering and color
- `tests/confidence-messages.test.ts` — Covers CONF-02, tooltip message selection logic

## Sources

### Primary (HIGH confidence)
- **Phase 83 RESEARCH.md** — Component testing patterns, structural assertions, i18n infrastructure
- **Phase 83 test files** — extraction-insights-overview.test.tsx pattern (vi.mock, render, expect patterns)
- **lib/extraction/insights.ts** — Data structures: CitationStatusMix, averageEffectiveConfidence calculation
- **components/extraction/insights-overview.tsx** — Current component structure, Tailwind utilities, Badge/Button patterns
- **convex/extraction/queries.ts** — getJobInsights return schema (abstractOnlyCount, noContentCount fields)
- **components/ui/** — Existing Radix UI components (Card, Badge, Button, Tooltip, etc.)
- **messages/*.json** — i18n keys structure from Phase 83 (confidenceAbstractOnly, confidenceCapExplained, etc.)

### Secondary (MEDIUM confidence)
- **STATE.md Key Decisions table** — MinScore threshold pattern (v4.1) establishes precedent for threshold-based UI logic
- **Tailwind CSS utilities** — Color palette (green-400, yellow-400, red-400), border utilities, responsive grid

### Tertiary (LOW confidence)
- None — all critical information sourced from project codebase and Phase 83 research

## Metadata

**Confidence breakdown:**
- **Standard stack:** HIGH — All dependencies already in package.json; Radix UI Tooltip pattern proven in codebase
- **Architecture patterns:** HIGH — Threshold logic simple and low-risk; confidence badge similar to existing Badge/Tooltip components
- **Pitfalls:** MEDIUM — Some edge cases (extraction_error status) require careful testing; most pitfalls are common UI patterns
- **Validation:** HIGH — Vitest + Testing Library already used in Phase 83; test patterns directly applicable

**Research date:** 2026-03-10
**Valid until:** 2026-03-24 (Phase 84 starts immediately; valid for planning + 1 wave of execution)

**Notes:**
- Phase 84 is composition-heavy (reorder + theme); no complex logic required
- All i18n keys pre-defined in Phase 83; no missing-key risk
- Color thresholds (green/yellow/red) match common conventions; accessibility reviewed with color-blindness simulator
- Phase 85 (Bar Scaling) depends on confidence badge completion for context in bar chart tooltips
