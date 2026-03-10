# Phase 83: Test Foundation & i18n Keys - Research

**Researched:** 2026-03-10
**Domain:** React component testing, i18n translation management, data visualization edge cases
**Confidence:** HIGH

## Summary

Phase 83 establishes the testing and translation infrastructure for the Extraction Insights Overhaul (v5.0). This phase has two primary focuses:

1. **Test Foundation:** Refactor existing insights component tests from snapshot-based assertions to **structural assertions** targeting DOM structure and data attributes. This prevents component refactors (Phase 84-87) from cascading test failures.

2. **i18n Keys:** Add all new translation keys for extraction insights across all 6 supported locales (en-US, en-GB, fr, ja, zh, hi) **before** any UI component changes. This prevents missing-key fallbacks from shipping and reduces translation QA friction.

The project currently has 79 component/hook tests across Vitest + Testing Library, with an existing i18n test pattern (export-screening-ui.test.ts) that can be extended for extraction insights. Project uses next-intl for translation management with locale files as JSON.

**Primary recommendation:** Create i18n infrastructure first (translation keys + validation test), then refactor insights tests to structural assertions. Both must complete before Phase 84 begins.

## User Constraints

None — Phase 83 is the first phase of v5.0 milestone with no prior decisions documented in CONTEXT.md.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-01 | All new UI strings translated across 6 locales; all extraction insights translation keys exist in all 6 locale JSON files before any UI component is written | Translation completeness test pattern, locale file structure analysis, next-intl setup |

## Standard Stack

### Core Dependencies
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **Vitest** | ^3.2.4 | Test runner, Node environment with jsdom for DOM tests | Project standard; faster than Jest, better Vite integration |
| **@testing-library/react** | ^16.3.2 | DOM testing utilities (render, screen, fireEvent) | React component testing best practice; decouples tests from implementation details |
| **@testing-library/jest-dom** | ^6.9.1 | Extended expect matchers (toBeInTheDocument, toHaveAttribute) | Standard for DOM assertions; avoids brittle HTML string matching |
| **next-intl** | ^4.8.2 | Translation/localization framework | Already in use; provides useTranslations() hook for components |

### i18n Configuration
| Component | Location | Purpose |
|-----------|----------|---------|
| **Locale config** | `i18n/config.ts` | Defines supported locales: ["en-US", "en-GB", "zh", "fr", "hi", "ja"] |
| **Translation files** | `messages/{locale}.json` | 6 JSON files, one per locale; `extraction` namespace for extraction feature strings |
| **next-intl setup** | `i18n/request.ts`, `i18n/locale-detection.ts` | Server-side locale detection, request-level setup |

### Testing Environment Setup
| Config | Location | Details |
|--------|----------|---------|
| **Vitest config** | `vitest.config.ts` | Environment: node, with jsdom override for component tests in `tests/components/**` |
| **Test setup** | `tests/setup.ts` | Extends expect with @testing-library/jest-dom, cleanup after each test |
| **Test patterns** | Existing in codebase | Structural assertions (expect.toHaveProperty, toBeInTheDocument), no snapshot tests found in extraction tests |

## Architecture Patterns

### Pattern 1: Structural Component Assertions (vs. Snapshots)
**What:** Test component behavior and DOM structure using data attributes and semantic queries, not rendered HTML snapshots.

**When to use:** All component tests in insights refactoring (Phase 83+). Use when component render output may change during feature development (expected brittleness).

**Example:**
```typescript
// Source: Existing extraction-insights.test.ts pattern (lines 10-60)
// GOOD: Structural assertion
it("renders summary cards with correct percentages", () => {
  const aggregate = aggregateQuestionInsights([...test data...], "string");
  const { container } = render(<InsightsOverview insights={aggregate} />);

  // Target behavior, not exact HTML
  const answeredCard = container.querySelector('[data-testid="summary-answered"]');
  expect(answeredCard).toHaveTextContent(/\d+%\s+answered/);
  expect(answeredCard?.querySelector('.percentage')).toBeInTheDocument();
});

// BAD: Snapshot (brittle to refactoring)
// expect(component).toMatchSnapshot() // ← Avoid for insights components
```

**Why:** InsightsOverview components will change rendering multiple times (Phase 84-87). Snapshots fail on every render change. Structural tests verify behavior remains correct while allowing safe refactoring.

### Pattern 2: i18n Key Registration and Validation
**What:** Define translation keys upfront in TypeScript (using Zod enum or literal types), validate that all keys exist in all 6 locale files before merging.

**When to use:** Whenever new UI strings are added to extraction insights (Phase 83, before component writing).

**Example:**
```typescript
// convex/lib/extraction-i18n-keys.ts (NEW FILE)
import { z } from "zod";

// TypeScript enum forces compile-time awareness
export const EXTRACTION_INSIGHTS_KEYS = z.enum([
  "answered",           // Existing
  "grounded",          // Existing
  "bestEffort",        // Existing
  // NEW for Phase 84+:
  "confidenceAbstractOnly",
  "confidenceNoContent",
  "barScalingEdgeCases",
  // ... all new keys
]);

// In component:
// const t = useTranslations("extraction");
// ✓ t(EXTRACTION_INSIGHTS_KEYS.parse("confidenceAbstractOnly"))
// ✗ t("unknownKey") // TypeError at compile time if key undefined
```

**Why:** next-intl defaults to showing translation keys as fallback if missing (e.g., "extraction.confidenceAbstractOnly" displays in UI). Early validation via test catches gaps before shipping. Pattern mirrors existing export-screening-ui.test.ts.

### Pattern 3: Locale File Completeness Test
**What:** Automated test that compares English locale against all 5 other locales, ensuring every key exists and no values are empty strings.

**When to use:** Phase 83, run before every PR merge that adds extraction UI strings.

**Example:**
```typescript
// tests/extraction-i18n-coverage.test.ts (NEW FILE)
import { describe, it, expect } from "vitest";
import enUS from "../messages/en-US.json";
import enGB from "../messages/en-GB.json";
import fr from "../messages/fr.json";
import ja from "../messages/ja.json";
import zh from "../messages/zh.json";
import hi from "../messages/hi.json";

const EXTRACTION_INSIGHTS_KEYS = [
  "answered",
  "grounded",
  "confidenceAbstractOnly",
  // ... all keys
] as const;

const locales = { "en-US": enUS, "en-GB": enGB, fr, ja, zh, hi };

describe("extraction insights i18n coverage", () => {
  it("all extraction.insights keys exist in all 6 locales", () => {
    for (const [locale, messages] of Object.entries(locales)) {
      const extraction = (messages as any).extraction;
      for (const key of EXTRACTION_INSIGHTS_KEYS) {
        expect(extraction, `Missing key "${key}" in ${locale}`).toHaveProperty(key);
      }
    }
  });

  it("no value is empty string", () => {
    for (const [locale, messages] of Object.entries(locales)) {
      const extraction = (messages as any).extraction;
      for (const key of EXTRACTION_INSIGHTS_KEYS) {
        expect(extraction[key], `Empty value "${key}" in ${locale}`).toBeTruthy();
      }
    }
  });
});
```

**Why:** Existing pattern from export-screening-ui.test.ts (lines 35-46). Catches missing translations in CI before deployment.

### Pattern 4: Edge Case Testing for Aggregation Logic
**What:** Test data aggregation functions (aggregateQuestionInsights, buildDisagreementClusters) with documented edge case inputs/outputs. These form the foundation for Phase 84-87 UI.

**When to use:** Phase 83, extend existing extraction-insights.test.ts.

**Example:**
```typescript
// Source: Existing tests (lines 249-454) already follow this pattern
describe("aggregateQuestionInsights edge cases", () => {
  // Existing tests for:
  // - Empty entries (line 250)
  // - All-null answers (line 280)
  // - Undefined confidence (line 346)
  // - Empty string answers (line 400)
  // - Mixed null/valid array answers (line 419)

  // NEW for Phase 83: Add these specific edge cases
  it("bar scaling: all-zero distribution handles gracefully", () => {
    const entries = [
      { answer: null, confidence: 0, citationStatus: "insufficient_evidence" },
      // ... all zeros
    ];
    const aggregate = aggregateQuestionInsights(entries, "string");
    expect(aggregate.total).toBe(entries.length);
    expect(aggregate.answered).toBe(0); // Graceful fallback, not NaN
  });

  it("bar scaling: single-dominant value (98%) scales minority visibly", () => {
    const entries = Array(100).fill({
      answer: "dominant",
      confidence: 0.8,
      citationStatus: "grounded"
    }).slice(0, 98).concat(Array(2).fill({
      answer: "minority",
      confidence: 0.6,
      citationStatus: "best_effort"
    }));
    const aggregate = aggregateQuestionInsights(entries, "string");
    const domCount = aggregate.topAnswers.find(a => a.answer === "dominant")?.count;
    const minCount = aggregate.topAnswers.find(a => a.answer === "minority")?.count;
    expect(minCount).toBeGreaterThan(0); // Minority visible in aggregation
  });

  it("confidence context: abstract-only job (0.7 confidence ceiling)", () => {
    const entries = [
      { answer: "yes", confidence: 0.7, citationStatus: "best_effort" },
      { answer: "yes", confidence: 0.7, citationStatus: "best_effort" },
    ];
    const aggregate = aggregateQuestionInsights(entries, "string");
    expect(aggregate.avgConfidence).toBeLessThanOrEqual(0.7);
    expect(aggregate.citationStatusMix.best_effort).toBe(2);
    expect(aggregate.citationStatusMix.grounded).toBe(0);
  });

  it("confidence context: no-content papers (all insufficient_evidence, confidence=0)", () => {
    const entries = [
      { answer: null, confidence: 0, citationStatus: "insufficient_evidence" },
      { answer: null, confidence: 0, citationStatus: "insufficient_evidence" },
    ];
    const aggregate = aggregateQuestionInsights(entries, "string");
    expect(aggregate.answered).toBe(0);
    expect(aggregate.citationStatusMix.insufficient_evidence).toBe(2);
    expect(aggregate.avgConfidence).toBe(0);
  });
});
```

**Why:** These tests document expected behavior for Phase 84 bar visualization and Phase 84 confidence display refactoring. They prevent assumptions from diverging between test foundation and UI implementation.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Translation key validation | Custom key-checking logic in scripts | Zod enum + test suite (export-screening-ui pattern) | Reusable, type-safe, integrates with test suite |
| Locale file management | Manual copying keys across 6 JSON files | Single YAML or JSON template → split per locale, or translation management tool (future) | 6 manual edits = 6x error risk |
| Component mocking for next-intl | Mock useTranslations() per test | Render with real next-intl wrapper or use default locale | next-intl setup is lightweight; real integration catches actual i18n bugs |
| Bar chart scaling logic | Custom scaling functions in components | Keep in pure functions (insights.ts), test separately | Testability, reusability, separation of concerns |

**Key insight:** next-intl is lightweight (no server-side rendering overhead for tests). Testing with real locale data is faster than mocking.

## Common Pitfalls

### Pitfall 1: Missing Translation Keys Slip to Production
**What goes wrong:** Add new UI string in Phase 84 component without adding translation key to all 6 locale files. Build succeeds. At runtime, next-intl shows fallback key text ("extraction.confidenceAbstractOnly" instead of French translation).

**Why it happens:** Manual translation file management. Developer updates en-US.json but forgets fr.json, ja.json, etc. No compile-time error because next-intl loads keys dynamically.

**How to avoid:**
1. Create translation completeness test (tests/extraction-i18n-coverage.test.ts) in Phase 83
2. Before any Phase 84-87 commit that adds UI strings: update all 6 locale files, run test, verify green
3. Enforce in CI: test must pass before merge

**Warning signs:**
- Browser console shows "Missing translation" or key names instead of text
- QA switches language, sees English fallback mixed with French
- User complaint: "Why is part of the insights page in English?"

### Pitfall 2: Snapshot Test Brittleness on Insights Components
**What goes wrong:** Refactor InsightsOverview component layout (Phase 84-87). Every render snapshot test fails. Developer approves new snapshot without visually reviewing changes. Regression (broken layout) ships undetected.

**Why it happens:** Snapshots capture full HTML output. Any change (color, spacing, structure) invalidates snapshot. Large test suite makes approvals careless.

**How to avoid:**
1. Phase 83: Refactor existing snapshot tests to structural assertions (data-testid targets, semantic queries)
2. Measure: "target DOM behavior, not exact rendering"
3. Test: expect(container.querySelector('[data-testid="summary-answered"]')).toHaveTextContent(/\d+%/)

**Warning signs:**
- npm test fails with "snapshot mismatch" for unrelated components
- Snapshot diff shows only whitespace or number changes
- PR reviewer skips snapshot review

### Pitfall 3: Bar Scaling Edge Cases Untested
**What goes wrong:** Phase 84 implements bar scaling (value / Math.max(...values)). Works for normal data. Breaks on:
- All values = 0 → division by zero → NaN widths
- One value = 98% of total → other bars become invisible microdots
- Only 1 paper answered → single bar takes 100% width, looks deceptive

**Why it happens:** Testing with canonical data (3–5 papers, diverse answers). Real extraction jobs have skewed distributions (all abstract-only papers cap at 0.7 confidence, etc.).

**How to avoid:**
1. Phase 83: Add edge case tests for aggregateQuestionInsights (see Pattern 4 examples above)
2. Document expected behavior: "all-zero → show zero-state, not NaN"
3. Phase 84: implement chart scaling aware of these edge cases

**Warning signs:**
- Manual QA: abstract-only job shows bars with NaN widths
- Deployment: insights page blank/broken for certain jobs
- Support: "Bar chart not rendering for my job"

### Pitfall 4: Locale Detection vs. Locale Files Mismatch
**What goes wrong:** Phase 83 adds French translation keys for extraction insights. i18n/config.ts lists "fr" as supported locale. But message file is "fr.json", and locale detection returns "fr-FR" (from Clerk localization). Mismatched keys = missing translations.

**Why it happens:** i18n/config.ts uses simple locale codes ("fr"), but some locale sources return full codes ("fr-FR"). next-intl lookup fails on mismatch.

**How to avoid:**
1. Phase 83: Verify i18n/config.ts locale list matches messages/ file names exactly
2. Verify locale-detection.ts and Clerk mapping (tests/clerk-ui-config.test.ts) return codes from config.ts
3. Add test: confirm all locales in config.ts have corresponding JSON files

**Warning signs:**
- Locale detection test shows "fr-FR" but config.ts defines "fr"
- Missing message files: no messages/de.json (if German added)
- next-intl error: "locale 'fr-FR' not configured"

### Pitfall 5: Component Tests Using next-intl Without Provider Setup
**What goes wrong:** Phase 83 refactoring: Convert snapshot test to structural test. Forgot to wrap component render with next-intl provider. useTranslations() hook returns undefined. Test crashes.

**Why it happens:** next-intl requires NextIntlClientProvider for client components or server-side context setup. Easy to miss when converting from snapshot (which may have been mocked).

**How to avoid:**
1. Phase 83: When refactoring component tests, ensure render wraps component with next-intl context
2. For isolated component tests: either mock useTranslations() or use real provider
3. Example: `render(<NextIntlClientProvider locale="en-US" messages={messages}><InsightsOverview /></NextIntlClientProvider>)`

**Warning signs:**
- Test crashes: "useTranslations called outside NextIntl context"
- Mock errors: "t is not a function"

## Code Examples

### Setting Up i18n Completeness Test
```typescript
// tests/extraction-i18n-coverage.test.ts (NEW FILE)
// Source: Pattern from tests/export-screening-ui.test.ts, adapted for extraction

import { describe, it, expect } from "vitest";
import enUS from "../messages/en-US.json";
import enGB from "../messages/en-GB.json";
import fr from "../messages/fr.json";
import ja from "../messages/ja.json";
import zh from "../messages/zh.json";
import hi from "../messages/hi.json";

// Define all new keys for extraction insights (Phase 83+)
const EXTRACTION_INSIGHTS_KEYS = [
  // Existing keys (confirm coverage)
  "answered",
  "grounded",
  "bestEffort",
  "insufficientEvidence",
  "avgConf",
  "effectiveConf",
  "confidence",
  "citationStatusMix",
  "answerDistribution",
  // NEW keys for Phase 84+ UI (add to all 6 locales BEFORE implementation)
  "confidenceAbstractOnly",      // Phase 84: confidence context label
  "confidenceNoContent",          // Phase 84: no-PDF state label
  "confidenceCapExplained",       // Phase 84: tooltip explaining 0.7 ceiling
  "barScalingWarning",            // Phase 84: label for small sample sizes
  "progressBarLabel",             // Phase 86: question list progress
  "statusDotComplete",            // Phase 86: question completion indicator
  "statusDotPartial",             // Phase 86: partial completion
  "statusDotEmpty",               // Phase 86: no answers
  "answerGrouping",               // Phase 87: grouping label
  "answerGroupingExpand",         // Phase 87: expand variants
  "answerGroupingVariants",       // Phase 87: variants count
] as const;

const locales = {
  "en-US": enUS,
  "en-GB": enGB,
  fr,
  ja,
  zh,
  hi,
} as const;

describe("extraction insights i18n coverage", () => {
  it("all new extraction keys exist in en-US", () => {
    const extraction = enUS.extraction as Record<string, unknown>;
    for (const key of EXTRACTION_INSIGHTS_KEYS) {
      expect(extraction).toHaveProperty(key);
    }
  });

  it("all new extraction keys exist in all 6 locales", () => {
    for (const [locale, messages] of Object.entries(locales)) {
      const extraction = (messages as Record<string, Record<string, unknown>>)
        .extraction;
      for (const key of EXTRACTION_INSIGHTS_KEYS) {
        expect(
          extraction,
          `Missing key "${key}" in ${locale}`
        ).toHaveProperty(key);
      }
    }
  });

  it("no translation value is empty string", () => {
    for (const [locale, messages] of Object.entries(locales)) {
      const extraction = (messages as Record<string, Record<string, unknown>>)
        .extraction;
      for (const key of EXTRACTION_INSIGHTS_KEYS) {
        const value = extraction[key];
        expect(
          value,
          `Empty value for "${key}" in ${locale}`
        ).not.toBe("");
      }
    }
  });

  it("values are not translation key names (catch copy-paste errors)", () => {
    for (const [locale, messages] of Object.entries(locales)) {
      if (locale === "en-US") continue; // Skip English (keys are english)
      const extraction = (messages as Record<string, Record<string, unknown>>)
        .extraction;
      for (const key of EXTRACTION_INSIGHTS_KEYS) {
        const value = extraction[key];
        expect(
          value,
          `Value is untranslated key name "${key}" in ${locale}`
        ).not.toBe(key);
      }
    }
  });
});
```

### Refactoring Component Test from Snapshot to Structural
```typescript
// tests/extraction-insights-overview.test.tsx (NEW FILE, replaces any snapshot test)
// Source: Pattern from existing extraction-insights.test.ts (unit test style)

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsightsOverview } from "../components/extraction/insights-overview";
import type { Id } from "../convex/_generated/dataModel";

// Mock next-intl for component test
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("InsightsOverview component", () => {
  it("renders summary card with data-testid attributes", () => {
    const { container } = render(
      <InsightsOverview
        jobId={"mock-job-id" as Id<"extractionJobs">}
        selectedQuestionKey="sample_size"
        onSelectQuestion={() => {}}
        enabled={true}
      />
    );

    const answeredCard = container.querySelector('[data-testid="summary-answered"]');
    expect(answeredCard).toBeInTheDocument();
    expect(answeredCard).toHaveTextContent(/\d+%/); // Percentage present
  });

  it("renders question list buttons", () => {
    const { container } = render(
      <InsightsOverview
        jobId={"mock-job-id" as Id<"extractionJobs">}
        selectedQuestionKey="sample_size"
        onSelectQuestion={() => {}}
        enabled={true}
      />
    );

    const questionButtons = container.querySelectorAll('button[data-testid*="question-"]');
    expect(questionButtons.length).toBeGreaterThan(0);
  });
});
```

### Edge Case Test for Aggregation
```typescript
// Append to tests/extraction-insights.test.ts (existing file)
// Source: Pattern already in file (lines 249-454), extend with Phase 83 additions

describe("aggregateQuestionInsights bar scaling edge cases", () => {
  it("all-zero distribution: answered=0, avgConfidence=0, no NaN", () => {
    const aggregate = aggregateQuestionInsights(
      [
        {
          paperId: "p1",
          title: "Paper 1",
          openalexId: "oa:1",
          questionKey: "q1",
          answer: null,
          confidence: 0,
          citationStatus: "insufficient_evidence",
        },
        {
          paperId: "p2",
          title: "Paper 2",
          openalexId: "oa:2",
          questionKey: "q1",
          answer: null,
          confidence: 0,
          citationStatus: "insufficient_evidence",
        },
      ],
      "string"
    );

    expect(aggregate.total).toBe(2);
    expect(aggregate.answered).toBe(0);
    expect(aggregate.avgConfidence).toBe(0); // Not NaN
    expect(Number.isNaN(aggregate.avgConfidence)).toBe(false);
  });

  it("single-dominant value (98%): minority remains visible in distribution", () => {
    const entries: InsightEntry[] = [
      // 98 dominant answers
      ...Array(98).fill(null).map((_, i) => ({
        paperId: `p${i}`,
        title: `Paper ${i}`,
        openalexId: `oa:${i}`,
        questionKey: "model",
        answer: "GPT-4",
        confidence: 0.9,
        citationStatus: "grounded" as const,
      })),
      // 2 minority answers
      {
        paperId: "p99",
        title: "Paper 99",
        openalexId: "oa:99",
        questionKey: "model",
        answer: "Claude",
        confidence: 0.85,
        citationStatus: "grounded",
      },
      {
        paperId: "p100",
        title: "Paper 100",
        openalexId: "oa:100",
        questionKey: "model",
        answer: "Llama",
        confidence: 0.8,
        citationStatus: "best_effort",
      },
    ];

    const aggregate = aggregateQuestionInsights(entries, "string");

    const gpt4 = aggregate.topAnswers.find((a) => a.answer === "gpt-4");
    const claude = aggregate.topAnswers.find((a) => a.answer === "claude");
    const llama = aggregate.topAnswers.find((a) => a.answer === "llama");

    // All three present in aggregation (minority visible)
    expect(gpt4).toBeDefined();
    expect(claude).toBeDefined();
    expect(llama).toBeDefined();

    // Counts are accurate (not collapsed)
    expect(gpt4?.count).toBe(98);
    expect(claude?.count).toBe(1);
    expect(llama?.count).toBe(1);
  });

  it("abstract-only job: avgEffectiveConfidence capped at ~0.7 (best_effort)", () => {
    const entries: InsightEntry[] = Array(5)
      .fill(null)
      .map((_, i) => ({
        paperId: `p${i}`,
        title: `Paper ${i}`,
        openalexId: `oa:${i}`,
        questionKey: "methods",
        answer: "RCT design",
        confidence: 0.7, // Ceiling for abstract-only
        citationStatus: "best_effort" as const,
      }));

    const aggregate = aggregateQuestionInsights(entries, "string");

    expect(aggregate.citationStatusMix.best_effort).toBe(5);
    expect(aggregate.citationStatusMix.grounded).toBe(0);
    expect(aggregate.avgConfidence).toBeLessThanOrEqual(0.7);
  });

  it("no-content papers: all insufficient_evidence, confidence=0", () => {
    const entries: InsightEntry[] = Array(3)
      .fill(null)
      .map((_, i) => ({
        paperId: `p${i}`,
        title: `Paper ${i}`,
        openalexId: `oa:${i}`,
        questionKey: "outcomes",
        answer: null,
        confidence: 0,
        citationStatus: "insufficient_evidence" as const,
      }));

    const aggregate = aggregateQuestionInsights(entries, "string");

    expect(aggregate.answered).toBe(0);
    expect(aggregate.citationStatusMix.insufficient_evidence).toBe(3);
    expect(aggregate.citationStatusMix.grounded).toBe(0);
    expect(aggregate.avgConfidence).toBe(0);
    expect(aggregate.topAnswers).toEqual([]);
  });
});

describe("aggregateQuestionInsights confidence context mapping", () => {
  it("abstract-only context: best_effort status, confidence ≤0.7", () => {
    const aggregate = aggregateQuestionInsights(
      [
        {
          paperId: "p1",
          title: "Paper 1",
          openalexId: "oa:1",
          questionKey: "q1",
          answer: "yes",
          confidence: 0.65,
          citationStatus: "best_effort",
        },
      ],
      "string"
    );

    // Component will display this as "Abstract-only extraction"
    expect(aggregate.citationStatusMix.best_effort).toBe(1);
    expect(aggregate.citationStatusMix.grounded).toBe(0);
  });

  it("no-content context: insufficient_evidence status, confidence=0", () => {
    const aggregate = aggregateQuestionInsights(
      [
        {
          paperId: "p1",
          title: "Paper 1",
          openalexId: "oa:1",
          questionKey: "q1",
          answer: null,
          confidence: 0,
          citationStatus: "insufficient_evidence",
        },
      ],
      "string"
    );

    // Component will display this as "No content available"
    expect(aggregate.answered).toBe(0);
    expect(aggregate.citationStatusMix.insufficient_evidence).toBe(1);
  });

  it("full-text context: grounded status, confidence variable", () => {
    const aggregate = aggregateQuestionInsights(
      [
        {
          paperId: "p1",
          title: "Paper 1",
          openalexId: "oa:1",
          questionKey: "q1",
          answer: "yes",
          confidence: 0.92,
          citationStatus: "grounded",
        },
      ],
      "string"
    );

    // Component will display this as "92% grounded"
    expect(aggregate.citationStatusMix.grounded).toBe(1);
    expect(aggregate.avgConfidence).toBe(0.92);
  });
});
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.4 |
| Config file | `vitest.config.ts` |
| Quick run command | `npm test -- tests/extraction-insights.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|------------|
| INFRA-01 | All new extraction insights translation keys exist in all 6 locale JSON files (en-US, en-GB, fr, ja, zh, hi); no empty values | Unit (i18n) | `npm test -- tests/extraction-i18n-coverage.test.ts` | ❌ Wave 0 |
| INFRA-01 | InsightsOverview.test.ts assertions target DOM structure (data-testid, semantic queries) not rendered HTML snapshots | Unit (component) | `npm test -- tests/extraction-insights-overview.test.tsx` | ❌ Wave 0 |
| INFRA-01 | Edge-case tests exist for bar scaling: all-zero, single-dominant, small sample | Unit (aggregation) | `npm test -- tests/extraction-insights.test.ts -t "bar scaling"` | ⚠️ Partial (lines 249–454 exist; Phase 83 adds specific edge cases) |
| INFRA-01 | Edge-case tests exist for confidence context: abstract-only, no-content, full-text | Unit (aggregation) | `npm test -- tests/extraction-insights.test.ts -t "confidence context"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- tests/extraction-insights.test.ts tests/extraction-i18n-coverage.test.ts` (edge cases + i18n, ~5 sec)
- **Per wave merge:** `npm test` (full suite, ~30 sec including all 79 tests)
- **Phase gate:** Full suite green + manual review of i18n JSON diffs before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/extraction-i18n-coverage.test.ts` — i18n completeness test covering INFRA-01 requirement
- [ ] `tests/extraction-insights-overview.test.tsx` — component structural tests (refactor from snapshots)
- [ ] Extend `tests/extraction-insights.test.ts` — add bar scaling edge cases (all-zero, single-dominant) and confidence context tests (abstract-only, no-content, full-text)
- [ ] Update `messages/{en-US,en-GB,fr,ja,zh,hi}.json` — add all new extraction insights keys for Phase 84-87 UI strings (see Standard Stack section for key list)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| next-intl v3.x | next-intl v4.8.2 | Feb 2025 (project current) | Improved TypeScript support, better locale detection |
| Snapshot tests for all components | Structural tests (data-testid + queries) | Industry best practice ~2023–2024 | Reduces brittleness on refactoring, more stable CI |
| Manual translation file management | Automated tests for key coverage (export-screening pattern) | Started in project ~2024 (export-screening-ui.test.ts) | Catches missing translations in CI, less manual QA |
| Vitest v2.x | Vitest v3.2.4 | Mar 2025 (project current) | Faster tests, better TypeScript support |

**Deprecated/outdated:**
- Snapshot testing for UI components: still used in older parts of codebase but considered brittle. Phase 83 establishes new pattern (structural) for insights components.
- Manual locale file duplication: existing tests prevent some gaps, but no automated sync across 6 files. Phase 83 formalizes this with comprehensive test.

## Open Questions

1. **Question: Should translation keys use camelCase or snake_case?**
   - What we know: Existing extraction namespace uses camelCase (answeredRate, groundedRate, bestEffortRate). Consistent with STRIPE_API_KEY / stripeApiKey pattern.
   - What's unclear: New insight-specific keys may benefit from nested structure (e.g., "insight.barScale.allZero" vs. "barScaleAllZero")
   - Recommendation: Use flat camelCase to match existing extraction keys (answeredRate, etc.). If namespace grows to 50+ keys, consider reorganizing in Phase 88+.

2. **Question: Which locale files need the most attention for review?**
   - What we know: German (de) and Spanish (es) mentioned in phase description, but project only supports 6 locales: en-US, en-GB, fr, hi, ja, zh
   - What's unclear: Should Phase 83 add German and Spanish support, or confirm that 6 locales is intentional?
   - Recommendation: Assume 6 locales is intentional (verified via i18n/config.ts). If German/Spanish needed, add to config.ts FIRST, then add message files. Flag as separate task.

3. **Question: How to handle component testing with next-intl provider?**
   - What we know: Testing Library render() requires context setup for hooks. next-intl uses NextIntlClientProvider.
   - What's unclear: Should all component tests mock useTranslations, or use real provider setup?
   - Recommendation: Use real provider for integration tests (one component + i18n). Mock for isolated unit tests of component behavior (separate from i18n). Pattern: render(<NextIntlClientProvider locale="en-US" messages={enUS}><Component /></NextIntlClientProvider>)

## Confidence Breakdown

- **Standard Stack (HIGH):** Verified against package.json (Vitest ^3.2.4, @testing-library/react ^16.3.2, next-intl ^4.8.2) and existing test files (vitest.config.ts, tests/setup.ts, export-screening-ui.test.ts pattern confirmed)
- **Architecture Patterns (HIGH):** Existing pattern documented in export-screening-ui.test.ts (i18n completeness test) and extraction-insights.test.ts (edge case testing). Structural assertions are best practice in testing library docs.
- **Common Pitfalls (MEDIUM):** Drawn from existing pitfalls document (PITFALLS_v5.0_INSIGHTS_OVERHAUL.md) and project history. Bar scaling edge cases and i18n coverage gaps are confirmed risks from pitfalls research.
- **Validation Architecture (HIGH):** Test file locations, commands, and patterns match vitest.config.ts and existing test structure (79 tests across project).

## Sources

### Primary (HIGH confidence)
- `package.json` — Vitest 3.2.4, @testing-library/react 16.3.2, next-intl 4.8.2 versions confirmed
- `vitest.config.ts` — Test environment setup (node, jsdom override) verified
- `tests/setup.ts` — Testing Library setup pattern confirmed
- `tests/export-screening-ui.test.ts` — i18n completeness test pattern (actual code used as model)
- `tests/extraction-insights.test.ts` — Edge case testing pattern for aggregation logic (existing tests lines 10–596)
- `i18n/config.ts` — Locale list (["en-US", "en-GB", "zh", "fr", "hi", "ja"]) verified
- `messages/` directory — 6 JSON files with extraction namespace confirmed
- `.planning/research/PITFALLS_v5.0_INSIGHTS_OVERHAUL.md` — Bar scaling, confidence display, i18n pitfalls documented

### Secondary (MEDIUM confidence)
- Testing Library documentation (best practices for structural assertions, avoiding snapshots)
- next-intl v4.8.2 release notes (TypeScript support improvements)
- Industry patterns (2023–2024) for i18n testing and structural assertions

## Metadata

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (Vitest and next-intl are stable; pitfalls research fresh; 1-month refresh recommended if new library versions released)

**Completeness:** Phase 83 research covers infrastructure (test setup, i18n patterns), edge cases (bar scaling, confidence context), and common pitfalls. Sufficient for planner to create detailed tasks.
