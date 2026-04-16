---
phase: 103
slug: workbench-views-selector-page
status: populated
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-16
---

# Phase 103 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 103-01-01 | 01 | 1 | GAP-01, GAP-02, WB-09 | — | useProtectedQuery replaces bare useQuery | unit + tsc | `npx vitest run tests/crash-prevention/usequery-guard.test.ts tests/extraction-i18n-coverage.test.ts --reporter=verbose` | ✅ | ⬜ pending |
| 103-01-02 | 01 | 1 | WB-08 | — | Export query validates ownership | tsc | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 103-02-01 | 02 | 1 | SEL-01 | — | N/A | tsc | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 103-02-02 | 02 | 1 | SEL-02, SEL-03, SEL-04 | — | useProtectedQuery for all data access | tsc | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 103-03-01 | 03 | 2 | WB-09 | — | N/A | tsc | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 103-03-02 | 03 | 2 | WB-04 | — | N/A | tsc | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 103-04-01 | 04 | 2 | WB-05 | — | N/A | tsc | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 103-04-02 | 04 | 2 | WB-06, WB-07, GAP-01 | — | Evidence uses verbatim slice, never LLM quote | tsc | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 103-05-01 | 05 | 3 | WB-05, WB-06, WB-07, GAP-01 | — | N/A | tsc | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 103-05-02 | 05 | 3 | WB-08, WB-09 | — | N/A | tsc | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 103-05-03 | 05 | 3 | WB-05, WB-06, WB-07 | — | N/A | checkpoint | human-verify | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Card view 1k scroll on Mobile Safari | WB-05 | Requires physical device or emulator | Open card view with 1000+ cards on Safari, scroll entire list without crash |
| Evidence drawer rendering | WB-07 | Visual verification of highlighted text | Click citation, verify verbatim source.text slice is displayed with parsing-source badge |
| Split view layout | WB-06 | Visual layout verification | Switch to split view, verify paper list left / detail right |
| Export file correctness | WB-08 | File download and content verification | Export CSV/JSON/XLSX, verify rows match current filter |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-16
