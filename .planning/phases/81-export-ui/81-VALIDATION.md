---
phase: 81
slug: export-ui
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 81 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (node environment for pure logic; jsdom for component tests if needed) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/export-screening-ui.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 81-01-01 | 01 | 1 | UI-01 | manual-only | Visual inspection in browser | N/A | ⬜ pending |
| 81-01-02 | 01 | 1 | UI-02 | manual-only | Visual inspection + functional test | N/A | ⬜ pending |
| 81-01-03 | 01 | 1 | UI-03 | manual-only | Visual inspection in browser | N/A | ⬜ pending |
| 81-01-04 | 01 | 1 | UI-04 | unit (existing) | `npx vitest run tests/export-screening.test.ts` | ✅ | ⬜ pending |
| 81-01-05 | 01 | 1 | UI-05 | manual-only | Visual inspection in browser | N/A | ⬜ pending |
| 81-01-06 | 01 | 1 | UI-06 | unit | `npx vitest run tests/export-screening-ui.test.ts -t "translations"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/export-screening-ui.test.ts` — verify translation keys exist in all 6 locale files for UI-06

*Existing infrastructure covers all other phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Export button rendered on completed job cards only | UI-01 | React component rendering with Convex context | Open screening dialog, verify export icon on completed jobs, not on pending/processing |
| Format dropdown triggers correct export | UI-02 | Requires browser download API | Click export, select CSV/JSON/XLSX, verify file downloads |
| Loading spinner during export | UI-03 | Requires async timing | Click export, verify spinner appears during generation |
| Warning on incomplete jobs | UI-05 | UI visual inspection | Open dropdown on cancelled/failed job, verify warning text appears |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
