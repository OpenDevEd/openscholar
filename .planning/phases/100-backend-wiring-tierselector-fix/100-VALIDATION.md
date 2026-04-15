---
phase: 100
slug: backend-wiring-tierselector-fix
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 100 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
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
| 100-01-01 | 01 | 1 | TIER-01 | — | N/A | integration | `npx vitest run` | ❌ W0 | ⬜ pending |
| 100-01-02 | 01 | 1 | TIER-02 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 100-01-03 | 01 | 1 | TIER-03 | — | Cascade filters correctly | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 100-02-01 | 02 | 1 | LIM-07 | — | Hard-reject over-limit | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 100-03-01 | 03 | 1 | SEL-05 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 100-03-02 | 03 | 1 | ZOT-03 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test stubs for cascade tier filtering (TIER-03)
- [ ] Test stubs for extraction limit hard-reject (LIM-07)

*Existing infrastructure covers framework setup — vitest already configured.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Tier persists on job row in Convex dashboard | TIER-01 | Requires live Convex environment | Create extraction job with "accurate" tier, verify in Convex dashboard |
| OpenAlex API batch resolution | SEL-05 | External API call | Paste OpenAlex IDs, verify resolved metadata returned |
| DOI resolution within 10s | ZOT-03 | External API + timing | Call resolveByDoi with known DOI, verify response < 10s |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
