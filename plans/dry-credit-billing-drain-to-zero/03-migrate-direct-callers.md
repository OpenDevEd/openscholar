# Plan 03 — Migrate direct `deductCredits` callers to drain-to-zero

## Goal

Migrate the three remaining production sites that call `internal.credits.internal.deductCredits` directly (bypassing `convex/ai/helpers.ts` wrappers) to the drain-to-zero pattern. The two extraction sites must additionally mirror their `recordCreditSpend` aggregator entry with `result.deducted`, not the input estimate.

## Scope

Three sites:

1. `convex/extraction/mutations/results.ts:234` — extraction LLM per-question. Followed at line 248 by `recordCreditSpend({ creditsUsed: args.creditsUsed })` — must change to `creditsUsed: deducted`.
2. `convex/extraction/mutations/papers.ts:238` — embedding billing. Followed at line 253 by `recordCreditSpend({ creditsUsed: args.billing.creditsToDeduct })` — must change to `creditsUsed: deducted`. Also gates `updates.indexingBilled = true`; should still flip `indexingBilled = true` even when `deducted < creditsToDeduct` (the wallet is empty, not the indexing job).
3. `convex/wallet/gateway/handler.ts:270` (inside `makeDeductFn`) — wallet API per-call billing. The DeductFn return type is `Promise<void>`, so the migration is local: capture `deducted`, ignore it (or log it for telemetry).

## Design

### Site 1: `convex/extraction/mutations/results.ts:233-253`

```ts
if (args.creditsUsed > 0 && job) {
  const { deducted } = await ctx.runMutation(
    internal.credits.internal.deductCredits,
    {
      userId: job.userId,
      amount: args.creditsUsed,
      description: "AI: Extraction (1 question)",
      jobId: paper.jobId,
      paperId: args.paperId,
      resultId,
      billingType: "extraction_llm",
      metadata: { questionKey: args.questionKey },
      allowPartial: true,
    },
  );
  await recordCreditSpend(ctx, {
    jobId: paper.jobId,
    key: now,
    id: resultId,
    creditsUsed: deducted,  // ← was args.creditsUsed
  });
}
```

If `deducted === 0` (wallet was already empty by the time this row commits), skip `recordCreditSpend` to avoid a zero-amount aggregator entry — it's not wrong, but it's noise.

### Site 2: `convex/extraction/mutations/papers.ts:232-260`

```ts
if (args.billing && !paper.indexingBilled && args.billing.creditsToDeduct > 0) {
  const now = Date.now();
  const { deducted } = await ctx.runMutation(
    internal.credits.internal.deductCredits,
    {
      userId: args.billing.userId,
      amount: args.billing.creditsToDeduct,
      description: "AI: Extraction embedding index",
      jobId: args.billing.jobId,
      paperId: args.paperId,
      billingType: "embedding",
      metadata: { embeddingTokens: String(args.billing.embeddingTokens) },
      allowPartial: true,
    },
  );
  if (deducted > 0) {
    await recordCreditSpend(ctx, {
      jobId: args.billing.jobId,
      key: now,
      id: `embed:${args.paperId}`,
      creditsUsed: deducted,
    });
  }
  updates.indexingBilled = true;  // flip even on partial — embedding completed, wallet just couldn't pay
}
```

### Site 3: `convex/wallet/gateway/handler.ts:270`

```ts
return async (usage, finishReason) => {
  const costDollars = calculateEnhancedModelCost(usage, walletModel);
  const credits = Math.max(1, creditsFromCost(costDollars, walletModel.costMarkup));

  await ctx.runMutation(internal.credits.internal.deductCredits, {
    userId: keyResult.userId,
    amount: credits,
    description: `Wallet API: ${walletModel.name}`,
    billingType: "wallet_api",
    allowPartial: true,
    metadata: { /* unchanged */ },
  });
  // No callers consume the return — the gateway response shape is OpenAI-compatible
  // and doesn't surface deducted. Drain-to-zero is purely a billing-hardening change here.
};
```

## TDD sequence

1. **R1**: in `convex/extraction/mutations/results.test.ts` (create if missing — there is one already per the test glob), seed user balance below `creditsUsed`, call the mutation, assert (a) the credits row drops to 0, (b) the creditsAgg B-tree mirror entry's `creditsUsed` equals the deducted amount, (c) `recordResult` runs to completion (no throw).
2. **G1**: migrate site 1.
3. **R2 + G2**: same shape for embedding site (site 2). Additionally assert `paper.indexingBilled === true` after the partial-deducted path.
4. **R3 + G3**: for site 3 (wallet gateway), gateway-level integration test seeds insufficient balance, runs the streaming completion handler, asserts no throw (the OpenAI response is sent), asserts the credits row drops to 0.

## Files touched

- `convex/extraction/mutations/results.ts` (lines 233-253)
- `convex/extraction/mutations/papers.ts` (lines 232-260)
- `convex/wallet/gateway/handler.ts` (lines 263-287, inside `makeDeductFn`)
- `convex/extraction/mutations/results.test.ts` (or new) — drain-to-zero coverage
- `convex/extraction/mutations/papers.test.ts` (or new) — drain-to-zero coverage
- `convex/wallet/gateway/gateway.test.ts` — drain-to-zero coverage at the handler level

## Migration stance

No-op on user-visible API; only billing semantics change. The `creditsAgg` B-tree mirror correction in plan 03 is the most subtle change — it ensures the per-job spend aggregate stays accurate when wallets exhaust mid-job.

## Test plan

- `npx vitest run convex/extraction convex/wallet` — green.
- `npx tsc --noEmit` — clean.

## Deployability gate

- `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!` after each of the three commits (one per site, atomic).
- No `✖ Error` lines.
- No `Module not found`.

## Acceptance criteria

- Site 1: `recordCreditSpend.creditsUsed` reflects `deducted`, not `args.creditsUsed`.
- Site 2: `recordCreditSpend.creditsUsed` reflects `deducted`. `indexingBilled = true` even on partial.
- Site 3: gateway never throws `INSUFFICIENT_CREDITS` mid-stream.
- Tests assert each site's drain-to-zero path produces (a) a single transaction row with `metadata.shortfall > 0`, (b) `credits.freeBalance + credits.paidBalance === 0` after the deduction, (c) all downstream side-effects still execute.

## Known pitfalls

- **`recordCreditSpend.creditsUsed` is the silent killer.** The aggregator B-tree is the cost-breakdown source-of-truth for per-job spend. Mirroring with `args.creditsUsed` on a partial deduction would inflate the aggregate by the shortfall — every spend dashboard and per-job cost report becomes wrong. Use `deducted`.
- **Skipping `recordCreditSpend` when `deducted === 0`** matters because the B-tree dedup is on (namespace, key+id), and a zero-amount entry still occupies a slot. Skip it.
- **`updates.indexingBilled = true` belongs OUTSIDE the `if (deducted > 0)` guard.** The embedding ran successfully; the wallet just couldn't pay. We don't want to retry the embedding because billing was partial.
- **Wallet gateway streaming finish-handler** is not in the same transaction as the OpenAI stream. A migration here is purely a hardening play — the gateway already consumes credits asynchronously after the response is sent.
- **`makeDeductFn` discards the return.** That's intentional. The OpenAI-compatible response has no field for `creditsRemaining`; downstream apps poll the wallet API for balance.
