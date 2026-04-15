---
phase: 99
slug: selection-basket-core
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 99 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 99-01-01 | 01 | 1 | SEL-08 | — | N/A | unit | `npx vitest run lib/openalex/normalize.test.ts` | ❌ W0 | ⬜ pending |
| 99-01-02 | 01 | 1 | SEL-07 | — | N/A | unit | `npx vitest run lib/store/extraction-basket.test.ts` | ❌ W0 | ⬜ pending |
| 99-02-01 | 02 | 2 | SEL-09 | — | N/A | manual | Browser: open drawer, verify count + sections | N/A | ⬜ pending |
| 99-02-02 | 02 | 2 | SEL-10 | — | N/A | manual | Browser: add paper, verify "already in basket" indicator | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `lib/openalex/normalize.test.ts` — unit tests for normalizeOpenAlexId (SEL-08)
- [ ] `lib/store/extraction-basket.test.ts` — unit tests for basket store add/remove/dedupe/sessionStorage (SEL-07)

*Existing vitest infrastructure covers framework installation.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Drawer opens with count + per-source sections + CTA | SEL-09 | UI interaction requires browser | Click basket icon → verify Sheet opens with correct counts, source grouping, and "Review & start extraction" button |
| "Already in basket" indicator visible in source lists | SEL-10 | Visual indicator requires rendered DOM | Add paper → navigate to source list → verify muted/checked state with "In basket" label |
| Basket survives in-app navigation | SEL-07 | Navigation state requires browser routing | Add papers → navigate away → return → verify count persists |
| Basket per-tab isolation via sessionStorage | SEL-07 | Multi-tab requires browser | Add papers in tab 1 → open tab 2 → verify tab 2 basket is empty |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
