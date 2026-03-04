# Phase 59: Tech Debt Cleanup - Research

**Researched:** 2026-03-04
**Domain:** TypeScript type safety, dead code removal
**Confidence:** HIGH

## Summary

Phase 59 is a small, surgical cleanup phase that closes two low-severity gaps identified in the v3.0 milestone audit. The first gap (TYPE-01-DOWNSTREAM) is a type-only issue: `ResultCell` in `table-view.tsx` declares its `result` prop as `Doc<"extractionResults">` instead of `ExtractionResultWithReview`, meaning review overlay fields (`reviewState`, `correctedAnswer`, `citationStatus`, etc.) are not visible to TypeScript at this component boundary, even though they are present at runtime via `attachReviewMetadata`. The second gap is dead code: `highlightText` in `lib/extraction/filtering.ts` is completely unreferenced after Phase 55 replaced all call sites with the XSS-safe `HighlightedText` React component.

Both changes are zero-runtime-impact, pure type-safety and code hygiene improvements. The `ExtractionResultWithReview` type already exists at `lib/extraction/types.ts` (created in Phase 54) and is already used by `PaperWithResults.results` in the same `filtering.ts` file that `table-view.tsx` imports from. The change is purely about updating the local `ResultCell` prop type declaration.

**Primary recommendation:** Update `ResultCell` prop type from `Doc<"extractionResults">` to `ExtractionResultWithReview`, delete `highlightText` and two other dead helper functions from `filtering.ts`, and verify TypeScript still compiles cleanly.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TYPE-01 (downstream) | Complete type safety for `ExtractionResultWithReview` through all downstream components | `ExtractionResultWithReview` type exists at `lib/extraction/types.ts`. `ResultCell` in `table-view.tsx:300` uses `Doc<"extractionResults">` instead. Direct import and type swap needed. Card-view and split-view have the same gap but are out of explicit scope. |
</phase_requirements>

## Standard Stack

### Core

No new libraries needed. This phase operates entirely on existing TypeScript types and file edits.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | (project version) | Type checking | Already configured; `npx tsc --noEmit` is the verification command |
| Convex `Infer<>` | convex/values | Type derivation from validators | Already used in `lib/extraction/types.ts` to derive `ExtractionResultWithReview` |

### Supporting

None needed.

### Alternatives Considered

None -- this is a type annotation change and dead code deletion.

## Architecture Patterns

### Current State: ResultCell Prop Type Gap

`table-view.tsx` line 300 declares:
```typescript
result?: Doc<"extractionResults">;
```

But `paper.results` (passed to `ResultCell` at line 242-244) is typed as `Array<ExtractionResultWithReview>` via the `PaperWithResults` interface in `filtering.ts` line 21. This means TypeScript already knows each element is `ExtractionResultWithReview` at the call site, but the prop declaration downcasts it to the narrower `Doc<"extractionResults">` type, losing review overlay fields.

### Pattern: Type Import Chain

The existing type flow is:
```
convex/extraction/validators.ts (extractionResultWithReviewValidator)
  -> lib/extraction/types.ts (ExtractionResultWithReview = Infer<typeof ...>)
    -> lib/extraction/filtering.ts (PaperWithResults.results: Array<ExtractionResultWithReview>)
      -> components/extraction/results-views/table-view.tsx (imports PaperWithResults)
```

The fix adds one more link: `table-view.tsx` also imports `ExtractionResultWithReview` directly for the `ResultCell` prop type.

### Pattern: Prop Type Fix

**Current (broken type safety):**
```typescript
// table-view.tsx line 294-303
const ResultCell = memo(function ResultCell({
  result,
  type,
  searchQuery,
  onCite,
}: {
  result?: Doc<"extractionResults">;  // <-- loses review overlay fields
  type: string;
  searchQuery?: string;
  onCite?: () => void;
}) {
```

**After (complete type safety):**
```typescript
import type { ExtractionResultWithReview } from "@/lib/extraction/types";

const ResultCell = memo(function ResultCell({
  result,
  type,
  searchQuery,
  onCite,
}: {
  result?: ExtractionResultWithReview;  // <-- all fields visible
  type: string;
  searchQuery?: string;
  onCite?: () => void;
}) {
```

### Current State: Dead Functions in filtering.ts

Three exported functions in `lib/extraction/filtering.ts` have zero import sites:

1. **`highlightText`** (lines 139-145): Returns HTML string with `<mark>` tags. Replaced by `HighlightedText` React component in Phase 55. Zero imports confirmed.
2. **`escapeRegExp`** (lines 150-152): Regex escape utility. Zero imports confirmed (the `HighlightedText` component has its own inline escape).
3. **`getResult`** (lines 157-159): Returns `Doc<"extractionResults"> | undefined`. Zero imports confirmed (all call sites use inline `.find()` directly).

### Anti-Patterns to Avoid

- **Scope creep to card-view/split-view:** Both `card-view.tsx:214` and `split-view.tsx:186` also use `Doc<"extractionResults">` for their `ResultValue` props. The phase scope explicitly names only `ResultCell` in `table-view.tsx`. Do not expand scope unless explicitly instructed.
- **Changing function signatures of citation/review helpers:** `getAllCitationLocations`, `getCitationStatus`, `getReviewState`, and `isReviewed` all accept `any` as their parameter type. This is a separate tech debt item, not in scope.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ExtractionResult type with review fields | Manual interface definition | `ExtractionResultWithReview` from `lib/extraction/types.ts` | Already derived from validator; stays in sync automatically |

**Key insight:** The type already exists. This phase is purely about using it in one more place.

## Common Pitfalls

### Pitfall 1: Forgetting to Remove the Doc Import

**What goes wrong:** After changing `ResultCell` prop to `ExtractionResultWithReview`, the `Doc` import from `@/convex/_generated/dataModel` may become unused if no other code in `table-view.tsx` references it.
**Why it happens:** The import was only needed for the `ResultCell` prop type.
**How to avoid:** After the type change, check if `Doc` is still used elsewhere in `table-view.tsx`. If not, remove it from the import statement. In this case, `Doc` is NOT used anywhere else in `table-view.tsx`, so it should be removed.
**Warning signs:** TypeScript or ESLint "unused import" warning.

### Pitfall 2: Accidentally Deleting Used Exports from filtering.ts

**What goes wrong:** Deleting exports that are imported elsewhere causes compilation errors.
**Why it happens:** Insufficient verification of import sites.
**How to avoid:** Only delete `highlightText`, `escapeRegExp`, and `getResult`. The other exports (`FilterState`, `defaultFilters`, `PaperWithResults`, `Question`, `PreprocessedPaperData`, `preprocessPapers`, `filterPapers`, `getAvgConfidence`) all have active import sites. Verified via grep.
**Warning signs:** `npx tsc --noEmit` errors after deletion.

### Pitfall 3: Breaking the ExtractionResultWithReview Import Path

**What goes wrong:** Importing from the wrong path (e.g., directly from validators.ts instead of types.ts).
**Why it happens:** Multiple files reference the type.
**How to avoid:** Import from `@/lib/extraction/types` which is the canonical location for client-side code. This is the same path `filtering.ts` uses.

## Code Examples

### 1. The Complete ResultCell Prop Type Fix

```typescript
// Source: Current codebase analysis (HIGH confidence)
// In table-view.tsx, change the import:
// REMOVE: import type { Doc } from "@/convex/_generated/dataModel";
// ADD (to existing import or new):
import type { ExtractionResultWithReview } from "@/lib/extraction/types";

// Change the ResultCell prop type:
const ResultCell = memo(function ResultCell({
  result,
  type,
  searchQuery,
  onCite,
}: {
  result?: ExtractionResultWithReview;
  type: string;
  searchQuery?: string;
  onCite?: () => void;
}) {
```

### 2. Dead Code to Delete from filtering.ts

```typescript
// Source: lib/extraction/filtering.ts lines 138-159
// DELETE these three functions entirely:

// Function 1: highlightText (lines 138-145) - dead after Phase 55
export function highlightText(text: string, query: string): string { ... }

// Function 2: escapeRegExp (lines 147-152) - zero import sites
export function escapeRegExp(str: string): string { ... }

// Function 3: getResult (lines 154-159) - zero import sites, also has Doc<> return type gap
export function getResult(paper: PaperWithResults, questionKey: string): Doc<"extractionResults"> | undefined { ... }
```

After deleting `getResult`, the `Doc` import at filtering.ts line 1 can also be removed since no remaining code in that file uses `Doc<>`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Doc<"extractionResults">` for result props | `ExtractionResultWithReview` with review overlay fields | Phase 54 (2026-03-03) | Review fields visible at compile time |
| `highlightText()` returning HTML string + `dangerouslySetInnerHTML` | `<HighlightedText>` React component with text splitting | Phase 55 (2026-03-03) | XSS-safe, no raw HTML injection |

**Deprecated/outdated:**
- `highlightText` in `filtering.ts`: Dead code since Phase 55. Returns HTML string, bypasses React's auto-escaping. Must be deleted.
- `escapeRegExp` in `filtering.ts`: Dead code. No consumers.
- `getResult` in `filtering.ts`: Dead code. No consumers. Also has the `Doc<"extractionResults">` type gap.

## Open Questions

1. **Should card-view.tsx and split-view.tsx also be updated?**
   - What we know: Both `card-view.tsx:214` and `split-view.tsx:186` have `ResultValue` components with `result?: Doc<"extractionResults">` -- the exact same type gap as `ResultCell` in `table-view.tsx`.
   - What's unclear: Whether the phase scope intentionally excludes these or they were simply overlooked.
   - Recommendation: The phase success criteria explicitly name only `ResultCell` in `table-view.tsx`. Stick to scope. If desired, the planner can optionally include them as bonus cleanup in the same plan since the fix pattern is identical.

## Pre-Existing TypeScript Errors

The current codebase has 10 pre-existing TypeScript errors, all related to stale Convex codegen (references to `internal.lib.audit` and `internal.lib.envValidation` that resolve on `npx convex deploy`). These are NOT introduced by this phase and should be excluded from the "no new errors" success criterion check.

## Files Inventory

| File | Change | Risk |
|------|--------|------|
| `components/extraction/results-views/table-view.tsx` | Change `ResultCell` prop type, update imports | LOW -- type-only change, no runtime behavior change |
| `lib/extraction/filtering.ts` | Delete `highlightText`, `escapeRegExp`, `getResult`; remove unused `Doc` import | LOW -- all three functions have zero import sites |

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis: `table-view.tsx`, `filtering.ts`, `types.ts`, `validators.ts`
- Phase 54 verification report: confirms `ExtractionResultWithReview` type exists and is threaded through filtering/export
- Phase 55 verification report: confirms `HighlightedText` replaced all `highlightText` call sites
- v3.0 milestone audit: identifies both gaps explicitly

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, pure type/code edits
- Architecture: HIGH - type chain fully understood, all files read and analyzed
- Pitfalls: HIGH - all import sites verified via grep, pre-existing tsc errors documented

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable -- no external dependencies involved)
