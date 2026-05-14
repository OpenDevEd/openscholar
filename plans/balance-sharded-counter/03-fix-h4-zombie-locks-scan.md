# Plan 03 — H4: `cleanupZombieChatLocks` uses the `by_mode` index

## Goal

Drop the 5-minute full-table scan over `extractionJobs` in favor of an indexed scan of `mode === "chat"` rows. The `by_mode` index already exists; the function ignores it.

## Scope

In:
- `convex/chat/concurrency.ts` (function `cleanupZombieChatLocks`, current lines 136-164)
- `convex/chat/concurrency.test.ts` (or wherever this cron is covered) for a regression test.

Out: everything else.

## Design

Current (`convex/chat/concurrency.ts:139-161`):

```ts
for await (const row of ctx.db.query("extractionJobs")) {
  if (row.mode !== "chat") continue;
  if (!row.isGenerating) continue;
  ...
}
```

Replacement:

```ts
for await (const row of ctx.db
  .query("extractionJobs")
  .withIndex("by_mode", (q) => q.eq("mode", "chat"))) {
  if (!row.isGenerating) continue;
  if ((row.generatingStartedAt ?? 0) >= cutoff) continue;
  await ctx.db.patch(row._id, {
    isGenerating: false,
    generatingStartedAt: undefined,
    chatGenerationAttemptId: undefined,
    shouldAbort: undefined,
    updatedAt: Date.now(),
  });
  console.log(`[cleanupZombieChatLocks] cleared stale lock on ${row._id}`);
  cleared += 1;
}
```

Also delete the now-misleading comment block at lines 141-144 ("No index on `isGenerating` alone…") — the index gates on `mode`, which is sufficient since chat is the only mode that ever sets `isGenerating`.

## TDD sequence

R1. Seed two `extractionJobs` rows: one with `mode="chat" isGenerating=true generatingStartedAt=<stale>`, one with `mode="extract" isGenerating=true generatingStartedAt=<stale>` (the non-chat row is invalid but tests that the index gate excludes it). Run the cron. Assert only the chat row was cleared (and the extract row is untouched).

R2. Seed a chat row with a FRESH `generatingStartedAt`. Run cron. Assert it was NOT cleared.

R3. Seed a chat row with `isGenerating=false`. Run cron. Assert no patch was applied.

## Files touched

- `convex/chat/concurrency.ts`
- `convex/chat/concurrency.test.ts` (new or extended)

## Migration stance

Additive — no schema change. `by_mode` index already exists.

## Test plan

- `pnpm test convex/chat/concurrency.test.ts` (R1-R3 green).
- `pnpm tsc --noEmit` clean.

## Deployability gate

`npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!` after the commit.

## Acceptance criteria

1. `cleanupZombieChatLocks` uses `.withIndex("by_mode", q => q.eq("mode", "chat"))`.
2. The explicit `row.mode !== "chat"` continue is gone.
3. The misleading comment block is gone.
4. R1-R3 green.
5. Convex push healthy.

## Known pitfalls

- The `by_mode` index already exists on `extractionJobs` (confirmed in `convex/schema.ts` per the explore agent's report). Do not invent a new one.
- The cron fires every 5 min (`convex/crons.ts:69-73`); after deploy, watch pm2 for at least one tick to confirm the new path doesn't log unexpected errors.
- Async iteration without `.collect()` / `.take()` per the Convex guidelines — already the case here, just keep it.
