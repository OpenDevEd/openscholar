---
phase: 96
slug: eval-loop-quality-sampling
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 96 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x + vitest-evals + autoevals |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `RUN_EVALS=1 pnpm test tests/evals/` |
| **Estimated runtime** | ~30 seconds (golden set eval with LLM calls) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `RUN_EVALS=1 pnpm test tests/evals/`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 96-01-01 | 01 | 1 | EVAL-01 | — | N/A | unit | `pnpm test` | ❌ W0 | ⬜ pending |
| 96-01-02 | 01 | 1 | EVAL-02 | — | N/A | eval | `RUN_EVALS=1 pnpm test tests/evals/` | ❌ W0 | ⬜ pending |
| 96-01-03 | 01 | 1 | EVAL-03 | — | N/A | ci | `gh workflow run` | ❌ W0 | ⬜ pending |
| 96-02-01 | 02 | 2 | EVAL-04 | — | N/A | integration | `npx convex dev --once` | ❌ W0 | ⬜ pending |
| 96-02-02 | 02 | 2 | EVAL-05 | — | N/A | query | `pnpm test` | ❌ W0 | ⬜ pending |
| 96-02-03 | 02 | 2 | EVAL-06 | — | N/A | query | `pnpm test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/evals/screening-golden.ts` — golden set data file
- [ ] `tests/evals/screening-eval.test.ts` — eval test runner stubs
- [ ] `pnpm add -D vitest-evals autoevals` — install eval libraries

*Existing vitest infrastructure covers non-eval phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CI blocks merge on threshold failure | EVAL-03 | Requires actual PR workflow | Create canary branch with failing test, verify CI blocks |
| Hourly cron fires in production | EVAL-04 | Requires deployed environment | Deploy and monitor Convex dashboard for cron execution |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
