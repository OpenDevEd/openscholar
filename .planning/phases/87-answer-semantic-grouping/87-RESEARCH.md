# Phase 87: Answer Semantic Grouping - Research

**Researched:** 2026-03-10
**Domain:** Data transformation, semantic similarity, React UI patterns
**Confidence:** HIGH

## Summary

Phase 87 adds frontend-only semantic grouping to answer distributions in the Insights Overview. Semantically similar answers (case variants, whitespace differences, and basic synonym mappings like "Yes/True/Positive" or "N/A/Unknown") are merged into grouped rows with expandable drill-down to inspect individual variants. Group counts aggregate variant counts accurately. The disagreement detection system respects grouping so semantically identical answers are not flagged as disagreements.

This is a pure data transformation layer — no backend changes. The `getQuestionInsights` query already returns normalized buckets from `normalizeAnswer()` (which handles case/whitespace/punctuation); synonym grouping merges these normalized buckets at the frontend in `InsightsQuestionPanel` before passing to `BarVisualization`. Disagreement clusters are similarly post-processed to merge semantically equivalent answers.

**Primary recommendation:** Implement pure utility functions in `lib/extraction/answer-grouping.ts` to build a static synonym map and group answers/clusters. Apply grouping transforms in `InsightsQuestionPanel` (lines 96–97 for answers, lines 272–281 for disagreement clusters). The `BarVisualization` component receives grouped data without modification. Define a `GroupedAnswerRow` component to handle expand/collapse UI for variant drill-down, styling similar to the existing `DisagreementList` pattern.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Boolean synonyms: Yes/True/Positive → "Yes" group; No/False/Negative → "No" group
- Null/missing synonyms: N/A, Not applicable, Unknown, None, No data, Not available, — → "N/A" group
- Whitespace/punctuation variants already handled by backend `normalizeAnswer()` (trim, lowercase, collapse whitespace, strip non-word chars)
- Singular/plural: Keep separate — too risky for domain-specific academic terms (e.g., "model" vs "models" may have different meanings)
- No fuzzy/NLP matching — explicitly deferred to v5.1+ per REQUIREMENTS.md (GROUP-05)
- Synonym map is a static lookup table, not dynamic — predictable, testable, zero external dependencies
- Each semantic group row shows the **most frequent variant** as the representative label
- A small disclosure badge shows variant count when >1: e.g., "(3 variants)"
- Clicking the disclosure badge/chevron expands inline sub-rows showing each raw variant with its individual count
- Sub-rows are indented with lighter text styling — no separate stacked bar per sub-row (avoids chart clutter)
- The group's stacked bar uses the **aggregated count** across all variants
- Groups with only 1 variant render identically to current ungrouped rows (no disclosure control)
- Collapsed state is the default — user expands on demand
- Group count = sum of all variant counts within the group
- citationStatusMix for the group = sum of each variant's citationStatusMix values per status key
- Post-process disagreement clusters on the frontend using the same synonym map
- If two disagreement clusters map to the same synonym group, merge them into one cluster (combine examples, sum counts)
- New `lib/extraction/answer-grouping.ts` with pure functions: `buildSynonymMap()`, `groupAnswersBySynonym()`, `mergeDisagreementClusters()`
- Grouping applied in `InsightsQuestionPanel` as a transform step between query data and `BarVisualization` props
- Pure functions are fully TDD-testable without DOM or React
- Existing `BarVisualization` receives grouped data — it does not need to know about grouping (data transformation happens upstream)
- New `GroupedAnswerRow` component (or extension of existing bar row) handles the expand/collapse disclosure UI

### Claude's Discretion
- Exact synonym entries in the static lookup table (beyond the core boolean/null groups listed above)
- Chevron icon vs text-only disclosure toggle styling
- Animation on expand/collapse (if any)
- Whether to show a summary count like "Showing 8 groups from 23 raw answers" above the distribution

### Deferred Ideas (OUT OF SCOPE)
- GROUP-05: Fuzzy/NLP-based synonym matching — deferred to v5.1+ per REQUIREMENTS.md
- GROUP-06: User-driven merge/unmerge of answer groups with persistence — deferred to v5.1+ per REQUIREMENTS.md
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| GROUP-01 | Semantically similar answers merged into groups (case, whitespace, basic synonyms) | `normalizeAnswer()` already handles case/whitespace; synonym grouping merges normalized buckets using static lookup table; boolean and null groups are locked decisions |
| GROUP-02 | Grouped answers show expandable drill-down to see individual variants | `DisagreementList` expand/collapse pattern can be adapted; grouped row stores variant array internally; disclosure badge toggles visibility |
| GROUP-03 | Group counts aggregate variant counts for accurate totals | Grouped answer object stores `variants[]` array; group count = sum of variant counts; citationStatusMix aggregates per status key across all variants |
| GROUP-04 | Disagreement detection respects grouping (grouped answers are not flagged as disagreements) | `buildDisagreementClusters()` groups by normalized answer; frontend `mergeDisagreementClusters()` maps each cluster to synonym group and merges duplicate groups |
</phase_requirements>

## Standard Stack

### Core Libraries
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | ^19.2.4 | Component rendering | Already in use across codebase |
| TypeScript | ^5.3+ | Type safety for grouping logic | Established language for this project |
| next-intl | ^4.8.2 | i18n for UI strings | Already used for all UI text; i18n keys already exist (`answerGrouping`, `answerGroupingExpand`, `answerGroupingVariants`) |
| Tailwind CSS | ^4 | Styling for grouped rows and disclosure controls | Established utility framework |
| Lucide React | ^0.487.0 | Chevron/disclosure icons | Already a dependency; clean SVG icons |

### Data Processing
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| TypeScript (built-in) | ^5+ | Array/object manipulations for grouping logic | All grouping utilities are pure TS functions; no external libraries needed |

### Testing & Validation
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | ^2+ | Unit testing pure functions | Established test framework; test files at `tests/extraction-insights.test.ts` pattern |
| React Testing Library | ^16.3.2 | Component testing for `GroupedAnswerRow` | For testing expand/collapse behavior in jsdom |

**Installation:** No new packages required. All dependencies already in package.json.

## Architecture Patterns

### Recommended Project Structure

```
lib/extraction/
├── insights.ts                 # Existing — normalizeAnswer(), aggregateQuestionInsights()
├── answer-grouping.ts          # NEW: buildSynonymMap(), groupAnswersBySynonym(), mergeDisagreementClusters(), applyGroupingTransform()
└── bar-scaling.ts              # Existing — scaling utilities

components/extraction/
├── insights-question-panel.tsx # Existing — modified to apply grouping transforms
├── bar-visualization.tsx        # Existing — no changes needed
├── stacked-answer-bars.tsx      # Existing — receives grouped data
├── disagreement-list.tsx        # Existing — receives merged clusters
└── grouped-answer-row.tsx       # NEW: expand/collapse disclosure UI for variant drill-down
```

### Pattern 1: Pure Utility Functions for Grouping

**What:** Stateless functions that transform answer/cluster data using a static synonym map.

**When to use:** All grouping operations — building the synonym map, grouping answers, merging clusters.

**Example:**
```typescript
// lib/extraction/answer-grouping.ts
export type SynonymMap = Map<string, string>;

export function buildSynonymMap(): SynonymMap {
  const map = new Map<string, string>();

  // Boolean synonyms → "yes" group
  ['yes', 'true', 'positive', 'affirmative', 'correct'].forEach(v => map.set(v, 'yes'));
  ['no', 'false', 'negative', 'incorrect'].forEach(v => map.set(v, 'no'));

  // Null synonyms → "n/a" group
  ['n/a', 'na', 'not applicable', 'unknown', 'none', 'no data', 'not available', '—'].forEach(v => map.set(v, 'n/a'));

  return map;
}

export interface GroupedAnswer {
  groupRepresentative: string;        // Most frequent variant (or first if tied)
  groupNormalized: string;            // Key in synonym map
  count: number;                      // Sum of all variant counts
  citationStatusMix: CitationStatusMix; // Aggregated across variants
  variants: Array<{
    display: string;                  // Raw answer display text
    normalized: string;               // Normalized key from backend
    count: number;                    // Individual count
    citationStatusMix: CitationStatusMix;
  }>;
}

export function groupAnswersBySynonym(
  answers: AnswerBucket[],
  synonymMap: SynonymMap
): GroupedAnswer[] {
  const grouped = new Map<string, GroupedAnswer['variants']>();

  for (const answer of answers) {
    const groupKey = synonymMap.get(answer.normalized) ?? answer.normalized;
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey)!.push({
      display: answer.display,
      normalized: answer.normalized,
      count: answer.count,
      citationStatusMix: answer.citationStatusMix ?? { grounded: 0, best_effort: 0, insufficient_evidence: 0, extraction_error: 0 },
    });
  }

  return Array.from(grouped.entries()).map(([groupKey, variants]) => {
    const representative = variants.reduce((a, b) => a.count >= b.count ? a : b);
    const citationStatusMix: CitationStatusMix = {
      grounded: variants.reduce((sum, v) => sum + (v.citationStatusMix.grounded ?? 0), 0),
      best_effort: variants.reduce((sum, v) => sum + (v.citationStatusMix.best_effort ?? 0), 0),
      insufficient_evidence: variants.reduce((sum, v) => sum + (v.citationStatusMix.insufficient_evidence ?? 0), 0),
      extraction_error: variants.reduce((sum, v) => sum + (v.citationStatusMix.extraction_error ?? 0), 0),
    };

    return {
      groupRepresentative: representative.display,
      groupNormalized: groupKey,
      count: variants.reduce((sum, v) => sum + v.count, 0),
      citationStatusMix,
      variants: variants.sort((a, b) => b.count - a.count),
    };
  });
}
```

**Why this works:**
- Pure functions: testable in isolation, no side effects, no React dependencies
- Static synonym map: deterministic, fast, no I/O or network calls
- Variants stored on grouped answer: enables drill-down without re-fetching or extra state

### Pattern 2: Transform in InsightsQuestionPanel

**What:** Apply grouping transforms between query data and BarVisualization props.

**When to use:** Always apply when rendering answer distribution; same for disagreement clusters.

**Example:**
```typescript
// components/extraction/insights-question-panel.tsx (lines ~96–97)

const rawAnswerDistribution = questionInsights.rawAnswerDistribution || questionInsights.topAnswers || [];
const synonymMap = buildSynonymMap();
const groupedAnswers = groupAnswersBySynonym(rawAnswerDistribution, synonymMap);

// For display, transform grouped data to BarVisualization format
const displayAnswers = groupedAnswers.map(group => ({
  answer: group.groupRepresentative,
  count: group.count,
  citationStatusMix: group.citationStatusMix,
  _groupedAnswer: group, // Store group data for expand/collapse if needed
}));

<BarVisualization
  answers={displayAnswers}
  maxCount={Math.max(...displayAnswers.map(a => a.count), 1)}
/>
```

**Why this works:**
- Transformation happens upstream of BarVisualization — chart component is unaware of grouping
- Grouped data already in BarVisualization format — no component changes needed
- Group metadata (`_groupedAnswer`) available if expand/collapse UI needs it

### Pattern 3: Expand/Collapse UI for Variants (if implemented)

**What:** Inline disclosure control that toggles visibility of variant sub-rows.

**When to use:** When group has multiple variants and user needs to inspect individual counts.

**Example:**
```typescript
// components/extraction/grouped-answer-row.tsx

interface GroupedAnswerRowProps {
  group: GroupedAnswer;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}

export function GroupedAnswerRow({
  group,
  isExpanded,
  onToggleExpanded,
}: GroupedAnswerRowProps) {
  const t = useTranslations("extraction");
  const hasVariants = group.variants.length > 1;

  return (
    <div className="space-y-2">
      {/* Group row with stacked bar */}
      <div className="flex items-center gap-2">
        {hasVariants && (
          <button
            onClick={onToggleExpanded}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {isExpanded ? '▼' : '▶'} {t("answerGroupingExpand", { count: group.variants.length })}
          </button>
        )}
        <span className="font-medium">{group.groupRepresentative}</span>
      </div>

      {/* Stacked bar for group (not shown here — delegated to BarVisualization) */}

      {/* Expanded variant rows */}
      {isExpanded && hasVariants && (
        <div className="ml-4 space-y-1 border-l-2 border-muted pl-3">
          {group.variants.map((variant, idx) => (
            <div key={idx} className="text-xs text-muted-foreground">
              <span>{variant.display}</span>
              <span className="ml-2 font-mono text-xs">×{variant.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Why this works:**
- Reuses expand/collapse pattern from existing `DisagreementList`
- Indented, lighter styling prevents visual clutter
- No separate stacked bar per variant (aggregated bar is group-level only)

### Anti-Patterns to Avoid

- **Custom fuzzy matching in grouping:** Fuzzy/NLP deferred to v5.1; static lookup is sufficient for MVP
- **Backend grouping:** All grouping is frontend-only; backend `normalizeAnswer()` output is the foundation
- **Per-variant stacked bars:** Shows too many bars, defeats the grouping purpose; group-level bar only
- **Dynamic synonym map:** User-driven merge/unmerge deferred to v5.1; static map is predictable and testable
- **Grouping entity distributions:** Entity grouping has different semantics (already handled by backend); only apply to answer distributions

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Synonym matching for booleans/nulls | Custom case statement or regex | Static lookup map via `buildSynonymMap()` | Predictable, testable, maintainable; defers fuzzy matching to v5.1+ |
| Aggregating counts and citation status across variants | Loop-based accumulation without structure | `GroupedAnswer` interface with citationStatusMix aggregation logic | Type safety, clarity, reusable for both answers and clusters |
| Expand/collapse state for variant drill-down | Inline state in BarVisualization or InsightsQuestionPanel | Dedicated `GroupedAnswerRow` component with local state | Single responsibility, reusable pattern, easier to test |
| Merging disagreement clusters by synonym group | Reimplementing clustering logic | `mergeDisagreementClusters()` function with same synonym map | Consistency with answer grouping, less code duplication |

**Key insight:** The core challenge is semantic similarity detection, which is hard to get right without fuzzy/NLP matching. Static synonym mappings cover the highest-value cases (boolean, null) without the maintenance burden of a dynamic or learned mapping. Keep the synonym map small, conservative, and locked in CONTEXT.md.

## Common Pitfalls

### Pitfall 1: Grouping Entity Distributions Incorrectly
**What goes wrong:** Entity grouping is applied to `entityDistribution` (array mode) instead of just answer distributions. Entities like "machine learning" and "machine-learning" may be semantically identical but are already handled differently by the backend's entity extraction logic.

**Why it happens:** Confusion between "answer grouping" (semantic similarity of scalar answers) and "entity extraction" (canonicalization of individual entities in array answers). The context document explicitly restricts grouping to `rawAnswerDistribution` only.

**How to avoid:** Apply grouping ONLY when `isArrayMode === false` or when rendering `rawAnswerDistribution`. Do NOT apply to `entityDistribution`.

**Warning signs:** Code path includes both `entityDistribution.map()` and grouping logic in the same conditional; tests pass for scalar questions but fail for array questions.

### Pitfall 2: Forgetting to Aggregate CitationStatusMix
**What goes wrong:** Group count is correctly summed, but citationStatusMix is left as the representative variant's mix. This causes stacked bar segments to be misaligned — group bar shows wrong proportions because the mix doesn't reflect all variants.

**Why it happens:** Easy to think of citationStatusMix as per-variant metadata and accidentally keep it from the first/representative variant instead of aggregating.

**How to avoid:** Explicitly aggregate each citation status key: `grounded: sum of all variants' grounded counts`, etc. Unit tests should verify that group citationStatusMix is the sum of variant mixes (not just representative).

**Warning signs:** Stacked bar colors don't match the expected proportions; sum of variant counts ≠ group count shown on bar tooltip.

### Pitfall 3: Backend Normalization Not Considered
**What goes wrong:** Synonym grouping is applied to raw `display` strings instead of `normalized` keys. This causes case-sensitive or whitespace mismatches because the backend's `normalizeAnswer()` already normalized the answers, but we're re-normalizing or ignoring that work.

**Why it happens:** Confusion about where normalization happens. Backend already groups by normalized keys; grouping should work on top of those, not re-normalize.

**How to avoid:** Use `normalized` as the grouping key, not `display`. The synonym map receives normalized keys (`normalizeAnswer()` output). Display strings are shown to the user but are not used for grouping logic.

**Warning signs:** Duplicate groups for case variants ("YES" and "yes" as separate groups); test shows backend already normalized but grouping code runs normalization again.

### Pitfall 4: Disagreement Cluster Merging Doesn't Update Examples
**What goes wrong:** Two disagreement clusters are merged, but the `examples` array is not combined. The merged cluster shows examples from only one of the original clusters, hiding data.

**Why it happens:** Focus on merging count and citationStatusMix but overlooking the examples array, which is critical for user inspection.

**How to avoid:** `mergeDisagreementClusters()` must concatenate examples from both clusters. Store the merged examples on the result cluster. Unit tests should verify merged cluster has examples from both original clusters.

**Warning signs:** Disagreement finder shows fewer total examples than expected; merging logic doesn't iterate over cluster.examples.

### Pitfall 5: Variant Disclosure Default State
**What goes wrong:** Groups default to expanded state, showing all variants inline. This defeats the grouping purpose (reducing visual clutter) and makes the interface feel bloated.

**Why it happens:** Confusion about what "collapsed by default" means or accidental default in component state.

**How to avoid:** Set `useState(false)` for expansion state in `GroupedAnswerRow`. Variant sub-rows only render when `isExpanded === true`. Default is collapsed; user expands on demand.

**Warning signs:** Initial render shows hundreds of variant rows even when there are only a few answer groups; users complain about clutter.

## Code Examples

Verified patterns from official sources and Phase 86 precedent:

### Building and Using the Synonym Map
```typescript
// Source: CONTEXT.md locked decisions
export type SynonymMap = Map<string, string>;

export function buildSynonymMap(): SynonymMap {
  const map = new Map<string, string>();

  // Boolean: Yes/True/Positive → "yes"
  ['yes', 'true', 'positive', 'affirmative'].forEach(v => map.set(v, 'yes'));

  // Boolean: No/False/Negative → "no"
  ['no', 'false', 'negative', 'incorrect'].forEach(v => map.set(v, 'no'));

  // Null/Missing → "n/a"
  ['n/a', 'na', 'not applicable', 'unknown', 'none', 'no data', 'not available', '—'].forEach(v => map.set(v, 'n/a'));

  return map;
}

// Usage in grouping function
const synonymMap = buildSynonymMap();
const groupKey = synonymMap.get(normalizedAnswer) ?? normalizedAnswer;
```

### Grouping Answers with Proper Type Structure
```typescript
// Source: CONTEXT.md architecture decisions + existing AnswerBucket pattern
export interface GroupedAnswer {
  groupRepresentative: string;        // Most frequent variant
  groupNormalized: string;            // Synonym map key
  count: number;                      // Sum of variant counts
  citationStatusMix: CitationStatusMix;
  variants: Array<{
    display: string;
    normalized: string;
    count: number;
    citationStatusMix: CitationStatusMix;
  }>;
}

export function groupAnswersBySynonym(
  answers: AnswerBucket[],
  synonymMap: SynonymMap
): GroupedAnswer[] {
  const groups = new Map<string, GroupedAnswer['variants']>();

  for (const answer of answers) {
    const groupKey = synonymMap.get(answer.normalized) ?? answer.normalized;
    const variants = groups.get(groupKey) ?? [];
    variants.push({
      display: answer.display,
      normalized: answer.normalized,
      count: answer.count,
      citationStatusMix: answer.citationStatusMix ?? {
        grounded: 0,
        best_effort: 0,
        insufficient_evidence: 0,
        extraction_error: 0,
      },
    });
    groups.set(groupKey, variants);
  }

  return Array.from(groups.entries()).map(([groupKey, variants]) => {
    const representative = variants.reduce((a, b) => (a.count >= b.count ? a : b));
    const citationStatusMix: CitationStatusMix = {
      grounded: variants.reduce((sum, v) => sum + (v.citationStatusMix?.grounded ?? 0), 0),
      best_effort: variants.reduce((sum, v) => sum + (v.citationStatusMix?.best_effort ?? 0), 0),
      insufficient_evidence: variants.reduce((sum, v) => sum + (v.citationStatusMix?.insufficient_evidence ?? 0), 0),
      extraction_error: variants.reduce((sum, v) => sum + (v.citationStatusMix?.extraction_error ?? 0), 0),
    };

    return {
      groupRepresentative: representative.display,
      groupNormalized: groupKey,
      count: variants.reduce((sum, v) => sum + v.count, 0),
      citationStatusMix,
      variants: variants.sort((a, b) => b.count - a.count),
    };
  });
}
```

### Merging Disagreement Clusters by Synonym Group
```typescript
// Source: CONTEXT.md lines 39–42; similar to buildDisagreementClusters() pattern
export function mergeDisagreementClusters(
  clusters: DisagreementCluster[],
  synonymMap: SynonymMap
): DisagreementCluster[] {
  const mergedMap = new Map<string, DisagreementCluster>();

  for (const cluster of clusters) {
    const groupKey = synonymMap.get(cluster.normalizedAnswer) ?? cluster.normalizedAnswer;

    if (!mergedMap.has(groupKey)) {
      mergedMap.set(groupKey, {
        normalizedAnswer: groupKey,
        displayAnswer: cluster.displayAnswer,
        count: cluster.count,
        avgConfidence: cluster.avgConfidence,
        citationStatusMix: cluster.citationStatusMix,
        examples: [...cluster.examples],
      });
    } else {
      const existing = mergedMap.get(groupKey)!;
      const totalCount = existing.count + cluster.count;
      existing.avgConfidence = (existing.avgConfidence * existing.count + cluster.avgConfidence * cluster.count) / totalCount;
      existing.count = totalCount;
      existing.citationStatusMix = {
        grounded: (existing.citationStatusMix?.grounded ?? 0) + (cluster.citationStatusMix?.grounded ?? 0),
        best_effort: (existing.citationStatusMix?.best_effort ?? 0) + (cluster.citationStatusMix?.best_effort ?? 0),
        insufficient_evidence: (existing.citationStatusMix?.insufficient_evidence ?? 0) + (cluster.citationStatusMix?.insufficient_evidence ?? 0),
        extraction_error: (existing.citationStatusMix?.extraction_error ?? 0) + (cluster.citationStatusMix?.extraction_error ?? 0),
      };
      existing.examples.push(...cluster.examples);
    }
  }

  return Array.from(mergedMap.values()).sort((a, b) => b.count - a.count);
}
```

### Applying Grouping Transform in InsightsQuestionPanel
```typescript
// Source: CONTEXT.md lines 76–77 integration point
// In InsightsQuestionPanel component, before passing to BarVisualization:

const rawAnswerDistribution = questionInsights.rawAnswerDistribution || questionInsights.topAnswers || [];
const synonymMap = buildSynonymMap();
const groupedAnswers = groupAnswersBySynonym(rawAnswerDistribution, synonymMap);

const displayAnswers = groupedAnswers.map(group => ({
  answer: group.groupRepresentative,
  count: group.count,
  citationStatusMix: group.citationStatusMix,
}));

<BarVisualization
  answers={displayAnswers}
  maxCount={Math.max(...displayAnswers.map(a => a.count), 1)}
/>
```

### Using Expand/Collapse Pattern (similar to DisagreementList)
```typescript
// Source: DisagreementList component pattern (existing code lines 44–99)
const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

const handleToggleGroup = (groupKey: string) => {
  setExpandedGroups(prev => ({
    ...prev,
    [groupKey]: !prev[groupKey],
  }));
};

// Render grouped rows
{groupedAnswers.map((group, idx) => {
  const key = group.groupNormalized;
  const isExpanded = expandedGroups[key] || false;
  const hasVariants = group.variants.length > 1;

  return (
    <div key={key} className="space-y-2">
      <div className="flex items-center gap-2">
        {hasVariants ? (
          <button
            onClick={() => handleToggleGroup(key)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {isExpanded ? '▼' : '▶'} {t("answerGroupingExpand", { count: group.variants.length })}
          </button>
        ) : null}
        <span className="font-medium">{group.groupRepresentative}</span>
      </div>

      {/* Expanded variants */}
      {isExpanded && hasVariants ? (
        <div className="ml-4 space-y-1 border-l-2 border-muted pl-3">
          {group.variants.map((variant, vIdx) => (
            <div key={vIdx} className="text-xs text-muted-foreground">
              {variant.display}
              <span className="ml-2 font-mono">×{variant.count}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
})}
```

## State of the Art

Phase 87 follows the data transformation patterns established in Phases 83–86:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No answer grouping (GROUP-01/02/03/04 not implemented) | Static synonym map groups semantically similar answers | Phase 87 (v5.0) | Users see cleaner distributions; fewer false disagreements |
| Disagreement detection treats all normalized answers as distinct | Frontend post-processing merges disagreement clusters by synonym group | Phase 87 (v5.0) | Disagreement finder respects semantic grouping (GROUP-04) |
| No disclosure UI for answer variants | Expand/collapse via `GroupedAnswerRow` pattern | Phase 87 (v5.0) | Users can drill down to inspect individual variants on demand |

**Deprecated/outdated:** None — this is new functionality.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^2 + React Testing Library ^16.3.2 |
| Config file | `vitest.config.ts` (existing; no changes needed) |
| Quick run command | `npm test -- tests/extraction-insights.test.ts --run` |
| Full suite command | `npm test -- tests/**/*.test.ts tests/**/*.test.tsx --run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GROUP-01 | Boolean variants (yes/true/positive) merge into "yes" group | unit | `npm test -- tests/answer-grouping.test.ts --run` | ❌ Wave 0 |
| GROUP-01 | Null variants (n/a/unknown/none) merge into "n/a" group | unit | `npm test -- tests/answer-grouping.test.ts --run` | ❌ Wave 0 |
| GROUP-01 | Singular/plural kept separate (not grouped) | unit | `npm test -- tests/answer-grouping.test.ts --run` | ❌ Wave 0 |
| GROUP-02 | Grouped answer has `variants` array with individual counts | unit | `npm test -- tests/answer-grouping.test.ts --run` | ❌ Wave 0 |
| GROUP-02 | Grouped answer exposes representative (highest-count variant) | unit | `npm test -- tests/answer-grouping.test.ts --run` | ❌ Wave 0 |
| GROUP-03 | Group count = sum of variant counts | unit | `npm test -- tests/answer-grouping.test.ts --run` | ❌ Wave 0 |
| GROUP-03 | citationStatusMix aggregates per-status keys across variants | unit | `npm test -- tests/answer-grouping.test.ts --run` | ❌ Wave 0 |
| GROUP-04 | Disagreement clusters with same synonym group merge correctly | unit | `npm test -- tests/answer-grouping.test.ts --run` | ❌ Wave 0 |
| GROUP-04 | Merged cluster examples are concatenated from both originals | unit | `npm test -- tests/answer-grouping.test.ts --run` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- tests/answer-grouping.test.ts --run` (quick, <10 sec)
- **Per wave merge:** `npm test -- tests/**/*insight*.test.ts tests/**/*grouping*.test.ts --run` (grouped + insights coverage)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/answer-grouping.test.ts` — pure function tests for `buildSynonymMap()`, `groupAnswersBySynonym()`, `mergeDisagreementClusters()`
- [ ] `tests/components/grouped-answer-row.test.tsx` — expand/collapse UI behavior (jsdom)
- [ ] `tests/extraction-insights-overview.test.tsx` — integration test verifying grouping applied in InsightsQuestionPanel (may modify existing file)

*(If Wave 0 completes all tests: "Test infrastructure ready for Phase 87 implementation")*

## Open Questions

1. **Exact synonym entries beyond boolean/null?**
   - What we know: CONTEXT.md locks boolean ("Yes/True/Positive") and null ("N/A/Unknown/None") synonyms
   - What's unclear: Are there other common academic answer patterns worth grouping? (e.g., "Unclear/Not mentioned", "Both", "Partially")
   - Recommendation: Start with boolean + null only; gather user feedback before expanding. Keep i18n keys and test structure designed to accept more entries without refactoring.

2. **Disclosure UI styling — chevron vs text-only?**
   - What we know: Decisions left to Claude's discretion; DisagreementList uses button-based toggle
   - What's unclear: Should grouped rows use chevron icon (Lucide), text label ("Show variants"), or both?
   - Recommendation: Use chevron icon + text label following DisagreementList pattern (button with conditional text). Accessible via aria-label.

3. **Animation on expand/collapse?**
   - What we know: Deferred idea — not in locked decisions
   - What's unclear: Should variant rows slide in/fade in, or appear instantly?
   - Recommendation: No animation for MVP (instant); add via Motion library (already in dependencies) in v5.1+ if UX feedback justifies.

4. **Summary count badge above distribution?**
   - What we know: Claude's discretion whether to show "Showing 8 groups from 23 raw answers"
   - What's unclear: Is this helpful context or visual clutter?
   - Recommendation: Defer to v5.1+; focus on correctness first, UX refinement later.

## Sources

### Primary (HIGH confidence)
- **CONTEXT.md** (Phase 87 context session 2026-03-10) — locked decisions, architecture, integration points
- **REQUIREMENTS.md** (2026-03-10) — GROUP-01/02/03/04 requirements; GROUP-05/06 deferred
- **STATE.md** (2026-03-10) — accumulated patterns from Phases 83–86 establishing TDD and data transformation patterns
- **lib/extraction/insights.ts** — verified existing `normalizeAnswer()`, `aggregateQuestionInsights()`, `buildDisagreementClusters()` patterns
- **components/extraction/insights-question-panel.tsx** (lines 96–97, 272–281) — integration points for grouping transforms
- **components/extraction/disagreement-list.tsx** (lines 44–99) — expand/collapse pattern reference
- **tests/extraction-insights.test.ts** — TDD test structure for pure functions
- **messages/en-US.json** — verified i18n keys `answerGrouping`, `answerGroupingExpand`, `answerGroupingVariants` already exist
- **package.json** — verified all required dependencies (React, TypeScript, next-intl, Lucide, Radix, Tailwind) already installed

### Secondary (MEDIUM confidence)
- **Phase 86 RESEARCH.md** — established pattern for QuestionListItem component and status utilities; similar expand/collapse pattern for GroupedAnswerRow

### Tertiary (reference/context only)
- **vitest.config.ts** — test environment setup verified; tsx test files use jsdom
- **bar-scaling.ts** — color constants and scaling utilities for reference

## Metadata

**Confidence breakdown:**
- **Standard stack:** HIGH — all libraries verified in package.json; i18n keys verified in messages/en-US.json
- **Architecture:** HIGH — locked decisions in CONTEXT.md; integration points verified in existing code
- **Pitfalls:** MEDIUM — identified common mistakes from Phase 86 experience and general grouping patterns; some edge cases may emerge during implementation
- **Test strategy:** HIGH — vitest + RTL confirmed; test files follow existing patterns from extraction-insights.test.ts

**Research date:** 2026-03-10
**Valid until:** 2026-03-24 (14 days — static stack, well-defined requirements, no fast-moving dependencies)

---

*Phase: 87-answer-semantic-grouping*
*Context gathered: 2026-03-10*
*Research complete: 2026-03-10*
