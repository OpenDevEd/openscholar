---
phase: 74
slug: query-bounding-audit
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-06
---

# Phase 74 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (via convex-test) |
| **Config file** | `vitest.config.mts` |
| **Quick run command** | `npx vitest run convex/extraction/cascade-delete.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run convex/extraction/cascade-delete.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 74-01-01 | 01 | 1 | PERF-04 | code audit + build | `npx tsc --noEmit` | N/A | ⬜ pending |
| 74-01-02 | 01 | 1 | PERF-05 | unit | `npx vitest run convex/extraction/cascade-delete.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements. PERF-04 is verified by code inspection/grep audit, not automated tests.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `.collect()` calls have `.take(N)` guards | PERF-04 | Code audit pattern — grep-verified | `grep -rn '\.collect()' convex/ --include='*.ts'` and verify each has `.take(N)` or cardinality comment |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
