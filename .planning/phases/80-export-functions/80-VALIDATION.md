---
phase: 80
slug: export-functions
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 80 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/export-screening.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/export-screening.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 80-01-01 | 01 | 1 | EXP-02 | unit | `npx vitest run tests/export-screening.test.ts -t "CSV headers"` | ❌ W0 | ⬜ pending |
| 80-01-02 | 01 | 1 | EXP-02 | unit | `npx vitest run tests/export-screening.test.ts -t "CSV answers"` | ❌ W0 | ⬜ pending |
| 80-01-03 | 01 | 1 | EXP-02 | unit | `npx vitest run tests/export-screening.test.ts -t "CSV scoring"` | ❌ W0 | ⬜ pending |
| 80-01-04 | 01 | 1 | EXP-03 | unit | `npx vitest run tests/export-screening.test.ts -t "JSON envelope"` | ❌ W0 | ⬜ pending |
| 80-01-05 | 01 | 1 | EXP-03 | unit | `npx vitest run tests/export-screening.test.ts -t "JSON answers"` | ❌ W0 | ⬜ pending |
| 80-01-06 | 01 | 1 | EXP-04 | unit | `npx vitest run tests/export-screening.test.ts -t "XLSX Results"` | ❌ W0 | ⬜ pending |
| 80-01-07 | 01 | 1 | EXP-04 | unit | `npx vitest run tests/export-screening.test.ts -t "XLSX Summary"` | ❌ W0 | ⬜ pending |
| 80-01-08 | 01 | 1 | EXP-05 | unit | `npx vitest run tests/export-screening.test.ts -t "failed results CSV"` | ❌ W0 | ⬜ pending |
| 80-01-09 | 01 | 1 | EXP-05 | unit | `npx vitest run tests/export-screening.test.ts -t "failed results JSON"` | ❌ W0 | ⬜ pending |
| 80-01-10 | 01 | 1 | EXP-05 | unit | `npx vitest run tests/export-screening.test.ts -t "failed results XLSX"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/export-screening.test.ts` — test stubs for EXP-02 through EXP-05
- [ ] `lib/screening/export.ts` — new file with three export functions

*Existing infrastructure covers framework and utilities.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
