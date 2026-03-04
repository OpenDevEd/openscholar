---
phase: quick-3
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - convex/extraction/grobid.ts
  - convex/extraction/workpoolActions.ts
  - convex/extraction/evidence_units.ts
  - tests/grobid-fallback.test.ts
  - package.json
autonomous: true
requirements: [QUICK-3]
must_haves:
  truths:
    - "No grobid.ts file exists in the codebase"
    - "No references to grobid remain in production code"
    - "Evidence unit source type no longer includes grobid"
    - "buildEvidenceUnitsFromPdf works without grobid (already does via fallback)"
    - "cheerio dependency is removed from package.json"
  artifacts:
    - path: "convex/extraction/workpoolActions.ts"
      provides: "buildEvidenceUnitsFromPdf without grobid dependency"
    - path: "convex/extraction/evidence_units.ts"
      provides: "AnchoredEvidenceUnit with cleaned source type"
  key_links:
    - from: "convex/extraction/workpoolActions.ts"
      to: "convex/extraction/evidence_units.ts"
      via: "buildChunkedEvidenceUnitsFromPdfPages"
      pattern: "buildChunkedEvidenceUnitsFromPdfPages"
---

<objective>
Remove the GROBID implementation entirely from the codebase.

Purpose: GROBID is a self-hosted PDF parsing service that adds infrastructure complexity. The codebase already has a complete fallback path using PDF.js that works without GROBID. The grobid integration is dead weight.

Output: Clean codebase with no grobid references, no cheerio dependency, simplified buildEvidenceUnitsFromPdf function.
</objective>

<execution_context>
@/Users/mcharrad/.claude/get-shit-done/workflows/execute-plan.md
@/Users/mcharrad/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@convex/extraction/grobid.ts (DELETE this file)
@convex/extraction/workpoolActions.ts (remove grobid import + usage)
@convex/extraction/evidence_units.ts (clean source type)
@tests/grobid-fallback.test.ts (DELETE this file)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Remove grobid files, imports, and usage</name>
  <files>
    convex/extraction/grobid.ts
    convex/extraction/workpoolActions.ts
    convex/extraction/evidence_units.ts
    tests/grobid-fallback.test.ts
  </files>
  <action>
    1. DELETE `convex/extraction/grobid.ts` entirely.
    2. DELETE `tests/grobid-fallback.test.ts` entirely.
    3. In `convex/extraction/workpoolActions.ts`:
       - Remove the import: `import { processFulltextDocumentWithGrobid } from "./grobid";`
       - Remove the `getSectionsByPage` function (lines ~381-408) — it is only used for grobid results.
       - In `buildEvidenceUnitsFromPdf` (line ~683), remove the entire grobid try/catch block (lines ~693-702) that calls `processFulltextDocumentWithGrobid` and `getSectionsByPage`.
       - Remove the `sectionsByPage` variable declaration.
       - Simplify the `pages.map` call that feeds into `buildChunkedEvidenceUnitsFromPdfPages`: instead of `section: sectionsByPage.get(page.pageNumber) || "body"`, just use `section: "body"` since there is no section enrichment anymore.
    4. In `convex/extraction/evidence_units.ts`:
       - Change the `source` type in `AnchoredEvidenceUnit` from `"grobid" | "pdfjs_fallback" | "pdfjs_chunks"` to `"pdfjs_fallback" | "pdfjs_chunks"`.
       - In `buildAnchoredEvidenceUnits`, change the default source from `"grobid"` to `"pdfjs_chunks"` (line ~307).
  </action>
  <verify>
    <automated>cd /Users/mcharrad/Documents/Github/openalex-count && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>
    - grobid.ts and grobid-fallback.test.ts are deleted
    - No imports or references to grobid remain in production code
    - TypeScript compiles cleanly
    - AnchoredEvidenceUnit source type excludes "grobid"
  </done>
</task>

<task type="auto">
  <name>Task 2: Remove cheerio dependency and verify tests</name>
  <files>package.json</files>
  <action>
    1. Remove `cheerio` from `package.json` dependencies (it was only used by grobid.ts).
    2. Run `npm install` to update the lockfile.
    3. Regenerate Convex types with `npx convex codegen` — the `convex/_generated/api.d.ts` file auto-imports from `extraction/grobid.js` and needs to be regenerated to remove that reference.
    4. Run the full test suite to confirm nothing is broken.
  </action>
  <verify>
    <automated>cd /Users/mcharrad/Documents/Github/openalex-count && npx vitest run 2>&1 | tail -20</automated>
  </verify>
  <done>
    - cheerio is not in package.json dependencies
    - convex/_generated/api.d.ts no longer references grobid
    - All tests pass
    - No runtime references to grobid remain anywhere in src/convex code
  </done>
</task>

</tasks>

<verification>
- `grep -ri grobid convex/ tests/ src/ 2>/dev/null` returns no results
- `grep -r cheerio package.json` returns no results
- `npx tsc --noEmit` passes
- `npx vitest run` passes
</verification>

<success_criteria>
- Zero references to grobid in production/test code
- cheerio dependency removed
- TypeScript compiles cleanly
- All tests pass
- buildEvidenceUnitsFromPdf still works (uses PDF.js path directly)
</success_criteria>

<output>
After completion, create `.planning/quick/3-get-rid-of-the-grobid-implementation-ent/3-SUMMARY.md`
</output>
