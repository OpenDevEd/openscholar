---
task: Fix Convex dev typecheck failures from v6.0 milestone
slug: fix-convex-v6-typecheck
date: 2026-04-15
status: complete
commit: bdde32d
---

# Summary

Convex dev was stuck in a restart loop (visible in `pm2 logs convex`) because
10 TypeScript errors from leftover v6.0 milestone work were failing the
`convex dev` typecheck:

```
Found 10 errors in 3 files.
     7  convex/extraction/mutations.test.ts:291
     2  convex/extraction/mutations.ts:507
     1  convex/extraction/parse.ts:285
```

Three independent root causes, all fixed in a single atomic commit.

## Fixes

### 1. `convex/extraction/parse.ts:285` — NodeListOf not iterable

`linkedom`'s `article.querySelectorAll(...)` returns a DOM
`NodeListOf<Element>`. Under `tsconfig.lib: ["ES2021", "dom"]` without
`dom.iterable`, this type has no `[Symbol.iterator]()`, so `for...of` fails
(TS2488).

Replaced the `for...of` loop with `.forEach((el) => el.remove())`. Cleaner,
no tsconfig churn.

### 2. `convex/extraction/mutations.ts:498-509` — null not assignable

`finalizeJobIfDone` was patching two schema fields to `null`:

```ts
citationValidityRate,         // null when no verdicts yet
recallOnInclude: null,        // "Phase 96 populates this via eval loop"
```

But the schema declares both as `v.optional(v.number())`, which translates to
`number | undefined`, never nullable. `null` is a TS2322 type error against
Convex's `PatchValue<T>`.

- Retyped `citationValidityRate` to `number | undefined` (the only safe value
  when no verdicts exist).
- Dropped the `recallOnInclude: null` patch entirely. Optional fields are
  simply absent; the Phase 96 eval loop can fill it in later with a real
  number. Setting it to `null` now was a no-op at best and a schema violation
  at worst.

### 3. `convex/extraction/mutations.test.ts:26-49` — Doc type widening

The `seedExtractionJob` helper returned `(await ctx.db.get(id))!` without an
explicit return type. TypeScript failed to propagate `Doc<"extractionJobs">`
through `t.run(...)` and widened the return to the full doc-union of every
table in the schema. That made `job._id` a union of all table ids, so
`ctx.db.get(job._id)` inside the test returned the full doc-union and every
field access (`processedPapers`, `failedPapers`, `totalPapers`, `status`,
`completedAt`) fired TS2339.

Added explicit `Promise<Doc<"extractionJobs">>` on both the outer function
and the inner `t.run` callback, plus `Doc` to the import list. Inference now
narrows correctly and all 7 test-file errors resolve.

## Verification

- `npx convex dev --once` → `✔ Convex functions ready! (8s)` (pushed to dev
  deployment, not prod)
- `pm2 logs convex` → clean build at 13:10:57, no more typecheck loop
- `pm2 list` → convex process stable, no additional restarts after fix

## Files changed

- `convex/extraction/parse.ts` (1 line)
- `convex/extraction/mutations.ts` (5 lines)
- `convex/extraction/mutations.test.ts` (4 lines: import + 2 type annotations)

## Notes

- All three bugs date back to Phase 96 / Phase 97 work in the v6.0 milestone
  (the comment on `recallOnInclude` literally says "Phase 96 populates this
  via eval loop"). They were introduced but never caught because `convex dev`
  was apparently not running cleanly before the archive.
- No production deployment was touched. Only `npx convex dev` against the dev
  deployment, as explicitly requested.
- No test changes to `cancel.test.ts` or `early-return.test.ts` — those
  helpers already return `id` directly and were unaffected.
