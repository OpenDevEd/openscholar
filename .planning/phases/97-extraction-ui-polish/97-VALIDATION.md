---
phase: 97
slug: extraction-ui-polish
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 97 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
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
| 97-01-01 | 01 | 1 | UI-05 | — | N/A | manual | i18n key check via grep | ❌ W0 | ⬜ pending |
| 97-02-01 | 02 | 1 | UI-01 | — | N/A | component | `npx vitest run` | ❌ W0 | ⬜ pending |
| 97-02-02 | 02 | 1 | UI-02 | — | N/A | component | `npx vitest run` | ❌ W0 | ⬜ pending |
| 97-03-01 | 03 | 2 | UI-03 | — | N/A | component | `npx vitest run` | ❌ W0 | ⬜ pending |
| 97-03-02 | 03 | 2 | UI-04 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 97-04-01 | 04 | 2 | UI-06 | — | N/A | integration | `npx vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements. vitest is installed and configured.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| WCAG AAA contrast (7:1) | UI-06 | Requires visual inspection of OKLCH tokens in both light/dark modes | Check all text/background pairs against OKLCH contrast calculator |
| Framer Motion spring animations | UI-06 | Animation quality is subjective | Verify animations feel responsive, respect prefers-reduced-motion |
| Sidebar footer button visual | UI-02 | Layout/visual integration | Verify circular progress ring renders correctly in sidebar |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
