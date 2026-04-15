---
phase: 93
slug: workflow-cancel-retry-and-progress
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 93 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | `vitest.config.ts` |
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
| 93-01-01 | 01 | 1 | WORK-03 | — | N/A | unit | `npx vitest run convex/extraction/cancel.test.ts` | ❌ W0 | ⬜ pending |
| 93-01-02 | 01 | 1 | WORK-04 | — | N/A | unit | `npx vitest run convex/extraction/cancel.test.ts` | ❌ W0 | ⬜ pending |
| 93-01-03 | 01 | 1 | WORK-05 | — | N/A | unit | `npx vitest run convex/extraction/errors.test.ts` | ❌ W0 | ⬜ pending |
| 93-01-04 | 01 | 1 | WORK-08 | — | N/A | unit | `npx vitest run convex/extraction/cancel.test.ts` | ❌ W0 | ⬜ pending |
| 93-01-05 | 01 | 1 | WORK-09 | — | N/A | unit | `npx vitest run convex/extraction/queries.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `convex/extraction/cancel.test.ts` — stubs for WORK-03, WORK-04, WORK-08
- [ ] `convex/extraction/errors.test.ts` — stubs for WORK-05

*Existing test infrastructure (vitest, factories) covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Reactive progress under-1-second latency | WORK-09 | Requires live Convex subscriptions | Start extraction, cancel mid-run, observe progress counters update reactively |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
