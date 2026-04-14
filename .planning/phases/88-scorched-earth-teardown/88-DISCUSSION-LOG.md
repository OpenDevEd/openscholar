# Phase 88: Scorched-Earth Teardown - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-14
**Phase:** 88-scorched-earth-teardown
**Areas discussed:** Deletion Order, Screening Pipeline Boundaries, Shared Dependencies, Test Cleanup Scope
**Mode:** --auto (all decisions auto-selected)

---

## Deletion Order

| Option | Description | Selected |
|--------|-------------|----------|
| Schema-last approach | Remove consumers before providers: UI → components → lib → convex → schema → config | ✓ |
| Schema-first approach | Remove tables first, then fix all dangling refs in one pass | |
| Monolithic delete | Delete everything at once, fix all tsc errors in one sweep | |

**User's choice:** [auto] Schema-last approach (recommended default)
**Notes:** Removing consumers before providers avoids intermediate tsc breaks and enables layer-by-layer verification.

---

## Screening Pipeline Boundaries

| Option | Description | Selected |
|--------|-------------|----------|
| Remove only pdfProcessingPool | Keep screeningPool intact, it powers the working v4.0 feature | ✓ |
| Remove both pools | Follow TEAR-05 literally, replace both in Phase 89 | |
| Keep both pools | Defer all pool changes to Phase 89 | |

**User's choice:** [auto] Remove only pdfProcessingPool (recommended — destroying screening would break a shipped feature)
**Notes:** TEAR-05 wording is ambiguous but the intent is to replace the extraction pool, not the screening pool. screeningPool powers v4.0 bulk screening which is a separate, working feature.

---

## Shared Dependencies

| Option | Description | Selected |
|--------|-------------|----------|
| Surgical removal | Delete extraction-only files, strip extraction from shared files, preserve non-extraction | ✓ |
| Aggressive cleanup | Delete any file that touches extraction, rebuild shared files from scratch | |
| Minimal removal | Delete only the directories listed in TEAR-02/TEAR-03, fix imports manually | |

**User's choice:** [auto] Surgical removal (recommended — aligns with TEAR-10 zero dangling imports requirement)
**Notes:** Shared files like lib/store.ts, lib/types/index.ts, and potentially lib/pdf/download.ts need case-by-case evaluation rather than wholesale deletion.

---

## Test Cleanup Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Delete extraction tests, preserve all others | Remove tests/extraction/ and extraction-specific files, keep screening and all other tests | ✓ |
| Delete all extraction-related tests aggressively | Include edge-case tests that happen to use extraction fixtures | |
| Keep extraction test skeletons | Convert to skipped tests as documentation of what was tested | |

**User's choice:** [auto] Delete extraction tests, preserve all others (recommended)
**Notes:** Test count drop is acceptable for a teardown phase. Final pnpm test run validates no remaining tests reference deleted modules.

---

## Claude's Discretion

- File deletion order within each layer
- Git commit granularity (per layer vs per directory)
- lib/pdf/download.ts disposition (delete vs surgical edit) based on runtime analysis

## Deferred Ideas

None — discussion stayed within phase scope.
