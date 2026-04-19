# Plan 03 — Toggle Mutations, Bulk Mutation, List-With-Inclusion Query

**Depends on:** 01 (bridge table). **Independent of:** 02 (can parallelize after 01 lands). **Blocks:** 04 (UI), 05 (citation-live-state).

## Goal

Add the Convex API surface the UI needs: one reactive query that returns every chat paper joined with its inclusion state, one mutation for single-row toggle, one mutation for bulk set-many, all optimistic-update-friendly so the UI can flip state synchronously on click.

Implements decisions **D11** (rapid clicks fire individual mutations — no server-side debounce), **D13** (single toggle optimistic no undo, bulk toggle with toast-undo), and sets up the contract plan 04 consumes.

## Scope

**In scope**

- `convex/chat/chatPapers.ts` (new module) — holds all queries and mutations for `chatPapers`.
- Query `listChatSourcesWithInclusion(jobId)` — joins `extractionJobSources` with `chatPapers` and returns a flat row shape ready for the Sources panel (title, authors, year, abstract, doi, openalexId, pdfUrl, bucketKey, sourceType, included, chatPaperId, sourceId, position).
- Mutation `toggleChatPaper(chatPaperId, included)` — single-row patch, idempotent, returns `{ included }` for optimistic reconciliation.
- Mutation `bulkSetChatPapers(jobId, sourceIds?, included)` — if `sourceIds` omitted, patches every chatPapers row for the job. Returns `{ changedCount }` for toast copy.
- Auth enforcement — every operation verifies the caller owns the job (match the existing chat auth pattern — research before inventing).
- `lib/chat/chat-papers-selection.ts` (new pure module) — the `.withOptimisticUpdate` patch-helper reused by both single and bulk UIs; TDD.
- Tests for the pure optimistic helper. Test-after for the Convex handlers.

**Out of scope**

- UI consumers (plan 04 wires `useQuery`/`useMutation`).
- Prompt-builder updates (plan 02).
- Composer empty-state (plan 04).
- URL-state sync (plan 04).

## Design

### 1. Shape of `listChatSourcesWithInclusion` return

The UI needs one payload per paper with everything required to render, search, sort, chip-filter, and toggle. No second query should be needed (keeps the reactive subscription count low).

```ts
export type ChatSourceRow = {
  chatPaperId: Id<"chatPapers">;
  sourceId: Id<"extractionJobSources">;
  jobId: Id<"extractionJobs">;
  position: number;                 // stable 1-indexed, for `P${position}` resolution
  included: boolean;                // live inclusion state
  title: string;
  authors: string[];                // already split; renderer handles "First et al."
  year: number | null;
  abstract: string | null;          // for weighted search (plan 04)
  doi: string | null;
  pdfUrl: string | null;
  openalexId: string | null;
  bucketKey: string;                // for keying React list rows
  sourceType: "openalex" | "upload" | "zotero" | "history" | "unknown";
};
```

The `sourceType` is derived from existing fields on `extractionJobSources` (per research brief, the schema carries `searchFilters`, `zoteroUserId`, etc. — the discriminator rule is: `zoteroUserId != null → "zotero"`; `searchFilters != null → "history"`; `pdfUrl startsWith "storage:" → "upload"`; else `"openalex"`). Encapsulate the rule in a pure helper `classifySourceType(row)` in `lib/chat/source-type.ts` so it can be reused by tests and by the chips in plan 04.

Return the list **sorted by `position` ascending**. This matches the frozen job-creation order and gives the default "Added" sort for free. Client-side `Array.slice().sort(...)` handles other sorts in plan 04 without a re-subscription.

### 2. Query implementation — `convex/chat/chatPapers.ts`

```ts
export const listChatSourcesWithInclusion = query({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, { jobId }) => {
    await assertCallerOwnsJob(ctx, jobId);      // shared auth helper, see §4

    const [sources, chatPapers] = await Promise.all([
      ctx.db
        .query("extractionJobSources")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
      ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
    ]);

    const inclusionBySourceId = new Map(
      chatPapers.map((cp) => [cp.sourceId, cp]),
    );

    return sources
      .map((src) => {
        const cp = inclusionBySourceId.get(src._id);
        if (!cp) return null;  // defensive — plan 01 seed guarantees 1:1
        return toChatSourceRow(src, cp);
      })
      .filter((x): x is ChatSourceRow => x !== null)
      .sort((a, b) => a.position - b.position);
  },
});
```

**Why not use the `by_job_source` index for pairwise join:** collecting both lists and joining in memory is O(N) and idiomatic at N≤500. The index-join alternative requires one lookup per source row, which is slower and messier. Inline join wins.

**Subscription invalidation scope:** this query subscribes to both tables. A single toggle invalidates only the `chatPapers` side's row, but the whole return payload re-renders. At 500 rows × ~500 bytes = ~250KB repush — acceptable. If telemetry in plan 06 shows this is a problem, split into two queries (static `getJobSourcesForChat` + reactive `getInclusionBySourceId`) and merge client-side. Not doing that preoptimization now.

### 3. Single-toggle mutation

```ts
export const toggleChatPaper = mutation({
  args: {
    chatPaperId: v.id("chatPapers"),
    included: v.boolean(),
  },
  handler: async (ctx, { chatPaperId, included }) => {
    const row = await ctx.db.get(chatPaperId);
    if (!row) throw new ConvexError({ code: "not_found" });
    await assertCallerOwnsJob(ctx, row.jobId);

    // Idempotent: if already at the desired state, patch is a no-op but still succeeds.
    if (row.included !== included) {
      await ctx.db.patch(chatPaperId, { included });
    }

    return { chatPaperId, included };
  },
});
```

**Idempotency matters for optimistic UI:** double-click races where both clicks land could arrive in either order. Last-write-wins is fine because each click carries its intended terminal value, not a toggle-flip.

**No debounce (D11):** each click fires its own mutation. The bridge table isolates contention (distinct doc per toggle), so rapid clicks don't contend. Per Agent 2: "writes against many distinct `chatPapers` rows do not contend."

### 4. Bulk-set mutation

```ts
export const bulkSetChatPapers = mutation({
  args: {
    jobId: v.id("extractionJobs"),
    sourceIds: v.optional(v.array(v.id("extractionJobSources"))),
    included: v.boolean(),
  },
  handler: async (ctx, { jobId, sourceIds, included }) => {
    await assertCallerOwnsJob(ctx, jobId);

    let rows: Doc<"chatPapers">[];
    if (sourceIds === undefined) {
      // No filter → every row for the job.
      rows = await ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
    } else {
      // Filter to the provided sourceIds. Convex doesn't have "IN" — look each up.
      const sourceIdSet = new Set(sourceIds);
      const allForJob = await ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
      rows = allForJob.filter((r) => sourceIdSet.has(r.sourceId));
    }

    let changedCount = 0;
    for (const row of rows) {
      if (row.included !== included) {
        await ctx.db.patch(row._id, { included });
        changedCount += 1;
      }
    }

    return { changedCount };
  },
});
```

**Why accept `sourceIds` and not `chatPaperIds`:** the UI knows sourceIds from the result of `listChatSourcesWithInclusion`, and the mapping `sourceId → chatPaperId` is trivial server-side. Client-side the UI does NOT need to know `chatPaperId` for bulk ops — only for the single-toggle path where the row is already in hand.

**16k-write ceiling:** 500 rows × 1 patch = 500 writes, well under Convex's 16k per-mutation limit. No scheduler chaining needed. If `PAPER_LIMIT_MAX` ever rises above ~10k, split via `scheduler.runAfter` with cursor pagination — but do not preoptimize.

**Invert semantics:** there is no dedicated `invert` mutation. The UI implements invert by computing the desired state per row client-side and calling `bulkSetChatPapers` once per state value (two calls: one for the currently-included-becoming-excluded, one for the opposite), or by using two separate `bulkSetChatPapers` calls with disjoint `sourceIds`. This keeps the server contract simple.

Decision rationale: server-side invert would require reading all rows, computing NOT, writing all — the same work the client does but with more server roundtrips. Client-side computation + two bulk calls is cleaner.

### 5. Auth helper — reuse existing pattern

Research requirement before writing: find the existing auth pattern used by `convex/chat/messages.ts::sendMessage` (or the nearest chat-scoped mutation). Expected: something like `await ctx.runQuery(internal.users.current)` → compare `userId` against `job.createdBy` or equivalent.

Extract (if not already) into `convex/chat/auth.ts`:

```ts
export async function assertCallerOwnsJob(ctx: MutationCtx | QueryCtx, jobId: Id<"extractionJobs">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "unauthenticated" });

  const job = await ctx.db.get(jobId);
  if (!job) throw new ConvexError({ code: "not_found" });

  // ...match existing ownership-check pattern here; do not invent.
}
```

**Do not duplicate the check** — if an existing helper exists, use it. Research first.

### 6. Pure optimistic helper — `lib/chat/chat-papers-selection.ts`

Shared by both single-toggle and bulk-set `.withOptimisticUpdate` callbacks:

```ts
import type { ChatSourceRow } from "convex/chat/chatPapers";

export function applyInclusionPatch(
  rows: ChatSourceRow[],
  patch: Map<Id<"chatPapers">, boolean>,
): ChatSourceRow[] {
  return rows.map((row) =>
    patch.has(row.chatPaperId) ? { ...row, included: patch.get(row.chatPaperId)! } : row,
  );
}

export function buildBulkPatch(
  rows: ChatSourceRow[],
  sourceIds: Id<"extractionJobSources">[] | undefined,
  included: boolean,
): Map<Id<"chatPapers">, boolean> {
  const targetSourceIds = sourceIds ? new Set(sourceIds) : null;
  const patch = new Map<Id<"chatPapers">, boolean>();
  for (const row of rows) {
    if (targetSourceIds === null || targetSourceIds.has(row.sourceId)) {
      if (row.included !== included) {
        patch.set(row.chatPaperId, included);
      }
    }
  }
  return patch;
}
```

UI callback (plan 04 will use this — shown here for context):

```ts
const toggle = useMutation(api.chat.chatPapers.toggleChatPaper)
  .withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(api.chat.chatPapers.listChatSourcesWithInclusion, { jobId });
    if (!current) return;
    const patched = applyInclusionPatch(current, new Map([[args.chatPaperId, args.included]]));
    localStore.setQuery(api.chat.chatPapers.listChatSourcesWithInclusion, { jobId }, patched);
  });
```

Extracting `applyInclusionPatch` and `buildBulkPatch` as pure functions lets us TDD them without a Convex harness.

## TDD sequence (pure logic only — `lib/chat/chat-papers-selection.ts`)

### `lib/chat/chat-papers-selection.test.ts`

```
R1 → G1   test: applyInclusionPatch([], new Map()) → []
R2 → G2   test: applyInclusionPatch with empty patch returns same reference equality
          for rows that weren't touched (no accidental spread)
R3 → G3   test: applyInclusionPatch flips a single row
          input: [{chatPaperId:"cp1",included:true}], patch: {cp1 → false}
          output: [{chatPaperId:"cp1",included:false}]
R4 → G4   test: applyInclusionPatch leaves untargeted rows untouched
          input: [cp1:true, cp2:true], patch: {cp1→false}
          output: [cp1:false, cp2:true] (cp2 same reference)
R5 → G5   test: applyInclusionPatch does not mutate input array
          Object.isFrozen on input after call does not throw
R6 → G6   test: buildBulkPatch with no sourceIds targets every row
          rows: [cp1:true, cp2:false, cp3:true], included:false
          patch: {cp1→false, cp3→false}  (cp2 skipped because already false)
R7 → G7   test: buildBulkPatch skips no-op rows (already at target state)
          rows: all included=true, included:true → patch size 0
R8 → G8   test: buildBulkPatch with sourceIds filters to that subset
          rows: [sid1/cp1:true, sid2/cp2:true, sid3/cp3:true], sourceIds:[sid1,sid3], included:false
          patch: {cp1→false, cp3→false}
R9 → G9   test: buildBulkPatch with empty sourceIds array → patch size 0
          (distinct from undefined — empty means "no rows match", undefined means "all rows")
R10→ G10  test: buildBulkPatch stable over row order — same rows in any permutation
          produce a Map with same entries (compare via Array.from().sort())
REFACTOR  if buildBulkPatch grows hairy, extract the "should include this row" predicate;
          re-run full suite green.
```

Also TDD the source-type classifier:

### `lib/chat/source-type.test.ts`

```
R1 → G1   test: classifySourceType({zoteroUserId: "uid"}) → "zotero"
R2 → G2   test: classifySourceType({searchFilters: {...}}) → "history"
R3 → G3   test: classifySourceType({pdfUrl: "storage:abc"}) → "upload"
R4 → G4   test: classifySourceType({openalexId: "W1"}) → "openalex"
R5 → G5   test: classifySourceType({}) → "unknown"
R6 → G6   test: precedence — when multiple signals present, zotero wins, then history, then upload, then openalex
R7 → G7   test: exact literal strings, not enums — output is narrowed as "openalex"|"upload"|"zotero"|"history"|"unknown"
```

Phase B (test-after): Convex handlers, subscriptions, auth wiring.

## Files touched

- `convex/chat/chatPapers.ts` (new) — `listChatSourcesWithInclusion`, `toggleChatPaper`, `bulkSetChatPapers`.
- `convex/chat/auth.ts` (new OR extend existing) — `assertCallerOwnsJob` helper. Research first — reuse if present.
- `lib/chat/chat-papers-selection.ts` (new) — pure optimistic helpers.
- `lib/chat/chat-papers-selection.test.ts` (new).
- `lib/chat/source-type.ts` (new) — pure `classifySourceType`.
- `lib/chat/source-type.test.ts` (new).
- `convex/chat/chatPapers.test.ts` (new) — Convex-level tests.

## Migration stance — **none**

No schema changes. Plan 01 already shipped the table. Plan 02 already teaches the prompt to read it. This plan adds the write API and a read-with-join query. Zero migration surface.

## Test plan

### Unit (pure — covered in TDD sequence)
- `applyInclusionPatch` + `buildBulkPatch` — 10 cases.
- `classifySourceType` — 7 cases.

### Convex integration (`convex/chat/chatPapers.test.ts`)

- **listChatSourcesWithInclusion returns all rows with inclusion**: seed 3-source chat, all included → returns 3 rows with `included=true`, positions ascending.
- **listChatSourcesWithInclusion reflects toggles**: same 3-source chat, patch one `chatPapers.included` to false directly → query returns that row with `included=false`.
- **listChatSourcesWithInclusion denies non-owner**: seed a chat as user A, attempt the query as user B → throws `ConvexError({code:"unauthenticated"})` or `"not_found"` per existing auth-helper semantics.
- **toggleChatPaper flips state**: toggle row from true to false → `ctx.db.get(chatPaperId).included === false`.
- **toggleChatPaper is idempotent**: toggle to false, toggle to false again → still false, no error.
- **toggleChatPaper denies non-owner**: user A creates, user B toggles → throws.
- **bulkSetChatPapers all**: 10-source chat, all included → `bulkSetChatPapers(jobId, undefined, false)` → every row now `included=false`, `changedCount === 10`.
- **bulkSetChatPapers subset**: 10-source chat, bulk set 3 specific sourceIds to false → only those 3 change, `changedCount === 3`, other 7 unchanged.
- **bulkSetChatPapers idempotent**: call twice with same args → second call returns `changedCount === 0`.
- **bulkSetChatPapers denies non-owner**: throws.

### Subscription behavior (manual smoke; no automated test unless harness supports it)

- Start a client subscription to `listChatSourcesWithInclusion`. Call `toggleChatPaper`. Assert the client sees the updated row within one tick. (May be covered implicitly by plan 04's UI tests.)

## Acceptance criteria

- [ ] `listChatSourcesWithInclusion` returns the flat joined shape `ChatSourceRow[]` sorted by position.
- [ ] `toggleChatPaper` is idempotent and auth-checked.
- [ ] `bulkSetChatPapers` handles both "all for job" (undefined sourceIds) and "subset by sourceIds".
- [ ] `applyInclusionPatch` and `buildBulkPatch` are pure, fully tested, exported from `lib/chat/chat-papers-selection.ts`.
- [ ] `classifySourceType` is pure, fully tested, exported from `lib/chat/source-type.ts`.
- [ ] Every mutation and query calls `assertCallerOwnsJob` before touching data.
- [ ] All Convex tests green.
- [ ] `rg -n "ctx.db.query\(\"chatPapers\"\)" convex/` returns exactly the expected call sites (no stray reads that bypass auth).

## Known pitfalls

- **N+1 in bulk subset when sourceIds is long** — the current implementation loads all `chatPapers` for the job and filters in memory. At 500 rows this is fine. If a future feature does `bulkSetChatPapers` with `sourceIds.length === 500`, loading 500 rows to mutate 500 rows is one-shot fine. Do NOT attempt to look up each row individually via the `by_job_source` index — that's 500 separate reads and is strictly worse.
- **Optimistic patch + server rejection** — if `toggleChatPaper` throws (auth failure, vanished row), Convex rolls back the optimistic patch automatically. The UI (plan 04) must ensure the error toast fires. Do not try to swallow the error silently.
- **Auth-helper reuse** — resist the urge to invent a new `assertCallerOwnsJob`. If `convex/chat/messages.ts::sendMessage` already has inline auth logic, extract it into `convex/chat/auth.ts` as a **refactor commit** before this plan's feature commits. One extraction, many consumers — DRY.
- **`sourceType` discriminator precedence** — if both `zoteroUserId` and `openalexId` are set on a row (shouldn't happen, but defensively), zotero wins per the TDD R6 test. If your codebase already has a classifier or the precedence order differs, adjust the tests and the helper to match; do not ship two disagreeing classifiers.
- **Race with `ensureThreadForJob`** — if `listChatSourcesWithInclusion` is called before `ensureThreadForJob` has seeded the `chatPapers` rows (e.g., a client navigates to the chat view a millisecond before seeding completes), the `.get(src._id)` lookup returns null and the row is filtered out. UI shows an empty panel briefly. Acceptable — `ensureThreadForJob` is awaited on the page-load path. Document in the plan 04 pitfalls as a known cold-load flash; don't add defensive seeding here.
