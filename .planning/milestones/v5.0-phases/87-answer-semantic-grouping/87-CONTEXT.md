# Phase 87: Answer Semantic Grouping - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Merge semantically similar answers (case variants, whitespace differences, basic synonyms) into grouped rows in the answer distribution UI, with expandable drill-down to inspect individual variants. Group counts aggregate variant counts accurately. Disagreement detection respects grouping so semantically identical answers are not flagged as disagreements. Zero backend changes — all grouping is frontend-only, consuming existing `getQuestionInsights` query data.

</domain>

<decisions>
## Implementation Decisions

### Synonym matching scope
- Boolean synonyms: Yes/True/Positive → "Yes" group; No/False/Negative → "No" group
- Null/missing synonyms: N/A, Not applicable, Unknown, None, No data, Not available, — → "N/A" group
- Whitespace/punctuation variants already handled by backend `normalizeAnswer()` (trim, lowercase, collapse whitespace, strip non-word chars)
- Singular/plural: Keep separate — too risky for domain-specific academic terms (e.g., "model" vs "models" may have different meanings)
- No fuzzy/NLP matching — explicitly deferred to v5.1+ per REQUIREMENTS.md (GROUP-05)
- Synonym map is a static lookup table, not dynamic — predictable, testable, zero external dependencies

### Grouped row display
- Each semantic group row shows the **most frequent variant** as the representative label
- A small disclosure badge shows variant count when >1: e.g., "(3 variants)"
- Clicking the disclosure badge/chevron expands inline sub-rows showing each raw variant with its individual count
- Sub-rows are indented with lighter text styling — no separate stacked bar per sub-row (avoids chart clutter)
- The group's stacked bar uses the **aggregated count** across all variants
- Groups with only 1 variant render identically to current ungrouped rows (no disclosure control)
- Collapsed state is the default — user expands on demand

### Aggregated count accuracy
- Group count = sum of all variant counts within the group
- citationStatusMix for the group = sum of each variant's citationStatusMix values per status key
- This ensures the stacked bar segments are proportionally accurate for the group

### Disagreement detection integration
- Post-process disagreement clusters on the frontend using the same synonym map
- If two disagreement clusters map to the same synonym group, merge them into one cluster (combine examples, sum counts)
- This keeps the backend `buildDisagreementClusters` untouched while ensuring GROUP-04 compliance
- Applied in `InsightsQuestionPanel` before passing clusters to `DisagreementList`

### Architecture
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

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `normalizeAnswer()` in `lib/extraction/insights.ts`: Already handles case, whitespace, punctuation normalization — synonym grouping builds on top of normalized keys
- `BarVisualization` / `StackedAnswerBars`: Renders per-answer stacked bars — will receive grouped data without internal changes
- `DisagreementList`: Renders clusters with expand/collapse — similar UX pattern for variant drill-down
- `formatAnswerForDisplay()`: Converts raw answers to display strings — reusable for variant labels
- `CITATION_STATUS_COLORS` in `bar-scaling.ts`: Color constants for stacked bar segments

### Established Patterns
- Pure function + TDD: All insight utilities (`normalizeAnswer`, `aggregateQuestionInsights`, `buildDisagreementClusters`) are pure functions tested in `tests/extraction-insights.test.ts`
- Data transformation in panel component: `InsightsQuestionPanel` already maps `rawAnswerDistribution` and `entityDistribution` before passing to `BarVisualization`
- Lazy-loaded Recharts: `BarVisualization` wraps `StackedAnswerBars` via `next/dynamic` — no changes needed to lazy loading
- i18n via `useTranslations("extraction")`: All strings go through next-intl

### Integration Points
- `InsightsQuestionPanel` (line ~96-97): `rawAnswerDistribution` and `entityDistribution` are the data sources — grouping transform inserts here
- `InsightsQuestionPanel` (line ~272-281): disagreement clusters passed to `DisagreementList` — merge transform inserts here
- `BarVisualization` props (`answers`, `maxCount`): Grouped data must conform to existing `AnswerItem[]` interface
- `rawAnswerDistribution` returned by `getQuestionInsights` query: Each bucket has `normalized`, `display`, `count`, `avgConfidence`, `paperIds`, `examples`
- `topAnswers` from `aggregateQuestionInsights`: Backend already groups by `normalizeAnswer()` output — frontend synonym grouping merges these already-normalized buckets

</code_context>

<specifics>
## Specific Ideas

- The synonym map should be minimal and conservative — better to under-merge than to wrongly combine academically distinct answers
- Boolean questions are the highest-value target: AI models produce "Yes", "True", "Positive", "Affirmative" etc. for the same meaning
- Null-like answers are the second highest-value target: "N/A", "Not applicable", "Unknown", "None", "No data" clutter distributions
- Entity distribution (array mode) should NOT be synonym-grouped — entity grouping has different semantics and is already handled by `entityDistribution`
- Synonym grouping only applies to `rawAnswerDistribution` (scalar mode and raw view of array mode)

</specifics>

<deferred>
## Deferred Ideas

- GROUP-05: Fuzzy/NLP-based synonym matching — deferred to v5.1+ per REQUIREMENTS.md
- GROUP-06: User-driven merge/unmerge of answer groups with persistence — deferred to v5.1+ per REQUIREMENTS.md

</deferred>

---

*Phase: 87-answer-semantic-grouping*
*Context gathered: 2026-03-10*
