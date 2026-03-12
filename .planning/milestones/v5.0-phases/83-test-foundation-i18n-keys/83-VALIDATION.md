---
phase: 83
slug: test-foundation-i18n-keys
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 83 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.4 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test -- tests/extraction-insights.test.ts tests/extraction-i18n-coverage.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- tests/extraction-insights.test.ts tests/extraction-i18n-coverage.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 83-01-01 | 01 | 1 | INFRA-01 | unit (i18n) | `npm test -- tests/extraction-i18n-coverage.test.ts` | ❌ W0 | ⬜ pending |
| 83-01-02 | 01 | 1 | INFRA-01 | unit (component) | `npm test -- tests/extraction-insights-overview.test.tsx` | ❌ W0 | ⬜ pending |
| 83-01-03 | 01 | 1 | INFRA-01 | unit (aggregation) | `npm test -- tests/extraction-insights.test.ts -t "bar scaling"` | ⚠️ partial | ⬜ pending |
| 83-01-04 | 01 | 1 | INFRA-01 | unit (aggregation) | `npm test -- tests/extraction-insights.test.ts -t "confidence context"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/extraction-i18n-coverage.test.ts` — i18n completeness test for INFRA-01
- [ ] `tests/extraction-insights-overview.test.tsx` — component structural tests (replaces snapshots)
- [ ] Extend `tests/extraction-insights.test.ts` — bar scaling edge cases (all-zero, single-dominant, one-answer)
- [ ] Extend `tests/extraction-insights.test.ts` — confidence context mapping tests (abstract-only, no-content, full-text)
- [ ] Update `messages/{en-US,en-GB,fr,ja,zh,hi}.json` — add all new extraction insights keys

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
