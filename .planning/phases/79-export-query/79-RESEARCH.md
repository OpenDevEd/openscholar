# Phase 79: Export Query - Research

**Researched:** 2026-03-09
**Domain:** Convex query (auth-gated, bounded read of screening results)
**Confidence:** HIGH

## Summary

Phase 79 adds a single public Convex query that returns all screening results for a job the authenticated user owns. The existing codebase already has the exact patterns needed: `convex/screening/queries.ts` contains auth-gated queries (`getScreeningJob`, `getScreeningProgress`) and internal queries that read `screeningResults` (`getPendingResults`). The new query combines these two patterns -- public auth gate + results collection read.

The `screeningResults` table already stores all needed fields: paper metadata (title, authors, doi, publicationYear, openalexId), per-question answers (`answers` record), score, stars, qualified status. The `by_job` index exists for efficient lookup. `MAX_SCREENING_PAPERS_PER_JOB` (200) is already defined in `convex/lib/queryBounds.ts` and used by existing queries.

**Primary recommendation:** Add a single `getScreeningResultsForExport` query to `convex/screening/queries.ts` following the exact auth pattern from `getScreeningJob` (getCurrentUser + ownership check) and the bounded read pattern from `getPendingResults` (.take(MAX_SCREENING_PAPERS_PER_JOB)), plus unit tests mirroring the existing test patterns in `queries.test.ts`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXP-01 | User can fetch all screening results for a completed job via auth-gated query | Auth pattern exists in `getScreeningJob`; `screeningResults` table has `by_job` index; `MAX_SCREENING_PAPERS_PER_JOB=200` bounds results; all needed fields (answers, score, stars, qualified, paper metadata) exist in schema |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| convex | (project version) | Backend query framework | Already used for all screening queries |
| convex/values (v) | (project version) | Validator definitions for return types | Used by every query in the codebase |
| convex-test | (project version) | Unit testing Convex queries | Used by `queries.test.ts` |
| vitest | (project version) | Test runner | Project standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| convex/lib/auth (getCurrentUser) | local | Auth gate | Every public query checks ownership |
| convex/lib/queryBounds | local | MAX_SCREENING_PAPERS_PER_JOB=200 | Bounding .take() call |

## Architecture Patterns

### Recommended Project Structure
No new files needed. Everything goes in existing files:
```
convex/screening/
  queries.ts          # Add getScreeningResultsForExport query
  queries.test.ts     # Add tests for the new query
  validators.ts       # Already has all needed validators (no changes)
```

### Pattern 1: Auth-Gated Owner-Only Query
**What:** Public query that returns null for unauthenticated users or non-owners
**When to use:** Any query exposing user-owned data
**Example (from existing `getScreeningJob`):**
```typescript
handler: async (ctx, args) => {
  const user = await getCurrentUser(ctx);
  if (!user) return null;

  const job = await ctx.db.get(args.jobId);
  if (!job || job.userId !== user._id) return null;

  // ... return data
}
```

### Pattern 2: Bounded Collection Read with Index
**What:** Read all results for a job using index + .take(MAX)
**When to use:** Any query that reads a full set of related documents
**Example (from existing `getPendingResults`):**
```typescript
const results = await ctx.db
  .query("screeningResults")
  .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
  .take(MAX_SCREENING_PAPERS_PER_JOB);
```

### Pattern 3: Explicit Return Shape with Validators
**What:** Every query declares `returns:` with precise Convex validators
**When to use:** All queries in this codebase (project convention)
**Example:**
```typescript
returns: v.union(
  v.null(),
  v.object({
    // ... explicit fields
  })
)
```

### Anti-Patterns to Avoid
- **Returning raw documents:** Never return `result` directly; always map to explicit shape with declared validators
- **Unbounded reads:** Never use `.collect()` without `.take(N)` bound
- **Throwing on auth failure:** Public queries return `null` for auth failures (not throw); only `requireAuth` throws

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auth check | Custom identity parsing | `getCurrentUser(ctx)` from `convex/lib/auth` | Handles Clerk identity, user lookup, state check |
| Query bounds | Magic numbers | `MAX_SCREENING_PAPERS_PER_JOB` from `convex/lib/queryBounds` | Single source of truth, already 200 |
| Result validators | Inline validator objects | Reuse validators from `convex/screening/validators.ts` | `screeningResultStatusValidator`, `screeningQuestionValidator` already exist |

## Common Pitfalls

### Pitfall 1: Forgetting to bound the results query
**What goes wrong:** Using `.collect()` instead of `.take(N)` on screeningResults
**Why it happens:** Developer thinks "there are only 200 papers max" but doesn't enforce it at query time
**How to avoid:** Always use `.take(MAX_SCREENING_PAPERS_PER_JOB)` -- this is enforced project-wide (v3.2 Phase 74 audited this)
**Warning signs:** `.collect()` call without `.take()` in a screening query

### Pitfall 2: Not handling failed/skipped results
**What goes wrong:** Query only returns "completed" results, missing failed/skipped papers
**Why it happens:** Developer filters by status="completed" thinking export only wants successful results
**How to avoid:** Return ALL results for the job (any status). The export functions (Phase 80) handle null fallbacks for missing answers on failed/skipped papers. EXP-05 explicitly requires this.
**Warning signs:** `.withIndex("by_job_status", ...)` filtering to only "completed"

### Pitfall 3: Returning answers as optional without null union
**What goes wrong:** Validator mismatch -- schema has `v.optional(v.record(v.string(), v.union(v.boolean(), v.null())))` for answers
**Why it happens:** Forgetting that answers field is optional (not set for pending/failed results) AND values can be `boolean | null`
**How to avoid:** Match the schema exactly: `answers: v.optional(v.record(v.string(), v.union(v.boolean(), v.null())))`

### Pitfall 4: Leaking aiMetadata in export query
**What goes wrong:** Including AI reasoning/confidence in export results
**Why it happens:** Copy-pasting all fields from schema
**How to avoid:** Requirements explicitly say "Out of Scope: AI reasoning/confidence in export". Only return: paper metadata, answers, score, stars, qualified, status.

## Code Examples

### New Query: getScreeningResultsForExport
```typescript
// Source: Synthesized from existing patterns in convex/screening/queries.ts
export const getScreeningResultsForExport = query({
  args: { jobId: v.id("screeningJobs") },
  returns: v.union(
    v.null(),
    v.object({
      job: v.object({
        _id: v.id("screeningJobs"),
        status: screeningJobStatusValidator,
        questions: v.array(screeningQuestionValidator),
        scoringConfig: screeningScoringConfigValidator,
        totalPapers: v.number(),
        qualifiedPapers: v.number(),
        createdAt: v.number(),
        completedAt: v.optional(v.number()),
      }),
      results: v.array(
        v.object({
          openalexId: v.string(),
          title: v.string(),
          authors: v.optional(v.array(v.string())),
          publicationYear: v.optional(v.number()),
          doi: v.optional(v.string()),
          status: screeningResultStatusValidator,
          answers: v.optional(
            v.record(v.string(), v.union(v.boolean(), v.null()))
          ),
          score: v.optional(v.number()),
          stars: v.optional(v.number()),
          qualified: v.optional(v.boolean()),
        })
      ),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== user._id) return null;

    const results = await ctx.db
      .query("screeningResults")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .take(MAX_SCREENING_PAPERS_PER_JOB);

    return {
      job: {
        _id: job._id,
        status: job.status,
        questions: job.questions,
        scoringConfig: job.scoringConfig,
        totalPapers: job.totalPapers,
        qualifiedPapers: job.qualifiedPapers,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
      },
      results: results.map((r) => ({
        openalexId: r.openalexId,
        title: r.title,
        authors: r.authors,
        publicationYear: r.publicationYear,
        doi: r.doi,
        status: r.status,
        answers: r.answers,
        score: r.score,
        stars: r.stars,
        qualified: r.qualified,
      })),
    };
  },
});
```

### Test Pattern (from existing queries.test.ts)
```typescript
// Seed a screening result for testing
async function seedScreeningResult(
  t: ReturnType<typeof convexTest>,
  jobId: Id<"screeningJobs">,
  overrides: Partial<{ status: string; answers: Record<string, boolean | null>; score: number; stars: number; qualified: boolean }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("screeningResults", {
      jobId,
      openalexId: "https://openalex.org/W123",
      title: "Test Paper",
      status: overrides.status ?? "completed",
      answers: overrides.answers ?? { q1: true },
      score: overrides.score ?? 1,
      stars: overrides.stars ?? 3,
      qualified: overrides.qualified ?? true,
      createdAt: Date.now(),
    });
  });
}
```

## State of the Art

No changes needed. This phase uses only existing Convex patterns established in v4.0.

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| N/A | Auth-gated queries with getCurrentUser | v4.0 (Phase 75) | Standard pattern |
| N/A | Bounded reads with MAX constant | v3.2 (Phase 74) | All queries use .take() |

## Open Questions

None. The existing infrastructure fully supports this phase. All schema fields, indexes, auth patterns, and test patterns are in place.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest + convex-test |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run convex/screening/queries.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXP-01a | Authenticated owner fetches results with all fields | unit | `npx vitest run convex/screening/queries.test.ts -t "returns results for owner"` | Needs addition to existing file |
| EXP-01b | Unauthenticated user gets null | unit | `npx vitest run convex/screening/queries.test.ts -t "returns null for unauthenticated"` | Needs addition to existing file |
| EXP-01c | Non-owner gets null | unit | `npx vitest run convex/screening/queries.test.ts -t "returns null for non-owner"` | Needs addition to existing file |
| EXP-01d | Results bounded by MAX_SCREENING_PAPERS_PER_JOB | unit | `npx vitest run convex/screening/queries.test.ts -t "bounded"` | Needs addition to existing file |
| EXP-01e | Failed/skipped results included with null answers | unit | `npx vitest run convex/screening/queries.test.ts -t "failed"` | Needs addition to existing file |

### Sampling Rate
- **Per task commit:** `npx vitest run convex/screening/queries.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before verify

### Wave 0 Gaps
- [ ] Add `seedScreeningResult` helper to `queries.test.ts`
- [ ] Add `describe("getScreeningResultsForExport", ...)` test block to `queries.test.ts`

No framework install needed -- vitest and convex-test already configured.

## Sources

### Primary (HIGH confidence)
- `convex/screening/queries.ts` -- existing auth-gated query patterns, internal result queries
- `convex/screening/queries.test.ts` -- existing test patterns with seedUser, seedScreeningJob, convexTest
- `convex/screening/validators.ts` -- all screening validators
- `convex/schema.ts:732-770` -- screeningResults table definition with indexes
- `convex/lib/queryBounds.ts` -- MAX_SCREENING_PAPERS_PER_JOB = 200
- `convex/lib/auth.ts` -- getCurrentUser implementation
- `.planning/REQUIREMENTS.md` -- EXP-01 definition, out-of-scope items

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies
- Architecture: HIGH -- exact patterns exist in the same file we are modifying
- Pitfalls: HIGH -- based on direct code reading and project requirements

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable -- only internal Convex patterns, no external dependencies)
