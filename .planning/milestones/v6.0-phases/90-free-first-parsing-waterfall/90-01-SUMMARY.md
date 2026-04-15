---
phase: 90-free-first-parsing-waterfall
plan: 01
subsystem: extraction-parsing
tags: [schema, validators, config, dependencies, mutations]
dependency_graph:
  requires: []
  provides:
    - parsingSourceValidator
    - bodyText schema field
    - parsingSource schema field
    - storeParsedText mutation
    - updatePaperStatus mutation
    - convex.json config
    - fast-xml-parser dependency
    - linkedom dependency
    - unpdf dependency
  affects:
    - convex/schema.ts
    - convex/extraction/validators.ts
    - convex/extraction/mutations.ts
tech_stack:
  added:
    - fast-xml-parser@^5.5.12
    - linkedom@^0.18.12
    - unpdf@^1.6.0
  patterns:
    - DRY validator reuse (parsingSourceValidator shared between schema.ts and mutations.ts)
    - internalMutation for background context mutations
key_files:
  created:
    - convex.json
  modified:
    - convex/extraction/validators.ts
    - convex/schema.ts
    - convex/extraction/mutations.ts
    - package.json
    - pnpm-lock.yaml
decisions:
  - "Used pnpm (not npm) for dependency installation since node_modules are pnpm-managed with symlinks"
  - "parsingSourceValidator is single source of truth imported by both schema.ts and mutations.ts (DRY per D-08)"
metrics:
  duration: 3m 1s
  completed: "2026-04-15T02:04:56Z"
  tasks: 2/2
  files_changed: 5
---

# Phase 90 Plan 01: Schema, Config, and Dependencies Summary

Schema foundation for free-first parsing waterfall: parsingSourceValidator (pmc|arxiv|unpdf|gemini|abstract_only), bodyText/parsingSource fields on extractionPapers, convex.json with Node 22 + unpdf external, three parsing dependencies installed, storeParsedText and updatePaperStatus internal mutations.

## Completed Tasks

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | Add parsingSourceValidator, schema fields, and convex.json | 7aa615f | parsingSourceValidator export, bodyText/parsingSource on extractionPapers, convex.json |
| 2 | Install dependencies and create storeParsedText mutation | 19432cc | fast-xml-parser/linkedom/unpdf installed, storeParsedText and updatePaperStatus mutations |

## Key Files

### Created
- `convex.json` -- Node 22 runtime config with unpdf as external package (D-15, PARSE-08)

### Modified
- `convex/extraction/validators.ts` -- Added `parsingSourceValidator` (5-member union: pmc, arxiv, unpdf, gemini, abstract_only)
- `convex/schema.ts` -- Added `bodyText: v.optional(v.string())` and `parsingSource: v.optional(parsingSourceValidator)` to extractionPapers table, imported parsingSourceValidator from validators
- `convex/extraction/mutations.ts` -- Added `storeParsedText` (persists parsed text, transitions paper to "extracting") and `updatePaperStatus` (generic status updater) internal mutations
- `package.json` -- Added fast-xml-parser@^5.5.12, linkedom@^0.18.12, unpdf@^1.6.0 as production dependencies
- `pnpm-lock.yaml` -- Updated lockfile with new dependency resolutions

## Decisions Made

1. **pnpm for dependency management** -- node_modules are pnpm-managed (symlinked to .pnpm store). npm install fails with ENOTDIR on pnpm-structured node_modules. Installed pnpm globally and used it for the install.
2. **DRY validator pattern** -- parsingSourceValidator defined once in validators.ts, imported in both schema.ts and mutations.ts. No inline duplication (D-08).

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

- parsingSourceValidator exported from validators.ts with all 5 literals (pmc, arxiv, unpdf, gemini, abstract_only)
- bodyText and parsingSource fields present on extractionPapers table in schema.ts
- parsingSourceValidator imported (not duplicated) in schema.ts
- convex.json at project root with nodeVersion "22" and externalPackages ["unpdf"]
- storeParsedText internalMutation with paperId, bodyText, parsingSource args; patches paper and transitions to "extracting"
- updatePaperStatus internalMutation with paperId, status, optional errorMessage args
- fast-xml-parser, linkedom, unpdf in package.json dependencies
- TypeScript compilation: zero new errors (9 pre-existing errors in mutations.test.ts and handleExtractionComplete workpool handler, all unrelated to this plan's changes)

## Self-Check: PASSED

- All 5 key files verified on disk (convex.json, validators.ts, schema.ts, mutations.ts, SUMMARY.md)
- Commit 7aa615f verified in git log (Task 1)
- Commit 19432cc verified in git log (Task 2)
