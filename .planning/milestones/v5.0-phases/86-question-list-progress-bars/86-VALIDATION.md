---
phase: 86
slug: question-list-progress-bars
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 86 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.4 + @testing-library/react |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm test -- question-status.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- question-status.test.ts && npm test -- question-list-item.test.tsx`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 86-01-01 | 01 | 1 | QLIST-01 | unit | `npm test -- question-status.test.ts -t "statusFromCompletion"` | ❌ W0 | ⬜ pending |
| 86-01-02 | 01 | 1 | QLIST-01 | unit | `npm test -- question-list-item.test.tsx -t "renders status dot"` | ❌ W0 | ⬜ pending |
| 86-01-03 | 01 | 1 | QLIST-02 | unit | `npm test -- question-list-item.test.tsx -t "renders progress bar"` | ❌ W0 | ⬜ pending |
| 86-01-04 | 01 | 1 | QLIST-02 | unit | `npm test -- question-status.test.ts -t "handles zero answered"` | ❌ W0 | ⬜ pending |
| 86-01-05 | 01 | 1 | QLIST-02 | a11y | `npm test -- question-list-item.test.tsx -t "aria attributes"` | ❌ W0 | ⬜ pending |
| 86-02-01 | 02 | 1 | QLIST-03 | integration | `npm test -- extraction-insights-overview.test.tsx -t "question list scannable"` | ❌ W0 | ⬜ pending |
| 86-02-02 | 02 | 1 | QLIST-03 | integration | `npm test -- extraction-insights-overview.test.tsx -t "visual indicators visible"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/question-status.test.ts` — stubs for QLIST-01, QLIST-02 (statusFromCompletion, getAnswerPercentage)
- [ ] `tests/question-list-item.test.tsx` — stubs for QLIST-01, QLIST-02 (component rendering, ARIA attributes)
- [ ] Update `tests/extraction-insights-overview.test.tsx` — stubs for QLIST-03 (integration with QuestionListItem)

*Existing infrastructure covers framework needs — vitest and @testing-library/react already installed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Progress bar responsive width at 320px/768px/1024px | QLIST-02 | Visual layout verification | Resize browser to each breakpoint; verify progress bar + percentage text don't overflow |
| Status dot color consistency with Phase 85 bar colors | QLIST-01 | Visual regression | Compare status dot green with grounded-bar green side-by-side |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
