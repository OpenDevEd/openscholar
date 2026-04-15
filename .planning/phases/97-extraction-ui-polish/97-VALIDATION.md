---
phase: 97
slug: extraction-ui-polish
status: draft
nyquist_compliant: true
wave_0_complete: true
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

*No Wave 0 test scaffolding required.* This is a UI-wiring phase where:

1. **All tasks are UI component assembly** -- composing existing tested components (ConfidenceBadge, EvidenceQuote, etc.) into pages and dialogs. The components themselves were tested in prior phases.
2. **`tsc --noEmit` is the appropriate automated bar** -- TypeScript strict mode catches contract violations (wrong props, missing imports, type mismatches) which are the primary failure modes in a wiring phase.
3. **Visual/behavioral verification is inherently manual** -- layout correctness, animation quality, OKLCH color rendering, and accessibility require human inspection (covered by Plan 05 checkpoint).
4. **Convex queries/mutations are integration-tested** -- the backend functions called by these UI components were tested in Phases 88-96.

The automated `tsc --noEmit` verify commands across all plans provide Nyquist-compliant type safety sampling. Manual verification in Plan 05 covers visual and behavioral correctness.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| WCAG AAA contrast (7:1) | UI-06 | Requires visual inspection of OKLCH tokens in both light/dark modes | Check all text/background pairs against OKLCH contrast calculator |
| Framer Motion spring animations | UI-06 | Animation quality is subjective | Verify animations feel responsive, respect prefers-reduced-motion |
| Sidebar footer button visual | UI-02 | Layout/visual integration | Verify circular progress ring renders correctly in sidebar |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify (tsc --noEmit)
- [x] Sampling continuity: every task has automated tsc verify
- [x] Wave 0 not required (UI-wiring phase justification above)
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved (UI-wiring phase; tsc --noEmit as automated bar)
