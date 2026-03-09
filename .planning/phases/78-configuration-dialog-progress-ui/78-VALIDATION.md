---
phase: 78
slug: configuration-dialog-progress-ui
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 78 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.4 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run convex/screening/` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run convex/screening/`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 78-01-01 | 01 | 1 | JOB-08 | unit | `npx vitest run convex/screening/queries.test.ts` | Partial | ⬜ pending |
| 78-01-02 | 01 | 1 | DIALOG-01 | manual-only | N/A - UI interaction | N/A | ⬜ pending |
| 78-01-03 | 01 | 1 | DIALOG-02 | manual-only | N/A - UI rendering | N/A | ⬜ pending |
| 78-01-04 | 01 | 1 | DIALOG-06 | manual-only | N/A - UI rendering | N/A | ⬜ pending |
| 78-01-05 | 01 | 1 | DIALOG-07 | manual-only | N/A - UI interaction | N/A | ⬜ pending |
| 78-02-01 | 02 | 1 | DIALOG-03 | manual-only | N/A - UI interaction | N/A | ⬜ pending |
| 78-02-02 | 02 | 1 | DIALOG-04 | manual-only | N/A - UI interaction | N/A | ⬜ pending |
| 78-02-03 | 02 | 1 | DIALOG-05 | manual-only | N/A - UI interaction | N/A | ⬜ pending |
| 78-03-01 | 03 | 2 | JOB-02 | unit | `npx vitest run convex/screening/ -t "paper count"` | No - Wave 0 | ⬜ pending |
| 78-03-02 | 03 | 2 | JOB-03 | unit | `npx vitest run convex/screening/ -t "credit cost"` | No - Wave 0 | ⬜ pending |
| 78-03-03 | 03 | 2 | JOB-06 | manual-only | N/A - requires running Convex | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `convex/screening/queries.ts` — add `listUserScreeningJobs` query (covers JOB-08)
- [ ] `convex/screening/queries.test.ts` — add test for `listUserScreeningJobs`

*Most requirements are UI-only (DIALOG-01 through DIALOG-07, JOB-06) and require manual verification.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Screen All button opens dialog | DIALOG-01 | UI interaction | Click "Screen All" on results page, verify dialog opens |
| Dialog displays screening questions | DIALOG-02 | UI rendering | Verify questions from screening panel appear in dialog |
| Scoring rules editor | DIALOG-03 | UI interaction | Edit point values per question, verify state updates |
| Star threshold editor | DIALOG-04 | UI interaction | Edit star thresholds, verify mappings update |
| Collection picker with inline create | DIALOG-05 | UI interaction | Select collection, create new one inline |
| Paper count + credit cost display | DIALOG-06 | UI rendering | Verify count shows, cap message at 200+ |
| Dismiss guards during submission | DIALOG-07 | UI interaction | Try ESC/click-outside during submission, verify blocked |
| Real-time progress display | JOB-06 | Requires running Convex | Start job, verify progress bar updates reactively |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
