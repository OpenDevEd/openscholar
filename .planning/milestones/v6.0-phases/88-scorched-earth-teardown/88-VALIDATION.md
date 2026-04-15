---
phase: 88
slug: scorched-earth-teardown
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-14
---

# Phase 88 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + tsc |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm tsc --noEmit` |
| **Full suite command** | `pnpm tsc --noEmit && pnpm test` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm tsc --noEmit`
- **After every plan wave:** Run `pnpm tsc --noEmit && pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 88-01-01 | 01 | 1 | TEAR-01 | — | N/A | compile | `pnpm tsc --noEmit` | ✅ | ⬜ pending |
| 88-01-02 | 01 | 1 | TEAR-02 | — | N/A | compile | `pnpm tsc --noEmit` | ✅ | ⬜ pending |
| 88-01-03 | 01 | 1 | TEAR-06 | — | N/A | compile | `pnpm tsc --noEmit` | ✅ | ⬜ pending |
| 88-02-01 | 02 | 2 | TEAR-03 | — | N/A | compile | `pnpm tsc --noEmit` | ✅ | ⬜ pending |
| 88-02-02 | 02 | 2 | TEAR-04 | — | N/A | compile | `pnpm tsc --noEmit` | ✅ | ⬜ pending |
| 88-02-03 | 02 | 2 | TEAR-05 | — | N/A | compile+grep | `pnpm tsc --noEmit && ! grep -r pdfProcessingPool convex/` | ✅ | ⬜ pending |
| 88-03-01 | 03 | 3 | TEAR-07 | — | N/A | grep | `! grep -r "extraction" messages/*.json` | ✅ | ⬜ pending |
| 88-03-02 | 03 | 3 | TEAR-08 | — | N/A | test | `pnpm test` | ✅ | ⬜ pending |
| 88-03-03 | 03 | 3 | TEAR-09, TEAR-10 | — | N/A | compile+test | `pnpm tsc --noEmit && pnpm test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements. This phase deletes code — no new test infrastructure needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Convex dashboard shows no extraction tables | TEAR-03 | Requires Convex dashboard inspection | After `npx convex deploy`, verify extraction tables absent from dashboard |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
