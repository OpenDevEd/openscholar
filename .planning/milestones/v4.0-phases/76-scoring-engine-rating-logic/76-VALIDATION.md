---
phase: 76
slug: scoring-engine-rating-logic
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 76 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (pure function tests, no convex-test needed) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run convex/screening/scoring.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run convex/screening/scoring.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 76-01-01 | 01 | 1 | SCORE-01 | unit | `npx vitest run convex/screening/scoring.test.ts -t "computeScore"` | ❌ W0 | ⬜ pending |
| 76-01-02 | 01 | 1 | SCORE-02 | unit | `npx vitest run convex/screening/scoring.test.ts -t "computeScore"` | ❌ W0 | ⬜ pending |
| 76-01-03 | 01 | 1 | SCORE-02 | unit | `npx vitest run convex/screening/scoring.test.ts -t "missing"` | ❌ W0 | ⬜ pending |
| 76-01-04 | 01 | 1 | SCORE-02 | unit | `npx vitest run convex/screening/scoring.test.ts -t "negative"` | ❌ W0 | ⬜ pending |
| 76-01-05 | 01 | 1 | SCORE-03 | unit | `npx vitest run convex/screening/scoring.test.ts -t "computeStarRating"` | ❌ W0 | ⬜ pending |
| 76-01-06 | 01 | 1 | SCORE-04 | unit | `npx vitest run convex/screening/scoring.test.ts -t "computeStarRating"` | ❌ W0 | ⬜ pending |
| 76-01-07 | 01 | 1 | SCORE-04 | unit | `npx vitest run convex/screening/scoring.test.ts -t "gap"` | ❌ W0 | ⬜ pending |
| 76-01-08 | 01 | 1 | SCORE-05 | unit | `npx vitest run convex/screening/scoring.test.ts -t "isQualified"` | ❌ W0 | ⬜ pending |
| 76-01-09 | 01 | 1 | ALL | unit | `npx vitest run convex/screening/scoring.test.ts -t "scorePaper"` | ❌ W0 | ⬜ pending |
| 76-01-10 | 01 | 1 | ALL | unit | `npx vitest run convex/screening/scoring.test.ts -t "validateScoringConfig"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `convex/screening/scoring.ts` — pure scoring functions (does not exist yet)
- [ ] `convex/screening/scoring.test.ts` — exhaustive unit tests (does not exist yet)

*Both files created in Wave 1 as TDD (test-first).*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
