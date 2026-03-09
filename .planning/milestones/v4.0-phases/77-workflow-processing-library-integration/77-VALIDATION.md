---
phase: 77
slug: workflow-processing-library-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 77 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x + convex-test |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run convex/screening/ --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run convex/screening/ --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 77-01-01 | 01 | 1 | JOB-05 | unit | `npx vitest run convex/screening/workflow.test.ts -x` | ❌ W0 | ⬜ pending |
| 77-01-02 | 01 | 1 | JOB-05 | unit | `npx vitest run convex/screening/workpool.test.ts -x` | ❌ W0 | ⬜ pending |
| 77-01-03 | 01 | 1 | JOB-05 | unit | `npx vitest run convex/screening/workpool.test.ts -x` | ❌ W0 | ⬜ pending |
| 77-02-01 | 02 | 1 | LIB-01 | unit | `npx vitest run convex/screening/mutations.test.ts -x` | ❌ W0 | ⬜ pending |
| 77-02-02 | 02 | 1 | LIB-01 | unit | `npx vitest run convex/screening/mutations.test.ts -x` | ❌ W0 | ⬜ pending |
| 77-02-03 | 02 | 1 | LIB-02 | unit | `npx vitest run convex/screening/mutations.test.ts -x` | ❌ W0 | ⬜ pending |
| 77-02-04 | 02 | 1 | LIB-03 | unit | `npx vitest run convex/screening/mutations.test.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `convex/screening/workflow.test.ts` — stubs for JOB-05 workflow orchestration
- [ ] `convex/screening/workpool.test.ts` — stubs for JOB-05 fail-soft, credit guard
- [ ] Extend `convex/screening/mutations.test.ts` — stubs for LIB-01, LIB-02, LIB-03 library save + collection add

*Existing infrastructure (vitest, convex-test) covers framework requirements.*

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
