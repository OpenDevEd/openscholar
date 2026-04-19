# Plan 01 — `chatPapers` Bridge Table, Seed, Cascade, Duplicate

**Depends on:** nothing. **Blocks:** 02, 03, 04, 05, 06.

## Goal

Introduce the mutable inclusion layer on top of the immutable `extractionJobSources` snapshot.

Adds a single new table `chatPapers` with a 1:1 relationship to `extractionJobSources` (scoped to chat-mode jobs), seeded `included: true` at `ensureThreadForJob` time. Wires cascade-delete and duplicate-job so the new table participates cleanly in existing job lifecycle.

**No UI changes. No prompt behavior changes.** This plan only installs the substrate. Plans 02+ consume it.

Implements decision **D3** (bridge table, not boolean-on-source) and **D14** (seed-all-included, cascade, duplicate-carries-toggles).

## Scope

**In scope**

- New `chatPapers` table in `convex/schema.ts`.
- Seed hook inside `ensureThreadForJob` (`convex/chat/threads.ts:82-138`) — insert one `chatPapers` row per `extractionJobSources` row immediately after `replaceJobSources` resolves the final deduplicated list.
- Cascade hook inside `deleteExtraction` (`convex/extraction/mutations/jobs.ts`) — scheduler-chained batch delete of `chatPapers` rows for the job.
- Duplicate hook inside `duplicateJob` (`convex/extraction/mutations/jobs.ts`) — clone `chatPapers` rows from the source job (preserving `included` flags, re-mapping `sourceId`s to the cloned `extractionJobSources` rows).
- Dev-only one-shot admin mutation `backfillChatPapersForExistingChats` for seeding existing chat jobs.
- Pure-logic helpers extracted for testability: `buildSeedChatPaperRows(sources)`, `cloneChatPapersForDuplicate(rows, sourceIdMap)`.
- Tests for the pure helpers. Test-after for the Convex wiring.

**Out of scope**

- Reading `chatPapers` in the prompt builder (plan 02).
- Toggle / bulk mutations (plan 03).
- Any UI (plans 04, 05).
- Citation live-state (plan 05).

## Design

### 1. Schema (`convex/schema.ts`)

New table, placed adjacent to `extractionJobSources` in the file:

```ts
chatPapers: defineTable({
  jobId: v.id("extractionJobs"),          // always a chat-mode job
  sourceId: v.id("extractionJobSources"),  // the frozen snapshot row this toggles
  included: v.boolean(),                   // live — read at every stream-start
})
  .index("by_job", ["jobId"])              // list-with-inclusion query (plan 03)
  .index("by_job_included", ["jobId", "included"])  // prompt-builder filter (plan 02)
  .index("by_job_source", ["jobId", "sourceId"])    // uniqueness guard + lookup
  .index("by_source", ["sourceId"]),       // cascade when a source row is ever deleted (future-proof)
```

**Uniqueness invariant:** exactly one `chatPapers` row per `(jobId, sourceId)` pair. The `by_job_source` index is the lookup path; mutations in plan 03 check-before-insert via this index. No DB-level uniqueness constraint (Convex doesn't have them); the invariant is enforced at the write site.

**Why bridge table, not boolean on `extractionJobSources`:** see decision D3 in `00-README.md`. Keeps the frozen snapshot pristine, isolates high-frequency toggle writes from the immutable audit table, avoids cloning-semantics confusion on `duplicateJob`.

### 2. Pure-logic helpers (TDD-able)

**`convex/chat/chatPapersSeed.ts`** — pure helper, no Convex `ctx`:

```ts
import type { Id } from "../_generated/dataModel";

export type SeedChatPaperRow = {
  jobId: Id<"extractionJobs">;
  sourceId: Id<"extractionJobSources">;
  included: boolean;
};

export function buildSeedChatPaperRows(
  jobId: Id<"extractionJobs">,
  sourceIds: Array<Id<"extractionJobSources">>,
): SeedChatPaperRow[] {
  return sourceIds.map((sourceId) => ({ jobId, sourceId, included: true }));
}
```

**`convex/chat/chatPapersDuplicate.ts`** — pure helper for `duplicateJob`:

```ts
import type { Id } from "../_generated/dataModel";

export type SourceChatPaperRow = {
  sourceId: Id<"extractionJobSources">;
  included: boolean;
};

export function cloneChatPapersForDuplicate(
  newJobId: Id<"extractionJobs">,
  sourceRows: SourceChatPaperRow[],
  sourceIdMap: Map<Id<"extractionJobSources">, Id<"extractionJobSources">>,
): SeedChatPaperRow[] {
  return sourceRows
    .map((row) => {
      const newSourceId = sourceIdMap.get(row.sourceId);
      if (!newSourceId) return null;
      return { jobId: newJobId, sourceId: newSourceId, included: row.included };
    })
    .filter((x): x is SeedChatPaperRow => x !== null);
}
```

`sourceIdMap` is built by the caller inside `duplicateJob` — which already walks `extractionJobSources` to clone them. Wire the map as it clones: for each old sourceId it produces, store the new sourceId.

Unknown-sourceId rows (theoretically unreachable; defensive) are silently dropped, not thrown, so a partial sourceId map never crashes the duplicate.

### 3. Seed hook — `convex/chat/threads.ts`

Current `ensureThreadForJob` (line 82-138 per research brief):

```
1. resolvePreparedSources(jobId)  →  expanded list
2. expandJobSources()             →  deduped list
3. replaceJobSources()            →  writes extractionJobSources rows
4. (chat thread creation)
```

Insert step 3.5:

```ts
// After replaceJobSources resolves with the final source rows:
const seedRows = buildSeedChatPaperRows(jobId, finalSourceIds);
for (const row of seedRows) {
  await ctx.db.insert("chatPapers", row);
}
```

**Why not batched:** 500 inserts in a single mutation is well within Convex's 16k write ceiling. Current jobs typically have 5–50 sources; no chained-scheduler needed.

**Idempotency — wipe-and-rewrite, not pre-check-and-skip.** The original plan proposed a pre-check ("if `chatPapers.by_job(jobId)` already returns any row, skip the seed"). That approach has a partial-retry bug: if a prior `persistPreparedSourcesForJob` mutation committed successfully but the downstream `paperChat.createThread` call then failed, a retry re-enters `persistPreparedSourcesForJob` and `replaceJobSources` wipes+re-inserts source rows with new `_id`s — while the pre-check would leave the previous run's `chatPapers` pointing at now-deleted `sourceId`s.

Instead, mirror `replaceJobSources`'s wipe-and-rewrite semantic: delete any existing `chatPapers` rows for the job before seeding, then always seed fresh from the newly written source `_id`s. The whole mutation is transactional, so all-or-nothing — no duplicate rows, no stale references.

### 4. Cascade hook — `convex/extraction/mutations/jobs.ts::deleteExtraction`

Per research brief, the existing `deleteExtraction` does batched cascade via `ctx.scheduler.runAfter`. Add `chatPapers` as one more step in the chain:

```ts
// Inside the existing batched cascade, after extractionJobSources deletion:
const chatPapersBatch = await ctx.db
  .query("chatPapers")
  .withIndex("by_job", (q) => q.eq("jobId", jobId))
  .take(BATCH_SIZE);

for (const row of chatPapersBatch) {
  await ctx.db.delete(row._id);
}

if (chatPapersBatch.length === BATCH_SIZE) {
  await ctx.scheduler.runAfter(0, internal.extraction.mutations.jobs.deleteExtractionContinue, {
    jobId, step: "chatPapers", cursor: <cursor>
  });
  return;
}
```

Match the existing cascade's batching and step-naming convention — do not invent a new pattern. Explore first: read the current `deleteExtraction` implementation and copy the existing cascade step's exact shape.

### 5. Duplicate hook — `convex/extraction/mutations/jobs.ts::duplicateJob`

Current `duplicateJob` (agent brief): clones `extractionJobs` + `extractionJobSources` to new IDs. Extend:

```ts
// After extractionJobSources are cloned:
// sourceIdMap: Map<oldSourceId, newSourceId> built during the extractionJobSources clone loop

const oldChatPapers = await ctx.db
  .query("chatPapers")
  .withIndex("by_job", (q) => q.eq("jobId", oldJobId))
  .collect();

const newRows = cloneChatPapersForDuplicate(newJobId, oldChatPapers, sourceIdMap);
for (const row of newRows) {
  await ctx.db.insert("chatPapers", row);
}
```

**Only applies to chat-mode clones.** If `duplicateJob` is called on an extraction-mode job, skip the chatPapers step — extraction jobs have no `chatPapers` rows by construction. Gate on `job.mode === "chat"` (or whatever the existing field is called; confirm in research).

### 6. Dev-only backfill — `convex/chat/adminBackfill.ts`

One-shot mutation to seed existing chats. Gated to dev:

```ts
export const backfillChatPapersForExistingChats = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.NODE_ENV !== "development") {
      throw new Error("backfill is dev-only");
    }

    const chatJobs = await ctx.db
      .query("extractionJobs")
      .withIndex("by_mode", (q) => q.eq("mode", "chat"))  // confirm index name
      .collect();

    let inserted = 0;
    for (const job of chatJobs) {
      // Skip if already seeded
      const existing = await ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", job._id))
        .first();
      if (existing) continue;

      const sources = await ctx.db
        .query("extractionJobSources")
        .withIndex("by_job", (q) => q.eq("jobId", job._id))
        .collect();

      for (const src of sources) {
        await ctx.db.insert("chatPapers", { jobId: job._id, sourceId: src._id, included: true });
        inserted += 1;
      }
    }

    return { jobsSeeded: chatJobs.length, rowsInserted: inserted };
  },
});
```

Run once from the Convex dashboard after deploy. If there are no chats in dev, returns `{jobsSeeded: 0, rowsInserted: 0}` — no-op.

## TDD sequence (pure logic only)

### `convex/chat/chatPapersSeed.test.ts`

```
R1 → G1   test: buildSeedChatPaperRows(jobId, [])  → []
R2 → G2   test: buildSeedChatPaperRows(jobId, [s1])
          → [{jobId, sourceId: s1, included: true}]
R3 → G3   test: buildSeedChatPaperRows(jobId, [s1, s2, s3]) has length 3, all included=true
R4 → G4   test: every row has the same jobId as input (stable over the list)
R5 → G5   test: sourceId ordering preserved (matches input order)
REFACTOR  extract the literal `true` into a named constant DEFAULT_INCLUDED = true; re-run.
```

### `convex/chat/chatPapersDuplicate.test.ts`

```
R1 → G1   test: cloneChatPapersForDuplicate(newJobId, [], new Map())  → []
R2 → G2   test: single row cloned with mapped sourceId, included preserved
           input: [{sourceId: s1_old, included: false}], map: {s1_old → s1_new}
           expect: [{jobId: newJobId, sourceId: s1_new, included: false}]
R3 → G3   test: multiple rows cloned, included flags preserved per-row
           input: [{s1_old, true}, {s2_old, false}], map: {s1_old→s1_new, s2_old→s2_new}
           expect: 2 rows, flags match
R4 → G4   test: unknown sourceId in input but missing from map → dropped silently
           input: [{s1_old, true}], map: new Map()
           expect: []
R5 → G5   test: unknown interleaved with known — known emitted, unknown dropped
           input: [{s1_old, true}, {s_ghost, false}, {s2_old, true}], map: {s1_old→s1, s2_old→s2}
           expect: 2 rows
R6 → G6   test: all rows use the same newJobId (stable over list)
REFACTOR  no refactor expected; the function is small and pure.
```

**Phase A (TDD):** write the tests above, watch red, implement, watch green. Commit per green.

**Phase B (test-after):** Convex wiring in `threads.ts`, `jobs.ts` cascade, `jobs.ts` duplicate, admin backfill. One commit per logical unit.

## Files touched

- `convex/schema.ts` — add `chatPapers` table + 4 indices.
- `convex/chat/chatPapersSeed.ts` (new) — pure helper.
- `convex/chat/chatPapersSeed.test.ts` (new).
- `convex/chat/chatPapersDuplicate.ts` (new) — pure helper.
- `convex/chat/chatPapersDuplicate.test.ts` (new).
- `convex/chat/threads.ts` — wire seed hook at the end of `ensureThreadForJob`.
- `convex/extraction/mutations/jobs.ts` — add `chatPapers` step to `deleteExtraction` cascade; add clone step to `duplicateJob` (chat-mode only).
- `convex/chat/adminBackfill.ts` (new) — `backfillChatPapersForExistingChats` internal mutation.
- `tests/chat/chatPapersLifecycle.test.ts` (new) — Convex-level integration tests (test-after).

## Migration stance — **none; dev backfill is a one-shot fill, not a schema migration**

Per `00-README.md`:

1. Edit `convex/schema.ts`. Deploy. New table takes effect immediately; no old-row rejection because `chatPapers` is a new table, not a shape change.
2. Open Convex dashboard, run `internal.chat.adminBackfill.backfillChatPapersForExistingChats` once. It seeds `included=true` for every `(chatJob, source)` pair that doesn't already have a row.
3. For fresh chats created after deploy, the seed hook in `ensureThreadForJob` handles it.

Do not write any `@convex-dev/migrations` script. Do not leave a "legacy unseeded chats" code path — the backfill closes it permanently.

## Test plan

### Unit (pure helpers — covered in TDD sequence above)
- `buildSeedChatPaperRows` — 5 cases.
- `cloneChatPapersForDuplicate` — 6 cases including drop-unknown-sourceId.

### Convex integration (`tests/chat/chatPapersLifecycle.test.ts`)

Use the existing Convex test harness. One behavior per test.

- **seed-on-ensureThreadForJob**: create a chat-mode job with 3 source rows → call `ensureThreadForJob` → assert `chatPapers.by_job(jobId)` returns 3 rows, all `included=true`, one row per source.
- **seed-is-idempotent**: call `ensureThreadForJob` twice on the same job → `chatPapers.by_job(jobId)` still returns 3 rows (not 6).
- **cascade-delete**: seed a job with 100 sources → call `deleteExtraction(jobId)` → wait for scheduler chain to drain → assert `chatPapers.by_job(jobId)` is empty.
- **duplicate-carries-toggles**: seed a job with 5 sources, mutate one row to `included: false` (via direct `ctx.db.patch` in the test; mutation doesn't exist yet but row shape is known) → `duplicateJob(sourceJobId)` → assert new job has 5 `chatPapers` rows with flags mirroring source (1 false, 4 true), all pointing to the newly-cloned sources.
- **duplicate-extraction-mode-is-noop**: duplicate an extraction-mode job → no `chatPapers` rows for new or old job.

### Admin backfill smoke test

- Create 2 chat-mode jobs with sources but no `chatPapers` rows (bypass `ensureThreadForJob`'s seed by inserting jobs+sources directly).
- Call `backfillChatPapersForExistingChats`.
- Assert: both jobs now have their source-count matching chatPapers rows, all `included=true`.
- Call it a second time. Assert: no new rows inserted (idempotent).

## Acceptance criteria

- [ ] `convex/schema.ts` contains `chatPapers` table with all 4 indices.
- [ ] `buildSeedChatPaperRows` and `cloneChatPapersForDuplicate` are pure, fully tested, and exported from `convex/chat/chatPapersSeed.ts` / `chatPapersDuplicate.ts`.
- [ ] `ensureThreadForJob` seeds `chatPapers` 1:1 with `extractionJobSources` on first run; no-op on subsequent runs.
- [ ] `deleteExtraction` cascade clears all `chatPapers` rows for the deleted job.
- [ ] `duplicateJob` in chat mode clones `chatPapers` with `included` flags preserved; in extraction mode it's a no-op.
- [ ] `backfillChatPapersForExistingChats` seeds pre-existing chat jobs once, idempotent on replay, gated to dev.
- [ ] All Convex integration tests green.
- [ ] No migration file added.

## Known pitfalls

- **Cascade step ordering** — if `chatPapers` cascade runs *before* `extractionJobSources` cascade, there's a brief window where `chatPapers` rows reference now-deleted sources. Cosmetic only (neither is queried during cascade), but match the existing pattern: cascade `chatPapers` *after* `extractionJobSources` is fully drained, or interleave per batch. Copy the existing pattern; don't invent.
- **Duplicate-job sourceId map construction** — the current `duplicateJob` may not expose the `{old → new}` sourceId mapping as a variable. You may need to refactor its source-cloning loop to build and return the map. This is a clean refactor, not a hack; `duplicateJob` is a local function, no external callers read its internal state.
- **`mode` index existence** — the backfill query filters `extractionJobs.by_mode`. Confirm this index exists; if not, add it as part of plan 01 (it's a trivial addition and is likely useful elsewhere). If the existing codebase uses a different discriminator (e.g., `kind`, `type`), use that field name consistently.
- **Admin-backfill gating** — `process.env.NODE_ENV` is not automatically populated server-side in Convex; check existing admin mutations for the project's convention (typically a `ADMIN_TOKEN` env var gate or a `users.role === "admin"` check). Reuse the existing pattern rather than inventing one.
- **Schema-validator behavior when the table doesn't exist yet** — this is a new table, not a change to an existing one; the validator has nothing to reject. First deploy "just works" — no wipe needed for this table specifically. The wipe stance from the README applies if someone reverts and redeploys.
