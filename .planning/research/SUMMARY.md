# Project Research Summary

**Project:** OpenAlex Count — v3.2 Production Readiness
**Domain:** Production readiness fixes for Convex-backed academic search/extraction platform
**Researched:** 2026-03-06
**Confidence:** HIGH

## Executive Summary

v3.2 addresses three production readiness concerns: publicly accessible debug endpoints (security), inefficient library document counting (performance), and unbounded `.collect()` calls on high-traffic paths (reliability). All three are backend-only changes to the existing Convex codebase. No frontend modifications are required. No new UI features ship in this milestone.

The recommended approach is straightforward: convert 4 remaining public debug/test functions to `internalQuery`/`internalMutation` (eliminating the attack surface architecturally rather than via env-var gates), replace the `getLibraryCount` document-scan with an atomic counter maintained in save/delete mutations, and add `.take(N)` bounds to the ~10 highest-traffic `.collect()` paths. Zero new npm packages are needed -- every capability uses existing Convex primitives already present in the codebase.

The primary risks are: (1) breaking generated API paths when changing function visibility (mitigated by running `tsc --noEmit` after conversion), (2) counter drift if increment/decrement is missed on a mutation path (mitigated by the fact that only 2 mutation entry points modify libraryItems), and (3) over-bounding safe `.collect()` calls that are inherently small (mitigated by categorizing each call by cardinality before acting). All three concerns have well-documented Convex patterns and the project already uses these patterns elsewhere (5 of 7 debug files are already internal; `extractionJobStats` uses the manual counter pattern; `.take()` is used extensively).

---

## Key Findings

### Recommended Stack

No new npm packages required. All three fixes use existing Convex primitives (`internalQuery`, `ctx.db.patch()`, `.take(N)`) available since well before the project's current `convex@^1.31.7`.

**Core technologies (all existing):**
- `internalQuery`/`internalMutation` from `convex/server` -- converts public debug endpoints to platform-enforced private functions
- `ctx.db.patch()` -- atomic increment/decrement for manual counter field on library item counts
- `.take(N)` on query builder -- explicit bounds for `.collect()` calls on high-traffic paths

**Disagreement resolved:** FEATURES.md and ARCHITECTURE.md recommend `@convex-dev/sharded-counter` for library counting. STACK.md recommends a manual counter field. **The manual counter field is the correct choice.** Rationale: library writes are user-initiated (not concurrent batch operations), only 2 mutation paths modify libraryItems, the project already rejected `@convex-dev/aggregate` for identical reasons in v3.0, and a manual counter avoids adding a 5th component dependency. OCC contention is negligible for single-user save/unsave operations. The sharded counter solves a high-contention problem that does not exist here.

### Expected Features

**Must have (table stakes):**
- Debug endpoint conversion -- 2 public queries and 2 public mutations converted to internal (security blocker)
- Library count efficiency -- replace `.take(10_000).length` with O(1) counter read (performance blocker, incorrect for >10k items)
- `.collect()` bounding on ~10 high-traffic paths -- add `.take(N)` guards (reliability blocker)

**Should have (high-value, low-cost):**
- Delete `convex/lib/debug_gate.ts` and remove `ENABLE_PUBLIC_DEBUG_FUNCTIONS` env var (dead code removal)
- Remove `requireAuth()` from debug functions (internal functions lack client auth context -- keeping it makes them uncallable from dashboard/CLI)
- Document cardinality expectations with inline comments on naturally-bounded `.collect()` calls

**Defer (v2+):**
- Server-side pagination for library (high complexity, not blocking at current scale)
- Collection membership counters (nice-to-have, no known bottleneck)
- Full `@convex-dev/aggregate` component (over-engineering for current needs)
- Custom admin dashboard for debug queries (scope creep)

### Architecture Approach

Three independent backend changes to existing modules with no new files except potentially a `libraryCounters` table or counter field. All changes are confined to `convex/extraction/debug*.ts`, `convex/extraction/test*.ts`, `convex/library/queries.ts`, `convex/library/mutations.ts`, and a handful of extraction/credit query files. No new layers, no frontend components, no API surface changes.

**Major components:**
1. Debug endpoint internalization (6 debug files + 2 test files) -- convert `query`/`mutation` to `internalQuery`/`internalMutation`, remove env-var gate module
2. Library counter system (queries.ts + mutations.ts + schema.ts) -- add counter field, patch atomically in save/delete mutations, rewrite `getLibraryCount` to read counter
3. `.collect()` bounding (extraction/queries.ts, library/queries.ts, credits/internal.ts) -- add `.take(N)` with documented MAX constants to ~10 high-traffic paths

### Critical Pitfalls

1. **Generated API paths break on visibility change** -- `api.extraction.debug.diagnoseJob` becomes `internal.extraction.debug.diagnoseJob`. Run `tsc --noEmit` after conversion to catch all broken references. Grep for string-based function names.

2. **`requireAuth()` makes internal functions uncallable** -- Internal functions called via `npx convex run` or `ctx.runQuery` have no client auth context. Remove `requireAuth()` from all debug functions when converting to internal. Accept `userId` as an explicit argument if user-scoping is needed.

3. **Over-bounding safe `.collect()` calls** -- Many `.collect()` calls are inherently bounded (e.g., 5-15 extraction questions per job, 1-3 subscriptions per user). Adding `.take(N)` to cascade-delete paths silently orphans data. Categorize each call by cardinality before acting.

4. **Counter drift from missed mutation paths** -- The counter must be updated in EVERY mutation that creates or deletes library items. Verify only 2 entry points exist: `saveToLibrary` (insert) and `removeFromLibrary`/`removeMultipleFromLibrary` (delete).

5. **Search index `.collect()` cannot use `.take()`** -- Convex search queries return up to 256 results by default. Do not attempt to bound them; they are already inherently capped.

---

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Debug Endpoint Security Hardening

**Rationale:** Highest-priority security fix with lowest complexity. No dependencies on other phases. Pattern already established (5 of 7 debug files are already internal).
**Delivers:** All debug/test functions unreachable from client SDK. Env-var gate eliminated. Clean security model.
**Addresses:** Debug endpoint conversion (table stakes), debug gate removal (should-have), requireAuth removal (should-have)
**Avoids:** Pitfall 1 (API path break -- run tsc), Pitfall 7 (auth in internal -- remove requireAuth)
**Scope:** Convert 4 public functions to internal, remove `requirePublicDebugEnabled()` from all 12 files, delete `debug_gate.ts`, update/rewrite `debug-gate.test.ts`, remove env var.

### Phase 2: Library Count Optimization

**Rationale:** Performance fix with medium complexity. Independent of Phase 1. Requires schema change (new counter field or table) and backfill strategy.
**Delivers:** O(1) library count query. Correct counts for users with >10,000 items. Eliminated 10,000-document scan on every library page load.
**Addresses:** Library count efficiency (table stakes)
**Avoids:** Pitfall 3 (aggregate complexity -- use manual counter, not component), Pitfall 6 (counter race -- Convex OCC handles retries correctly), Pitfall 8 (cap at 10k -- counter has no upper bound)
**Scope:** Add counter field/table to schema, increment in `saveToLibrary`, decrement in `removeFromLibrary` and `removeMultipleFromLibrary`, rewrite `getLibraryCount`, implement lazy backfill for existing users, update tests.

### Phase 3: Unbounded `.collect()` Audit and Bounding

**Rationale:** Lowest risk, most mechanical. Independent of Phases 1 and 2. Requires careful categorization to avoid over-bounding.
**Delivers:** Explicit `.take(N)` bounds on all high-traffic query paths. Documented cardinality expectations. Defense-in-depth against future data growth.
**Addresses:** `.collect()` bounding (table stakes), cardinality documentation (should-have)
**Avoids:** Pitfall 4 (over-bounding -- categorize by cardinality first), Pitfall 11 (search index -- skip search `.collect()` calls)
**Scope:** Add `.take(N)` to ~10 Category C paths, add `.take(N)` to Category B paths as defense-in-depth, document cardinality for Category A paths, skip test files and search index queries.

### Phase Ordering Rationale

- All three phases are independent and could run in parallel. The suggested order reflects priority: security (Phase 1) before performance (Phase 2) before reliability hardening (Phase 3).
- Phase 1 is the smallest change (import swaps + deletions) with the highest security impact. Ship it first to reduce attack surface immediately.
- Phase 2 requires a schema change and backfill, making it the most complex. It benefits from shipping after Phase 1 so the deploy pipeline is validated.
- Phase 3 is pure mechanical bounding with zero risk of breaking behavior for users within reasonable limits. It can be done as a sweep after the more impactful phases.

### Research Flags

Phases with standard patterns (skip `/gsd:research-phase`):
- **Phase 1 (Debug Internalization):** Well-documented Convex pattern. 5 of 7 files already follow the pattern. Mechanical conversion.
- **Phase 3 (.collect() Bounding):** Mechanical `.take(N)` additions. The audit categorization is already done in ARCHITECTURE.md and FEATURES.md.

Phases that may benefit from brief research during planning:
- **Phase 2 (Library Counter):** The manual counter approach is straightforward, but the backfill strategy and test updates deserve a quick review of the existing `extractionJobStats` lazy backfill pattern to ensure consistency. Not a full research phase -- just reference the v3.0 implementation.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies. All APIs verified against installed Convex version. Prior decisions (v3.0) validated. |
| Features | HIGH | All three concerns verified against codebase. Exact file paths and line numbers identified. |
| Architecture | HIGH | Changes confined to existing modules. No new architectural layers. Pattern established by existing internal functions and extractionJobStats counter. |
| Pitfalls | HIGH | 11 pitfalls identified with concrete prevention strategies. All verified against actual codebase behavior. |

**Overall confidence:** HIGH

### Gaps to Address

- **Disagreement on counting approach:** FEATURES.md and ARCHITECTURE.md recommend `@convex-dev/sharded-counter`. STACK.md and PITFALLS.md favor a manual counter. This summary resolves in favor of the manual counter (see Key Findings). The roadmapper should use the manual counter approach. If OCC contention is observed during implementation (unlikely for user-initiated operations), the sharded counter can be reconsidered.

- **Disagreement on debug gate retention:** PITFALLS.md (Pitfall 2) recommends keeping `requirePublicDebugEnabled()` even on internal functions for defense-in-depth and audit logging. STACK.md and ARCHITECTURE.md recommend removing it entirely. This summary resolves in favor of **removing the gate** -- internal functions are architecturally unreachable from clients, and the audit logging concern should be addressed by wiring `writeAuditLog` (existing internalMutation) into debug functions directly rather than through the env-var gate. The test inventory should be rewritten to verify functions are `internalQuery`/`internalMutation` instead of checking for gate imports.

- **Exact `.collect()` paths:** STACK.md identifies 7 high-priority paths. FEATURES.md identifies ~6. ARCHITECTURE.md identifies ~11 with more granular categorization. Use ARCHITECTURE.md's Category C list as the authoritative set during implementation.

- **Backfill timing:** Lazy backfill is recommended by all research files, but no research covers what happens if a user's first `getLibraryCount` call triggers the backfill during a high-traffic period. The backfill is a single `.take(10_000).length` call per user (one-time), which is the same cost as the current implementation. This is acceptable.

---

## Sources

### Primary (HIGH confidence)
- [Convex Internal Functions](https://docs.convex.dev/functions/internal-functions) -- `internalQuery`/`internalMutation` behavior, namespace separation
- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/) -- `.collect()` guidance, security recommendations
- [Convex Reading Data](https://docs.convex.dev/database/reading-data) -- `.take()`, `.paginate()`, `.first()`, `.unique()`
- Codebase: 125 `.collect()` calls across 27 files, 12 debug/test files, library count implementation -- all verified by direct inspection

### Secondary (MEDIUM confidence)
- [Convex Aggregate Component](https://stack.convex.dev/efficient-count-sum-max-with-the-aggregate-component) -- evaluated and rejected for this use case
- [Convex Sharded Counter](https://www.convex.dev/components/sharded-counter) -- evaluated; appropriate for high-contention scenarios but not needed here
- [Queries That Scale](https://stack.convex.dev/queries-that-scale) -- `.collect()` bounds, pagination patterns
- Prior decision: `.planning/milestones/v3.0-phases/57-incremental-aggregation/57-RESEARCH.md` -- validates manual counter over aggregate component

---
*Research completed: 2026-03-06*
*Ready for roadmap: yes*
