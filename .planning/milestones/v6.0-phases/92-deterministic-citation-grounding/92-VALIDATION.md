---
phase: 92
slug: deterministic-citation-grounding
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 92 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm vitest run convex/extraction/extract.test.ts` |
| **Full suite command** | `pnpm vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run convex/extraction/extract.test.ts`
- **After every plan wave:** Run `pnpm vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 92-01-01 | 01 | 1 | EXTR-03 | — | Levenshtein <85% rejects extraction | unit | `pnpm vitest run convex/extraction/extract.test.ts -t "Levenshtein"` | ❌ W0 | ⬜ pending |
| 92-01-02 | 01 | 1 | EXTR-05 | — | Critic unsupported flips to insufficient_evidence | unit | `pnpm vitest run convex/extraction/extract.test.ts -t "critic"` | ❌ W0 | ⬜ pending |
| 92-01-03 | 01 | 1 | EXTR-08 | — | insufficient_evidence caps confidence at low | unit | `pnpm vitest run convex/extraction/extract.test.ts -t "insufficient"` | ❌ W0 | ⬜ pending |
| 92-02-01 | 02 | 2 | EXTR-04 | — | UI renders bodyText.slice not evidenceQuote | component | `pnpm vitest run --reporter=verbose` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test stubs for Levenshtein verification, critic pass, insufficient_evidence in `convex/extraction/extract.test.ts`
- [ ] Existing vitest infrastructure covers all phase requirements

*Existing infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| EvidenceQuote renders correct slice visually | EXTR-04 | Visual rendering requires browser | Open extraction result, verify highlighted text matches source span |
| insufficient_evidence card visual state | EXTR-08 | Visual styling requires browser | Trigger insufficient_evidence, verify muted card with info icon |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
