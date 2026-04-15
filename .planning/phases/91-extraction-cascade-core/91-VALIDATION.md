---
phase: 91
slug: extraction-cascade-core
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 91 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
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
| 91-01-01 | 01 | 1 | EXTR-09 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 91-01-02 | 01 | 1 | EXTR-02 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 91-02-01 | 02 | 1 | EXTR-06 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 91-02-02 | 02 | 1 | EXTR-07 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 91-03-01 | 03 | 2 | EXTR-01 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 91-03-02 | 03 | 2 | EXTR-10 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test files created for cascade, schema, parallelism verification
- [ ] Mock providers for OpenRouter model tiers

*Existing vitest infrastructure covers framework requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| OpenRouter models respond correctly | EXTR-06 | Live API required | Deploy and run extraction on a test paper |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
