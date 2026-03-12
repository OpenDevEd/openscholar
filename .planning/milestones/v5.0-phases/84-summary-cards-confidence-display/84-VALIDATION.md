---
phase: 84
slug: summary-cards-confidence-display
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 84 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.4 with @testing-library/react 16.3.2 |
| **Config file** | `vitest.config.ts` (environment: jsdom for component tests) |
| **Quick run command** | `npm test -- tests/summary-cards.test.tsx tests/confidence-badge.test.tsx` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~8 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- tests/summary-cards.test.tsx tests/confidence-badge.test.tsx`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 84-01-01 | 01 | 1 | CARD-01 | unit | `npm test -- tests/summary-cards.test.tsx -t "renders.*order"` | ❌ W0 | ⬜ pending |
| 84-01-02 | 01 | 1 | CARD-02 | unit | `npm test -- tests/card-thresholds.test.ts` | ❌ W0 | ⬜ pending |
| 84-01-03 | 01 | 1 | CARD-03 | unit | `npm test -- tests/summary-cards.test.tsx -t "hides.*zero"` | ❌ W0 | ⬜ pending |
| 84-02-01 | 02 | 1 | CONF-01 | unit | `npm test -- tests/confidence-badge.test.tsx -t "renders.*badge"` | ❌ W0 | ⬜ pending |
| 84-02-02 | 02 | 1 | CONF-02 | unit | `npm test -- tests/confidence-messages.test.ts` | ❌ W0 | ⬜ pending |
| 84-02-03 | 02 | 1 | CONF-03 | unit | `npm test -- tests/confidence-badge.test.tsx -t "color"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements:
- Vitest 3.2.4 handles component tests
- @testing-library/react provides structural assertion patterns (already used in Phase 83)
- jsdom environment configured in vitest.config.ts

**New test files to create (during plan execution, not Wave 0):**
- `tests/summary-cards.test.tsx` — CARD-01, CARD-02, CARD-03
- `tests/card-thresholds.test.ts` — CARD-02 threshold color logic
- `tests/confidence-badge.test.tsx` — CONF-01, CONF-03
- `tests/confidence-messages.test.ts` — CONF-02 tooltip messages

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Card visual order matches design | CARD-01 | Visual layout verification | Open insights overview, verify card order: answered → grounded → best effort → no content |
| Color accent visible without interaction | CARD-02 | Visual rendering check | Verify left border color on cards without hovering |
| Badge tooltip renders correctly | CONF-02 | Tooltip positioning/content | Hover confidence badge, verify tooltip text matches context |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
