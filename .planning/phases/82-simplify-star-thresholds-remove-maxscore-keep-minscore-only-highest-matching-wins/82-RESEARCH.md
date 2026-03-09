# Phase 82: Simplify Star Thresholds - Research

**Researched:** 2026-03-09
**Domain:** Convex schema migration, scoring engine refactor, React UI simplification
**Confidence:** HIGH

## Summary

Phase 82 removes the `maxScore` field from star thresholds across the entire codebase, simplifying the scoring model to "minScore + stars only, highest matching minScore wins." The current implementation uses `{ minScore, maxScore, stars }` range-based thresholds where a score must fall within `[minScore, maxScore]` to earn the corresponding stars. The new model uses only `{ minScore, stars }` where thresholds are sorted by minScore descending and the first match (score >= minScore) wins.

This is a contained refactor touching exactly 12 files across 4 layers: schema/validators (2), scoring engine (2), queries/mutations (4), UI components (2), export code (2). There is no live data migration needed -- Convex's schemaless document store will accept the new shape on write, and the backward-compatibility requirement (SCORE-03) means reads must tolerate existing documents that still have `maxScore` present.

**Primary recommendation:** Use Convex's `v.optional()` for maxScore in the read/query validator layer to achieve backward compatibility, while removing it from write paths and the schema definition entirely.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCORE-01 | Star thresholds use only minScore (maxScore removed from schema, validators, scoring engine, and UI) | Complete file inventory below identifies all 12 files; schema, validator, scoring types/functions, and UI component all contain maxScore that must be removed |
| SCORE-02 | Star rating assignment uses highest-matching-minScore-wins logic (sorted descending, first match returns) | Current `computeStarRating()` in `scoring.ts` uses range-based matching; needs refactor to sort-descending + first-match algorithm |
| SCORE-03 | Existing screening jobs with maxScore in stored data continue to work (backward-compatible read) | Convex stores documents as JSON; existing docs retain maxScore field. Read validators must use `v.optional(v.number())` for maxScore; scoring engine must ignore it |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Convex | latest | Backend schema, validators, queries, mutations | Project's existing backend |
| Vitest | ^3.2.4 | Test runner for scoring engine and Convex tests | Project's existing test framework |
| next-intl | latest | i18n for UI labels | Project's existing i18n solution |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| convex-test | latest | Convex integration test harness | For query/mutation tests with mock DB |

No new dependencies needed. This is purely a refactor of existing code.

## Architecture Patterns

### File Inventory (Complete)

Every file that references `maxScore` or `minScore` in the star threshold context:

```
convex/
  schema.ts                          # screeningJobs.scoringConfig.starThresholds schema
  screening/
    validators.ts                    # screeningScoringConfigValidator
    scoring.ts                       # StarThreshold interface + computeStarRating()
    scoring.test.ts                  # All tests using { minScore, maxScore, stars }
    queries.ts                       # Inline return validators for getScreeningJob, getScreeningResultsForExport, getJobInternal
    queries.test.ts                  # Test fixtures with starThresholds
    cancel.test.ts                   # seedScreeningJob helper with starThresholds
    mutations.test.ts                # defaultScoringConfig + seedScreeningJob fixtures
    mutations.ts                     # (Uses scorePaper; no direct threshold reference, but passes config through)
components/screening/
  star-threshold-editor.tsx          # UI: maxScore input field + handleAdd logic
  screening-dialog.tsx               # getDefaultScoringConfig() generates thresholds with maxScore
lib/screening/
  export.ts                          # ScreeningExportData type + XLSX summary sheet
tests/
  export-screening.test.ts           # mockData fixtures with starThresholds
messages/
  en-US.json                         # "maxScoreLabel" translation key
```

### Pattern: Backward-Compatible Schema Evolution in Convex

**What:** Convex validates documents on read/write using validators. When removing a field from the schema, existing documents in the database still have the old field. The validator must tolerate its presence on read while not requiring it on write.

**Strategy for maxScore removal:**

1. **Schema (`schema.ts`):** Remove `maxScore` from the starThresholds object entirely. Convex schema validation happens on write only -- existing documents with extra fields are not rejected on read (Convex ignores unknown fields on read).

2. **Validators (`validators.ts`):** Remove `maxScore` from the `screeningScoringConfigValidator`. New jobs will be created without maxScore. For read paths that use the validator (query return types), we have two options:
   - Option A: Use `v.optional(v.number())` for maxScore in return validators -- lets old data pass validation
   - Option B: Strip maxScore in query handlers before returning -- cleaner but more handler code

   **Recommendation: Option A** -- simpler, less error-prone, and the field is harmless if present.

3. **Scoring engine (`scoring.ts`):** Change the `StarThreshold` interface to make maxScore optional. The `computeStarRating()` function ignores it entirely (new algorithm doesn't use ranges).

4. **Query return validators:** The inline return validators in `queries.ts` (getScreeningJob, getScreeningResultsForExport, getJobInternal) all have hardcoded starThreshold shapes. These must be updated to make maxScore optional.

### Pattern: Highest-Matching-MinScore-Wins Algorithm

**Current algorithm (range-based):**
```typescript
for (const t of thresholds) {
  if (score >= t.minScore && score <= t.maxScore) {
    return Math.max(0, Math.min(5, t.stars));
  }
}
return 0;
```

**New algorithm (descending minScore, first match):**
```typescript
// Sort by minScore descending (highest first)
const sorted = [...thresholds].sort((a, b) => b.minScore - a.minScore);
for (const t of sorted) {
  if (score >= t.minScore) {
    return Math.max(0, Math.min(5, t.stars));
  }
}
return 0;
```

**Key behavior difference:** The new algorithm is simpler and gap-free. Any score >= the lowest minScore will match something. Gaps between ranges are impossible because there are no ranges -- only floors.

### Pattern: Default Config Generation

The `getDefaultScoringConfig()` in `screening-dialog.tsx` currently generates thresholds with both minScore and maxScore:

```typescript
// Current:
{ minScore: 0, maxScore: 0, stars: 1 },
{ minScore: 1, maxScore: Math.floor(n * 0.25), stars: 2 },
// ...

// New (no maxScore):
{ minScore: 0, stars: 1 },
{ minScore: 1, stars: 2 },
// ...
```

### Anti-Patterns to Avoid

- **Breaking existing data on read:** Never make maxScore required in read validators. Old documents have it; new documents do not. Use `v.optional()`.
- **Data migration:** Do NOT run a migration to strip maxScore from existing documents. This is unnecessary and risky. The backward-compat approach handles it at the validator/code level.
- **Changing stored data shape for existing jobs:** Existing jobs with maxScore in their scoringConfig should remain untouched. The scoring engine should simply ignore the field.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema migration | Custom migration script to remove maxScore from all documents | v.optional() in validators | Convex handles extra fields gracefully; migration is risky and unnecessary |
| Threshold gap detection | Custom gap-finding algorithm for new model | Remove gap/overlap validation entirely | With minScore-only + descending match, gaps are structurally impossible |

**Key insight:** The simplification actually removes complexity. The `validateScoringConfig()` function currently checks for gaps and overlaps between ranges -- these concepts don't exist in the new model and the related warning types can be removed.

## Common Pitfalls

### Pitfall 1: Convex Return Validator Strictness
**What goes wrong:** Convex query return validators reject documents with unexpected fields. If a return validator specifies `{ minScore: v.number(), stars: v.number() }` without maxScore, old documents that have maxScore will cause validation errors.
**Why it happens:** Convex return validators are strict by default -- they reject extra fields.
**How to avoid:** Use `v.optional(v.number())` for maxScore in all return validators. This lets old data (with maxScore) and new data (without maxScore) both pass.
**Warning signs:** Runtime errors like "Object has unexpected field maxScore" when reading existing screening jobs.

### Pitfall 2: Inline Validator Duplication
**What goes wrong:** The project has inline return validators in queries.ts that duplicate the shape from validators.ts. If you update validators.ts but forget the inline ones, the system breaks.
**Why it happens:** Three functions in queries.ts (getScreeningJob, getScreeningResultsForExport, getJobInternal) have manually written return validators with the starThreshold shape.
**How to avoid:** Update ALL four locations: validators.ts + three inline validators in queries.ts. Or better, import and reuse the validator.

### Pitfall 3: Test Fixtures Using Old Shape
**What goes wrong:** Tests pass with the old shape because fixtures still have maxScore, masking the behavioral change.
**Why it happens:** Test fixtures in 4 test files use `{ minScore: 0, maxScore: 1, stars: 1 }`.
**How to avoid:** Update ALL test fixtures to remove maxScore, then add specific backward-compat tests that verify old-shape data still works.

### Pitfall 4: Export Format Change
**What goes wrong:** The XLSX summary sheet currently outputs columns "Min Score", "Max Score", "Stars" for star thresholds. Removing maxScore changes the export format.
**Why it happens:** `export.ts` and `export-screening.test.ts` reference the starThresholds shape.
**How to avoid:** Update the ScreeningExportData type to make maxScore optional, and update the XLSX summary to only show "Min Score" and "Stars". Old exports with maxScore should still render correctly if maxScore is present.

### Pitfall 5: UI handleAdd Logic
**What goes wrong:** The `handleAdd()` function in `star-threshold-editor.tsx` computes new threshold values based on the previous threshold's maxScore.
**Why it happens:** `const lastMax = thresholds[thresholds.length - 1].maxScore;`
**How to avoid:** Change to use `lastMin = thresholds[...].minScore` and compute new minScore as `lastMin + 1`.

## Code Examples

### New computeStarRating Implementation
```typescript
// Source: Project analysis - scoring.ts refactor
export function computeStarRating(
  score: number,
  thresholds: StarThreshold[]
): number {
  // Sort by minScore descending so highest threshold matches first
  const sorted = [...thresholds].sort((a, b) => b.minScore - a.minScore);
  for (const t of sorted) {
    if (score >= t.minScore) {
      return Math.max(0, Math.min(5, t.stars));
    }
  }
  return 0;
}
```

### Updated StarThreshold Interface
```typescript
// Source: Project analysis - scoring.ts types
export interface StarThreshold {
  minScore: number;
  maxScore?: number; // Deprecated: kept optional for backward compat reads
  stars: number;
}
```

### Updated Validator (backward-compatible)
```typescript
// Source: Project analysis - validators.ts
export const screeningScoringConfigValidator = v.object({
  rules: v.array(screeningScoringRuleValidator),
  starThresholds: v.array(
    v.object({
      minScore: v.number(),
      maxScore: v.optional(v.number()), // Backward compat: old jobs have this
      stars: v.number(),
    })
  ),
  minimumScore: v.optional(v.number()),
});
```

### Updated Default Config Generator
```typescript
// Source: Project analysis - screening-dialog.tsx
function getDefaultScoringConfig(questions: { key: string; question: string }[]) {
  const rules: ScoringRule[] = questions.map((q) => ({
    questionKey: q.key,
    yesPoints: 1,
    noPoints: 0,
    nullPoints: 0,
  }));

  const n = questions.length;
  const starThresholds: StarThreshold[] = [
    { minScore: 0, stars: 1 },
    { minScore: 1, stars: 2 },
    { minScore: Math.floor(n * 0.25) + 1, stars: 3 },
    { minScore: Math.floor(n * 0.5) + 1, stars: 4 },
    { minScore: Math.floor(n * 0.75) + 1, stars: 5 },
  ];

  return { rules, starThresholds };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Range-based thresholds (minScore-maxScore) | Floor-based thresholds (minScore only) | Phase 82 | Eliminates gap/overlap complexity, simpler UI |
| First-match wins (array order) | Highest-matching-minScore wins (sorted descending) | Phase 82 | Deterministic regardless of array order |

**Deprecated/outdated:**
- `maxScore` field on star thresholds: deprecated, kept optional for backward-compat reads only
- `gap` and `overlap` warning types in `validateScoringConfig`: no longer applicable with floor-based thresholds

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^3.2.4 |
| Config file | vitest.config.ts (project root) |
| Quick run command | `npx vitest run convex/screening/scoring.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCORE-01 | StarThreshold type has no required maxScore | unit | `npx vitest run convex/screening/scoring.test.ts -x` | Needs update |
| SCORE-02 | Highest minScore wins (descending sort, first match) | unit | `npx vitest run convex/screening/scoring.test.ts -x` | Needs new tests |
| SCORE-02 | End-to-end scoring with new algorithm | unit | `npx vitest run convex/screening/scoring.test.ts -x` | Needs new tests |
| SCORE-03 | Old data with maxScore reads without error | unit | `npx vitest run convex/screening/scoring.test.ts -x` | Needs new test |
| SCORE-03 | Query validators accept old shape | integration | `npx vitest run convex/screening/queries.test.ts -x` | Needs new test |

### Sampling Rate
- **Per task commit:** `npx vitest run convex/screening/scoring.test.ts tests/export-screening.test.ts -x`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Update `convex/screening/scoring.test.ts` -- remove maxScore from existing fixtures, add descending-match tests, add backward-compat tests
- [ ] Update `convex/screening/queries.test.ts` -- update seedScreeningJob fixture, add old-shape-reads test
- [ ] Update `convex/screening/cancel.test.ts` -- update seedScreeningJob fixture
- [ ] Update `convex/screening/mutations.test.ts` -- update defaultScoringConfig fixture
- [ ] Update `tests/export-screening.test.ts` -- update mockData fixture

## Open Questions

None -- this is a straightforward, well-scoped refactor. All affected files are identified, the algorithm change is simple, and backward compatibility is handled via `v.optional()`.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis: All 12 files containing maxScore/minScore/starThreshold references identified and read
- `convex/schema.ts` lines 710-715: Current starThresholds schema shape
- `convex/screening/validators.ts` lines 26-36: Current validator definition
- `convex/screening/scoring.ts` lines 20-95: Current StarThreshold type and computeStarRating algorithm
- `convex/screening/scoring.test.ts`: Complete existing test coverage
- `components/screening/star-threshold-editor.tsx`: Complete UI component
- `components/screening/screening-dialog.tsx` lines 36-66: Default config generator

### Secondary (MEDIUM confidence)
- Convex schema behavior: Extra fields on read are tolerated by Convex's document model (verified by project's prior schema evolution patterns in v2.3/v3.1 milestones)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies; pure refactor of existing code
- Architecture: HIGH - Complete file inventory verified by grep; all 12 files read and analyzed
- Pitfalls: HIGH - Identified from direct code analysis; Convex validator strictness is a known project pattern
- Algorithm: HIGH - Simple sort + first-match pattern; well-understood semantics

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable -- internal codebase refactor, no external dependency concerns)
