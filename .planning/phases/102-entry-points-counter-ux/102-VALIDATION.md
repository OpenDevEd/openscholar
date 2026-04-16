---
phase: 102
slug: entry-points-counter-ux
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 102 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 102-01-01 | 01 | 1 | LIM-04 | — | N/A | visual | Manual browser check | — | ⬜ pending |
| 102-01-02 | 01 | 1 | LIM-05 | — | N/A | visual | Manual browser check | — | ⬜ pending |
| 102-01-03 | 01 | 1 | LIM-06 | — | N/A | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 102-02-01 | 02 | 1 | SEL-11 | — | N/A | visual | Manual browser check | — | ⬜ pending |
| 102-02-02 | 02 | 1 | SEL-12 | — | N/A | visual | Manual browser check | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Progress bar turns yellow at 80% | LIM-04 | Visual color transition | Add papers until 80% threshold, verify progress bar changes from primary to amber |
| Progress bar turns red at 100% | LIM-04 | Visual color transition | Fill basket to limit, verify progress bar changes to destructive red |
| Checkboxes disabled at cap | LIM-05 | Visual state across multiple mount points | Fill basket to cap, verify add buttons disabled in library, search, and selector |
| Tooltip shows correct message at cap | LIM-05 | Tooltip rendering | Hover disabled button, verify tooltip reads "Basket full — remove papers to continue" |
| Bulk-paste drop toast | LIM-06 | Toast notification display | Paste IDs exceeding capacity, verify toast shows exact added/dropped counts |
| AddToExtractionButton in library | SEL-11 | Mount point integration | Navigate to library, verify button appears for each paper item |
| AddToExtractionButton in search | SEL-11 | Mount point integration | Search for papers, verify button appears in each card variant |
| Sidebar badge shows live count | SEL-12 | Reactive badge rendering | Add/remove papers, verify badge count updates reactively |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
