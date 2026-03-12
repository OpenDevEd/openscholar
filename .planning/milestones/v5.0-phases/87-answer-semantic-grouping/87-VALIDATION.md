---
phase: 87
slug: answer-semantic-grouping
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 87 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^2 + React Testing Library ^16.3.2 |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npm test -- tests/answer-grouping.test.ts --run` |
| **Full suite command** | `npm test -- tests/**/*.test.ts tests/**/*.test.tsx --run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- tests/answer-grouping.test.ts --run`
- **After every plan wave:** Run `npm test -- tests/**/*insight*.test.ts tests/**/*grouping*.test.ts --run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 87-01-01 | 01 | 0 | GROUP-01 | unit | `npm test -- tests/answer-grouping.test.ts --run` | ❌ W0 | ⬜ pending |
| 87-01-02 | 01 | 0 | GROUP-02 | unit | `npm test -- tests/answer-grouping.test.ts --run` | ❌ W0 | ⬜ pending |
| 87-01-03 | 01 | 0 | GROUP-03 | unit | `npm test -- tests/answer-grouping.test.ts --run` | ❌ W0 | ⬜ pending |
| 87-01-04 | 01 | 0 | GROUP-04 | unit | `npm test -- tests/answer-grouping.test.ts --run` | ❌ W0 | ⬜ pending |
| 87-02-01 | 02 | 1 | GROUP-01 | integration | `npm test -- tests/extraction-insights-overview.test.tsx --run` | ❌ W0 | ⬜ pending |
| 87-02-02 | 02 | 1 | GROUP-02 | component | `npm test -- tests/components/grouped-answer-row.test.tsx --run` | ❌ W0 | ⬜ pending |
| 87-02-03 | 02 | 1 | GROUP-04 | integration | `npm test -- tests/extraction-insights-overview.test.tsx --run` | ❌ W0 | ⬜ pending |
| 87-03-01 | 03 | 2 | GROUP-02 | component | `npm test -- tests/components/grouped-answer-row.test.tsx --run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/answer-grouping.test.ts` — pure function tests for `buildSynonymMap()`, `groupAnswersBySynonym()`, `mergeDisagreementClusters()`
- [ ] `tests/components/grouped-answer-row.test.tsx` — expand/collapse UI behavior (jsdom)
- [ ] `tests/extraction-insights-overview.test.tsx` — integration test verifying grouping applied in InsightsQuestionPanel (may extend existing file)

*Existing infrastructure covers framework and config; Wave 0 creates test files only.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual styling of grouped rows vs ungrouped | GROUP-02 | CSS visual inspection | 1. Open insights panel with boolean question 2. Verify grouped row shows disclosure badge 3. Expand and check indented sub-rows |
| Stacked bar proportions after grouping | GROUP-03 | Visual chart accuracy | 1. Expand a grouped row 2. Verify bar width matches aggregated count 3. Compare with sum of variant counts |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
