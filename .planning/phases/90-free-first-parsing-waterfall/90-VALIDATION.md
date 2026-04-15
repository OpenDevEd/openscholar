---
phase: 90
slug: free-first-parsing-waterfall
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 90 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --reporter=verbose tests/extraction/parse` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose tests/extraction/parse`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 90-01-01 | 01 | 1 | PARSE-01 | — | N/A | unit | `npx vitest run tests/extraction/parse.test.ts -t "OpenAlex metadata"` | ❌ W0 | ⬜ pending |
| 90-01-02 | 01 | 1 | PARSE-02 | — | N/A | unit | `npx vitest run tests/extraction/parse.test.ts -t "PMC JATS"` | ❌ W0 | ⬜ pending |
| 90-01-03 | 01 | 1 | PARSE-03 | — | N/A | unit | `npx vitest run tests/extraction/parse.test.ts -t "arXiv HTML"` | ❌ W0 | ⬜ pending |
| 90-01-04 | 01 | 1 | PARSE-04 | — | N/A | unit | `npx vitest run tests/extraction/parse.test.ts -t "unpdf"` | ❌ W0 | ⬜ pending |
| 90-01-05 | 01 | 1 | PARSE-05 | — | N/A | unit | `npx vitest run tests/extraction/parse.test.ts -t "Gemini"` | ❌ W0 | ⬜ pending |
| 90-01-06 | 01 | 1 | PARSE-06 | — | N/A | unit | `npx vitest run tests/extraction/parse.test.ts -t "abstract_only"` | ❌ W0 | ⬜ pending |
| 90-01-07 | 01 | 1 | PARSE-07 | — | N/A | unit | `npx vitest run tests/extraction/parse.test.ts -t "timeout"` | ❌ W0 | ⬜ pending |
| 90-01-08 | 01 | 1 | PARSE-08 | — | N/A | unit | `npx vitest run tests/extraction/parse.test.ts -t "200-page"` | ❌ W0 | ⬜ pending |
| 90-01-09 | 01 | 1 | PARSE-09 | — | N/A | unit | `npx vitest run tests/extraction/parse.test.ts -t "parsingSource"` | ❌ W0 | ⬜ pending |
| 90-01-10 | 01 | 1 | PARSE-10 | — | N/A | integration | `npx vitest run tests/extraction/parse.test.ts -t "result card"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/extraction/parse.test.ts` — test stubs for all PARSE-XX requirements
- [ ] Test fixtures: PMC JATS XML snippet, arXiv HTML snippet, sample PDF metadata

*Existing vitest infrastructure covers framework installation.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Result card renders `parsingSource` tag | PARSE-10 | Requires visual UI inspection | Open result card for a processed paper, verify `parsing_source` badge is visible |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
