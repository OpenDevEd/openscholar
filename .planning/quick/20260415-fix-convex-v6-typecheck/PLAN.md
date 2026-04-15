---
task: Fix Convex dev typecheck failures from v6.0 milestone
slug: fix-convex-v6-typecheck
date: 2026-04-15
status: in-progress
---

# Fix Convex v6 milestone typecheck failures

## Problem

`pm2 logs convex` shows `convex dev` failing typecheck with 10 errors across 3
files. The dev server is stuck in a restart loop (325 reloads) because of it.

```
Found 10 errors in 3 files.
     7  convex/extraction/mutations.test.ts:291
     2  convex/extraction/mutations.ts:507
     1  convex/extraction/parse.ts:285
```

Root causes:

1. `parse.ts:285` — `for (const el of article.querySelectorAll(...))` — the DOM
   lib `NodeListOf<Element>` is not iterable under ES2021 target (needs
   `dom.iterable` in lib, which we don't want to add). Use `.forEach()` instead.
2. `mutations.ts:507-508` — `citationValidityRate: null` and
   `recallOnInclude: null` — schema types these as `v.optional(v.number())` →
   `number | undefined`, not nullable. `null` is invalid.
3. `mutations.test.ts:291-340` — `seedExtractionJob` helper returns
   `(await ctx.db.get(id))!` but TypeScript fails to propagate the `Doc<"extractionJobs">`
   type through `t.run`, so `job._id` is typed as a union of all table ids and
   `ctx.db.get(job._id)` returns the full doc union. Add an explicit
   `Promise<Doc<"extractionJobs">>` return type to force narrowing.

## Fixes

- `convex/extraction/parse.ts:285` — replace `for...of` with `.forEach()`.
- `convex/extraction/mutations.ts:498-509` — change `citationValidityRate` to
  `number | undefined`, drop `recallOnInclude: null` (Phase 96 populates it).
- `convex/extraction/mutations.test.ts:26-49` — add explicit
  `Promise<Doc<"extractionJobs">>` return type to `seedExtractionJob`, import
  `Doc` from `_generated/dataModel`.

## Verify

- `pm2 logs convex` shows clean build (no typecheck errors)
- `npx convex dev --once` succeeds against dev deployment
- Zero regressions in other extraction test files (cancel.test.ts, early-return.test.ts)
