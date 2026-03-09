---
phase: 82
slug: simplify-star-thresholds-remove-maxscore-keep-minscore-only-highest-matching-wins
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 82 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^3.2.4 |
| **Config file** | vitest.config.ts (project root) |
| **Quick run command** | `npx vitest run convex/screening/scoring.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run convex/screening/scoring.test.ts tests/export-screening.test.ts -x`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 82-01-01 | 01 | 1 | SCORE-01 | unit | `npx vitest run convex/screening/scoring.test.ts -x` | ❌ W0 | ⬜ pending |
| 82-01-02 | 01 | 1 | SCORE-02 | unit | `npx vitest run convex/screening/scoring.test.ts -x` | ❌ W0 | ⬜ pending |
| 82-01-03 | 01 | 1 | SCORE-02 | unit | `npx vitest run convex/screening/scoring.test.ts -x` | ❌ W0 | ⬜ pending |
| 82-01-04 | 01 | 1 | SCORE-03 | unit | `npx vitest run convex/screening/scoring.test.ts -x` | ❌ W0 | ⬜ pending |
| 82-01-05 | 01 | 1 | SCORE-03 | integration | `npx vitest run convex/screening/queries.test.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Update `convex/screening/scoring.test.ts` — remove maxScore from existing fixtures, add descending-match tests, add backward-compat tests
- [ ] Update `convex/screening/queries.test.ts` — update seedScreeningJob fixture, add old-shape-reads test
- [ ] Update `convex/screening/cancel.test.ts` — update seedScreeningJob fixture
- [ ] Update `convex/screening/mutations.test.ts` — update defaultScoringConfig fixture
- [ ] Update `tests/export-screening.test.ts` — update mockData fixture

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Star threshold editor UI shows only minScore + stars | SCORE-01 | Visual UI verification | Open screening dialog, verify editor shows only minScore + stars columns |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
