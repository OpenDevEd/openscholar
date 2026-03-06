---
phase: 73
slug: library-count-optimization
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-06
---

# Phase 73 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (edge-runtime for convex tests) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run convex/library/queries.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run convex/library/queries.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 73-01-01 | 01 | 0 | PERF-01, PERF-02, PERF-03 | unit | `npx vitest run convex/library/queries.test.ts` | ❌ W0 | ⬜ pending |
| 73-02-01 | 02 | 1 | PERF-01 | unit | `npx vitest run convex/library/queries.test.ts -t "getLibraryCount"` | ❌ W0 | ⬜ pending |
| 73-02-02 | 02 | 1 | PERF-02 | unit | `npx vitest run convex/library/queries.test.ts -t "counter"` | ❌ W0 | ⬜ pending |
| 73-03-01 | 03 | 2 | PERF-03 | unit | `npx vitest run convex/library/queries.test.ts -t "backfill"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] New test cases for counter increment/decrement across all 3 mutation paths
- [ ] New test case for lazy backfill (user has items but no counter field)
- [ ] New test case for upsert not double-counting (re-rate should not increment)
- [ ] New test case for counter not going below zero on remove with undefined counter
- [ ] Update existing `getLibraryCount` tests to work with new counter-based approach

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
