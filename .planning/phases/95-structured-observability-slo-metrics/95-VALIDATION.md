---
phase: 95
slug: structured-observability-slo-metrics
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 95 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (already configured in project) |
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
| 95-01-01 | 01 | 1 | OBS-01 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 95-01-02 | 01 | 1 | OBS-02 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 95-01-03 | 01 | 1 | OBS-03 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 95-02-01 | 02 | 2 | OBS-04 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 95-02-02 | 02 | 2 | OBS-05 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `convex/extraction/__tests__/logging.test.ts` — stubs for OBS-01, OBS-02, OBS-03 structured log tests
- [ ] `convex/extraction/__tests__/metrics.test.ts` — stubs for OBS-04 metrics query test
- [ ] `convex/extraction/__tests__/slo.test.ts` — stubs for OBS-05 SLO metric persistence test

*Existing vitest infrastructure covers framework requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| UI metrics panel renders correctly | OBS-04 | Visual rendering verification | Start dev server, create extraction job, verify metrics panel shows papers-processed, avg latency, estimated cost, error counts |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
