---
phase: 75
slug: schema-job-infrastructure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 75 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + convex-test |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run convex/screening/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run convex/screening/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | JOB-01 | unit | `npx vitest run convex/screening/mutations.test.ts -t "createScreeningJob"` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | JOB-01 | unit | `npx vitest run convex/screening/mutations.test.ts -t "rejects.*exceed"` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | JOB-01 | unit | `npx vitest run convex/screening/mutations.test.ts -t "active.*job"` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | JOB-04 | unit | `npx vitest run convex/screening/mutations.test.ts -t "insufficient.*credits"` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | JOB-04 | unit | `npx vitest run convex/screening/mutations.test.ts -t "sufficient.*credits"` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | JOB-07 | unit | `npx vitest run convex/screening/mutations.test.ts -t "cancel"` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | JOB-07 | unit | `npx vitest run convex/screening/mutations.test.ts -t "preserves.*results"` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | JOB-07 | unit | `npx vitest run convex/screening/mutations.test.ts -t "idempotent"` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | PROG | unit | `npx vitest run convex/screening/queries.test.ts -t "progress"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `convex/screening/mutations.test.ts` — stubs for JOB-01, JOB-04, JOB-07
- [ ] `convex/screening/queries.test.ts` — stubs for progress query
- [ ] `convex/screening/` directory — new domain module

*Existing infrastructure covers test framework (vitest + convex-test already installed and configured).*

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
