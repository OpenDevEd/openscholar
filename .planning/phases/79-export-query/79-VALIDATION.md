---
phase: 79
slug: export-query
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 79 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + convex-test |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run convex/screening/queries.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run convex/screening/queries.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 79-01-01 | 01 | 1 | EXP-01 | unit | `npx vitest run convex/screening/queries.test.ts -t "returns results for owner"` | ❌ W0 | ⬜ pending |
| 79-01-02 | 01 | 1 | EXP-01 | unit | `npx vitest run convex/screening/queries.test.ts -t "returns null for unauthenticated"` | ❌ W0 | ⬜ pending |
| 79-01-03 | 01 | 1 | EXP-01 | unit | `npx vitest run convex/screening/queries.test.ts -t "returns null for non-owner"` | ❌ W0 | ⬜ pending |
| 79-01-04 | 01 | 1 | EXP-01 | unit | `npx vitest run convex/screening/queries.test.ts -t "bounded"` | ❌ W0 | ⬜ pending |
| 79-01-05 | 01 | 1 | EXP-01 | unit | `npx vitest run convex/screening/queries.test.ts -t "failed"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `convex/screening/queries.test.ts` — add `seedScreeningResult` helper
- [ ] `convex/screening/queries.test.ts` — add `describe("getScreeningResultsForExport", ...)` test block with stubs for EXP-01

*Existing infrastructure covers framework install — vitest and convex-test already configured.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
