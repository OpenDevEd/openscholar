---
gsd_state_version: 1.0
milestone: v3.1
milestone_name: Complete Type Safety
status: unknown
last_updated: "2026-03-04T22:08:33.810Z"
progress:
  total_phases: 10
  completed_phases: 7
  total_plans: 14
  completed_plans: 14
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-04)

**Core value:** Reliable, well-tested academic search and AI extraction
**Current focus:** v3.1 Complete Type Safety — Phase 66 in progress

## Current Position

Phase: 66 of 67 (Test Files)
Plan: 2 of 2 (all complete)
Status: Phase 66 complete
Last activity: 2026-03-04 — Completed 66-02 (Client/Export/AI/Billing Test Type Safety)

Progress: [██████░░░░] 24%

## Performance Metrics

**Velocity:**
- Total plans completed: 130 (v1.0: 7, v1.1: 6, v1.2: 11, v2.0: 17, v2.1: 15, v2.2: 7, v2.3: 14, v2.4: 7, v2.5: 15, v3.0: 11, v3.1: 9, cleanup: 1, quick: 2)
- Total milestones shipped: 10

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
| Phase 62 P01 | 3min | 2 tasks | 4 files |
| Phase 63 P01 | 6min | 2 tasks | 3 files |
| Phase 63 P03 | 14min | 2 tasks | 5 files |
| Phase 63 P02 | 15min | 2 tasks | 7 files |
| Phase 64 P02 | 7min | 2 tasks | 7 files |
| Phase 64 P01 | 8min | 2 tasks | 9 files |
| Phase 65 P01 | 3min | 2 tasks | 4 files |
| Phase 66 P01 | 5min | 2 tasks | 7 files |
| Phase 66 P02 | 6min | 2 tasks | 11 files |

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full log.

- [60-01] Used v.record(v.string(), v.number()) for dynamic status-count maps in extraction debug returns
- [60-01] Kept v.any() for Clerk webhook data -- v.unknown() not available in Convex 1.32.0
- [60-01] Used v.string() for schema union literal fields in return validators for simplicity
- [60-02] Used inline conditional spread for subscription patch instead of Partial<Doc<"subscriptions">> -- eliminates mutable variable
- [60-02] Reused existing ChunkMetadata interface for prepareChunksForRag return type -- exact shape match
- [60-03] Serialize Clerk webhook data as JSON string (v.string()) since Convex 1.32.0 lacks v.unknown()
- [60-03] Explicit unknown type annotation on JSON.parse result to match processClerkWebhookEvent parameter type
- [61-01] Used WorkflowPaper type with SourceType union and as const for narrow literal types in workflow paper accumulator
- [61-01] Cast storageId to Id<'_storage'> at mutation call site (PaperData uses string, mutation expects branded Id)
- [61-01] Used inline types for Zotero/manual items matching exact schema validator shapes
- [61-02] Removed : any from user variables -- Convex infers return type from query validators (no explicit Doc<users> needed)
- [61-02] Used error: unknown with existing instanceof type guards for Stripe errors
- [61-02] Imported ActionCtx from _generated/server instead of GenericActionCtx<DataModel> from convex/server
- [62-01] Direct Doc<extractionResults> property access for citationStatus, citations, retrievalDiagnostics -- all fields exist in schema
- [62-01] Destructure out storageId in testWorkflow paper mapping to avoid string vs Id<_storage> mismatch
- [62-01] Id<TableNames> for generic dedupeById instead of Id<any> -- preserves genericity with type safety
- [63-01] Recursive JsonValue type for dynamic JSON instead of any -- covers all JSON-serializable shapes
- [63-01] as never instead of as any at Convex useQuery/usePaginatedQuery boundary -- satisfies generic constraints without widening
- [63-01] unknown with internal typed casts for Zustand persist migrate -- correct since persisted shape varies by version
- [63-01] String() and typeof narrowing for Record<string, unknown> values in import functions
- [63-03] WorkInput interface instead of SDK Work type -- nested Authorship.Author requires id field that callers and tests omit
- [63-03] Parameters<typeof generateObject>[0] via unknown for execute.ts -- SDK generic constraints too complex for direct narrowing
- [63-03] as never for Convex useAction bridge in hook-factory.ts -- same pattern as use-auth-query.ts
- [Phase 63-02]: Used ExtractionResultLike minimal interface for citation helpers instead of full model import
- [Phase 63-02]: Bridge metadata type through unknown for cross-module downloadWithMetadata compatibility
- [Phase 63-02]: Used Partial<typeof urlParams> for nuqs setUrlParams type cast instead of as any
- [Phase 64]: Used Infer<typeof extractionSavedViewValidator> for onApplySavedView callback instead of ExtractionSavedView -- Convex return type has Id<> and number[] that differ from frontend interface
- [Phase 64]: Cast charRange to [number, number] tuple in review-queue -- Convex returns number[] but CitationLocation requires tuple
- [Phase 64]: Converted DateRange dates to ISO strings in job-creator sourceHistoryEntries -- react-day-picker DateRange uses Date objects but Convex mutation expects strings
- [Phase 64]: Extended PaperResult with Omit<Work, 'sustainable_development_goals'> & {...} to properly type API fields missing from SDK (fwci, primary_topic, cited_by_percentile_year, referenced_works_count)
- [Phase 64]: Widened shared component prop types (AuthorsLine, JournalLine, OpenAccessBadge, DOIBadge, ScreeningResponses) to accept optional fields from PaperResult
- [Phase 65]: DeepPartial<T> with deep merge for context factory overrides -- enables selective nested mock customization
- [Phase 65]: TableNames | SystemTableNames constraint on mockId generic -- satisfies Convex Id<T> type parameter requirement
- [Phase 65]: Added createMockExtractionResult beyond plan spec -- commonly mocked in extraction tests alongside papers
- [Phase 66]: Used createMockMutationCtx for requirePlanTier tests since it expects MutationCtx (not QueryCtx)
- [Phase 66]: Kept local createMockMutationCtx in user-creation.test.ts with Record<string, unknown> typing and MutationCtx cast for insert tracking
- [Phase 66]: Used explicit handler type signatures instead of as any for mutation mock access pattern
- [Phase 66]: TestRetrievalCandidate local type for non-exported workpoolActions internal -- avoids modifying production code exports
- [Phase 66]: as never for invalid plan name tests -- standard test pattern for type-safe invalid input testing without any
- [Phase 66]: TestSubscription interface local to each billing test file -- avoids cross-file coupling

### Roadmap Evolution

10 milestones shipped (v1.0 through v3.0). 59 phases, 121 plans total.
v3.1 adds 8 phases (60-67) for complete type safety.

### Pending Todos

None.

### Blockers/Concerns

- convex/_generated/ contains any types but is auto-generated and excluded from scope
- Some any types may be forced by third-party library APIs (will need `// eslint-disable` or wrapper types)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 2 | Add eKitabu to Built by footer | 2026-03-02 | abd98e1 | [2-add-ekitabu-to-built-by-footer](./quick/2-add-ekitabu-to-built-by-footer/) |
| 3 | Remove GROBID implementation | 2026-03-04 | d20c59e | [3-get-rid-of-the-grobid-implementation-ent](./quick/3-get-rid-of-the-grobid-implementation-ent/) |

## Session Continuity

Last activity: 2026-03-04 - Completed 66-02 Client/Export/AI/Billing Test Type Safety
Stopped at: Completed 66-02-PLAN.md (Phase 66 all 2 plans complete)
Resume file: None
