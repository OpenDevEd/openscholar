---
phase: 89
slug: core-schema-workflow-skeleton
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 89 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + convex-test |
| **Config file** | `vitest.config.mts` |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 89-01-01 | 01 | 1 | WORK-01 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 89-01-02 | 01 | 1 | WORK-02 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 89-02-01 | 02 | 1 | WORK-06 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 89-02-02 | 02 | 1 | WORK-07 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `convex/extraction/__tests__/schema.test.ts` — stubs for WORK-01, WORK-02
- [ ] `convex/extraction/__tests__/workflow.test.ts` — stubs for WORK-06, WORK-07

*Existing vitest + convex-test infrastructure covers framework requirements.*

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
