# Requirements: OpenAlex Count

**Defined:** 2026-03-10
**Core Value:** Reliable, well-tested academic search and AI extraction

## v5.0 Requirements

Requirements for Extraction Insights Overhaul. Each maps to roadmap phases.

### Bar Visualization

- [ ] **BAR-01**: Answer distribution bars scale relative to highest count, not total
- [ ] **BAR-02**: Stacked horizontal bars show part-to-whole distribution per question
- [ ] **BAR-03**: Bar scaling handles edge cases (all-zero, single dominant value, 1-answer questions)
- [ ] **BAR-04**: Bars display count labels and percentage on hover/focus

### Summary Cards

- [ ] **CARD-01**: Summary cards reordered to prioritize actionable metrics (completion, quality)
- [x] **CARD-02**: Cards use color accents (green/yellow/red) based on value thresholds
- [ ] **CARD-03**: Misleading metrics (e.g., "0% grounded" for abstract-only) are contextualized or hidden

### Confidence Display

- [ ] **CONF-01**: "Effective confidence" replaced with single contextual confidence badge
- [x] **CONF-02**: Badge explains source (abstract-only cap, full-text, no content) via tooltip
- [x] **CONF-03**: Color-coded thresholds: green (>=85%), yellow (60-84%), red (<60%)

### Question List

- [ ] **QLIST-01**: Each question shows status dot (complete/partial/empty)
- [ ] **QLIST-02**: Each question shows mini progress bar with completion percentage
- [ ] **QLIST-03**: Question list is scannable without expanding individual questions

### Answer Grouping

- [ ] **GROUP-01**: Semantically similar answers merged into groups (case, whitespace, basic synonyms)
- [ ] **GROUP-02**: Grouped answers show expandable drill-down to see individual variants
- [ ] **GROUP-03**: Group counts aggregate variant counts for accurate totals
- [ ] **GROUP-04**: Disagreement detection respects grouping (grouped answers are not flagged as disagreements)

### Infrastructure

- [x] **INFRA-01**: All new UI strings translated across 6 locales
- [ ] **INFRA-02**: Recharts lazy-loaded only when insights tab is accessed

## Future Requirements

### Enhanced Grouping (v5.1+)

- **GROUP-05**: Fuzzy/NLP-based synonym matching for answer grouping
- **GROUP-06**: User-driven merge/unmerge of answer groups with persistence

## Out of Scope

| Feature | Reason |
|---------|--------|
| Backend query changes | All 6 features use existing getJobInsights/getQuestionInsights queries |
| extractionJobStats schema changes | Existing aggregation sufficient; optimize only if perf issues arise |
| PDF-based confidence improvements | Separate concern from display reframing |
| Real-time collaboration on insights | Personal tool, no multi-user sync needed |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BAR-01 | Phase 85 | Pending |
| BAR-02 | Phase 85 | Pending |
| BAR-03 | Phase 85 | Pending |
| BAR-04 | Phase 85 | Pending |
| CARD-01 | Phase 84 | Pending |
| CARD-02 | Phase 84 | Complete |
| CARD-03 | Phase 84 | Pending |
| CONF-01 | Phase 84 | Pending |
| CONF-02 | Phase 84 | Complete |
| CONF-03 | Phase 84 | Complete |
| QLIST-01 | Phase 86 | Pending |
| QLIST-02 | Phase 86 | Pending |
| QLIST-03 | Phase 86 | Pending |
| GROUP-01 | Phase 87 | Pending |
| GROUP-02 | Phase 87 | Pending |
| GROUP-03 | Phase 87 | Pending |
| GROUP-04 | Phase 87 | Pending |
| INFRA-01 | Phase 83 | Complete |
| INFRA-02 | Phase 85 | Pending |

**Coverage:**
- v5.0 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0

---
*Requirements defined: 2026-03-10*
*Last updated: 2026-03-10 after roadmap creation (v5.0 phases 83-87)*
