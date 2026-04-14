---
gsd_state_version: 1.0
milestone: v6.0
milestone_name: Extraction MVP Rebuild
status: active
stopped_at: Roadmap approved, ready to plan Phase 88
last_updated: "2026-04-14T00:00:00.000Z"
last_activity: 2026-04-14 — Roadmap created for v6.0 (10 phases, 63 requirements mapped)
progress:
  total_phases: 10
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-14)

**Core value:** Reliable, well-tested academic search and AI extraction
**Current focus:** v6.0 Extraction MVP Rebuild — Phase 88 Scorched-Earth Teardown

## Current Position

Phase: 88 of 97 (Scorched-Earth Teardown)
Plan: — (not yet planned)
Status: Ready to plan
Last activity: 2026-04-14 — Roadmap created, 63 v6.0 requirements mapped across 10 phases

Progress: [          ] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 179 (v1.0: 7, v1.1: 6, v1.2: 11, v2.0: 17, v2.1: 15, v2.2: 7, v2.3: 14, v2.4: 7, v2.5: 15, v3.0: 11, v3.1: 20, v3.2: 4, v4.0: 9, v4.1: 5, v5.0: 14, cleanup: 2, quick: 15)
- Total milestones shipped: 15

**By Milestone:**

| Milestone | Phases | Plans | Shipped |
|-----------|--------|-------|---------|
| v1.0 | 3 | 7 | 2026-02-27 |
| v1.1 | 3 | 6 | 2026-02-27 |
| v1.2 | 7 | 11 | 2026-02-28 |
| v2.0 | 8 | 17 | 2026-02-28 |
| v2.1 | 8 | 15 | 2026-03-01 |
| v2.2 | 4 | 7 | 2026-03-02 |
| v2.3 | 8 | 14 | 2026-03-02 |
| v2.4 | 4 | 7 | 2026-03-03 |
| v2.5 | 7 | 15 | 2026-03-03 |
| v3.0 | 6 | 11 | 2026-03-04 |
| v3.1 | 12 | 20 | 2026-03-05 |
| v3.2 | 3 | 4 | 2026-03-06 |
| v4.0 | 4 | 9 | 2026-03-09 |
| v4.1 | 4 | 5 | 2026-03-09 |
| v5.0 | 5 | 14 | 2026-03-10 |

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full log.

**v6.0-specific direction (locked):**
- Legacy extraction code and data are DEAD — wipe tables, delete files, no migration, no backward compat
- OpenRouter via Vercel AI SDK 6 is the only LLM surface
- Gemini 3 Flash / 2.5 Flash Lite / Haiku 4.5 — NO Grok 4.1 Fast (92.89% JSON validity dealbreaker)
- No chunking, no RAG, no vector DB — 1M-context whole-paper extraction
- Deterministic quoting via `fastest-levenshtein` 85% threshold is the hallucination defense
- Europe PMC + arXiv HTML + Gemini-as-PDF-parser replaces Docling/MinerU/olmOCR (free tier, MVP-appropriate)
- `vitest-evals` + `autoevals` + 20-case golden set is the MVP eval loop — no Langfuse, no Braintrust
- Target cost <$50/month total for MVP volume
- Phase 88 MUST be first (teardown) — all subsequent phases depend on a clean slate
- Parsing (Phase 90) must land before extraction (Phase 91) — extraction reads parsed text
- UI polish (Phase 97) is last — built against stable backend

### Pending Todos

None.

### Roadmap Evolution

2026-04-14 — v6.0 roadmap created with 10 phases (88-97) mapping all 63 v6.0 requirements.

### Blockers/Concerns

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Status | Directory |
|---|-------------|------|--------|--------|-----------|
| 2 | Add eKitabu to Built by footer | 2026-03-02 | abd98e1 | | [2-add-ekitabu-to-built-by-footer](./quick/2-add-ekitabu-to-built-by-footer/) |
| 3 | Remove GROBID implementation | 2026-03-04 | d20c59e | | [3-get-rid-of-the-grobid-implementation-ent](./quick/3-get-rid-of-the-grobid-implementation-ent/) |
| 4 | Fix billing e2e auth to use clerk testing token | 2026-03-05 | 6792c9d | | [4-fix-billing-e2e-auth-to-use-clerk-testin](./quick/4-fix-billing-e2e-auth-to-use-clerk-testin/) |
| 5 | Denormalized counters backfill (library + collections) | 2026-03-06 | b6f2446 | | [5-denormalized-counters-backfill-libraryit](./quick/5-denormalized-counters-backfill-libraryit/) |
| 6 | Audit schema vs validators (no mismatches found) | 2026-03-06 | -- | | [6-check-if-theres-any-such-issues](./quick/6-check-if-theres-any-such-issues/) |
| 7 | Redesign screening modal UI/UX | 2026-03-09 | eb1ccb1 | | [7-redesign-screening-modal-ui-ux](./quick/7-redesign-screening-modal-ui-ux/) |
| 8 | Improve create-collection inline flow | 2026-03-09 | c27344b | | [8-improve-create-new-collection-inline-flo](./quick/8-improve-create-new-collection-inline-flo/) |
| 9 | Polish create-collection inline flow | 2026-03-09 | 79fce1e | | [9-polish-screening-dialog-visual-design](./quick/9-polish-screening-dialog-visual-design/) |
| 10 | Extract screening progress into standalone dialog | 2026-03-09 | 12d954f | | [10-extract-screening-progress-into-standalo](./quick/10-extract-screening-progress-into-standalo/) |
| 11 | Move screening button to sidebar footer with progress ring | 2026-03-09 | 6a8dc0b | | [11-move-screening-button-to-sidebar-footer-](./quick/11-move-screening-button-to-sidebar-footer-/) |
| 12 | Enhance screening jobs modal UI/UX | 2026-03-09 | 90e8dc7 | Verified | [12-enhance-screening-jobs-modal-ui-ux-with-](./quick/12-enhance-screening-jobs-modal-ui-ux-with-/) |
| 13 | Disable Review Queue and Report Builder feature flags | 2026-03-10 | 6588d1b | Verified | [13-disable-review-queue-and-report-builder](./quick/13-disable-review-queue-and-report-builder/) |

## Session Continuity

Last activity: 2026-04-14 — v6.0 roadmap created (10 phases, 63 requirements mapped)
Stopped at: Roadmap approved, ready to plan Phase 88 (Scorched-Earth Teardown)
Resume file: None
