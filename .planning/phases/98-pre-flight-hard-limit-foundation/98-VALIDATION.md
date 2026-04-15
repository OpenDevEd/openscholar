---
phase: 98
slug: pre-flight-hard-limit-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 98 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.4 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 98-01-01 | 01 | 1 | LIM-01 | — | N/A | unit | `npx vitest run convex/lib/queryBounds.test.ts` | ❌ W0 | ⬜ pending |
| 98-01-02 | 01 | 1 | LIM-02 | — | N/A | unit | `npx vitest run convex/lib/queryBounds.test.ts` | ❌ W0 | ⬜ pending |
| 98-02-01 | 02 | 1 | LIM-03 | — | N/A | unit | `npx vitest run convex/extraction/queries.test.ts` | ❌ W0 | ⬜ pending |
| 98-03-01 | 03 | 2 | GAP-04 | — | N/A | benchmark | `npx vitest run convex/extraction/benchmark.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `convex/lib/queryBounds.test.ts` — stubs for LIM-01, LIM-02
- [ ] `convex/extraction/queries.test.ts` — stubs for LIM-03
- [ ] `convex/extraction/benchmark.test.ts` — benchmark harness for GAP-04

*Existing vitest infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Benchmark accuracy with production-like data | GAP-04 | Synthetic data may not reflect real field sizes | Inspect benchmark output for realistic answer/evidence sizes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
