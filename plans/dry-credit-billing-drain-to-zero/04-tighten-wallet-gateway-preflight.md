# Plan 04 — Tighten wallet gateway pre-flight

## Goal

Replace the `balance.total <= 0` pre-flight check at `convex/wallet/gateway/handler.ts:134` with a real cost estimate, so a user with 1 credit can't trigger a multi-thousand-credit wallet API call.

## Scope

- `convex/lib/constants.ts` — add `ESTIMATED_CREDITS_PER_WALLET_API_CALL`.
- `convex/wallet/gateway/handler.ts` — replace the pre-flight gate with an estimate-based check.

## Design

### New constant in `convex/lib/constants.ts`

```ts
/**
 * Estimated credit cost for a single wallet OpenAI-compatible gateway call
 * (chat-completion shape, default 1k input + ~500 output token estimate
 * at typical OpenRouter served-model rates). Used as the pre-flight floor
 * in `convex/wallet/gateway/handler.ts` so a user with near-zero balance
 * cannot trigger an LLM call that can't be paid for. Plan-04 in
 * `plans/dry-credit-billing-drain-to-zero/`.
 */
export const ESTIMATED_CREDITS_PER_WALLET_API_CALL = 200;
```

Sits next to `ESTIMATED_CREDITS_PER_CHAT_MESSAGE` (line 36).

### Gate update in `convex/wallet/gateway/handler.ts`

After step 6 (model resolved at line 162), but BEFORE step 7 (provider model build):

```ts
import {
  ESTIMATED_CREDITS_PER_WALLET_API_CALL,
  ESTIMATED_CREDITS_PER_WEB_SEARCH,
} from "../../lib/constants";

// step 4 (replaces existing balance check)
const balance = await ctx.runQuery(
  internal.credits.internal.getBalanceByUserId,
  { userId: keyResult.userId },
);
const requiredCredits =
  ESTIMATED_CREDITS_PER_WALLET_API_CALL +
  (req.web_search_options ? ESTIMATED_CREDITS_PER_WEB_SEARCH : 0);
if (!balance || balance.total < requiredCredits) {
  return openAIError(
    `Insufficient credits — need at least ${requiredCredits}, have ${balance?.total ?? 0}.`,
    "insufficient_quota",
    402,
    allowedOrigin,
  );
}
```

The `req.web_search_options` is parsed in step 5; this means the new check belongs AFTER step 5 (request parsed), not in step 4 position. Reorder: balance check moves to between step 5 (parse) and step 6 (model resolve).

## TDD sequence

1. **R1**: in `convex/wallet/gateway/gateway.test.ts`, add a test seeding the user to `balance.total = 50` (above 0, below 200), POST a non-web-search completion, assert 402 with body matching `Insufficient credits — need at least 200`. Run — fails (currently allows through because 50 > 0).
2. **G1**: add the constant; replace the gate with `< ESTIMATED_CREDITS_PER_WALLET_API_CALL`. Re-run — passes.
3. **R2 + G2**: same test shape but with `web_search_options` set and `balance.total = 600` (above 200, below 700). Assert 402 with `need at least 700`. Implement web-search add-on.

## Files touched

- `convex/lib/constants.ts` (add constant + comment)
- `convex/wallet/gateway/handler.ts` (replace step-4 gate, reorder relative to step-5 parse)
- `convex/wallet/gateway/gateway.test.ts` (two new test cases)

## Migration stance

Tightening — users at 1-199 credits go from "request goes through, fails mid-stream with hopefully-drained billing" to "request gets a clean 402 with required-credits message". No widen-then-narrow; this is the correct behavior from day one.

## Test plan

- `npx vitest run convex/wallet/gateway/gateway.test.ts` — all green including the two new tests.
- `npx tsc --noEmit` — clean.

## Deployability gate

- `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!` after the commit. (If pm2 idle: `npx convex dev --once`.)
- `npx pm2 logs next --lines 5 --nostream` — no impact, no Next.js code touched.

## Acceptance criteria

- New constant `ESTIMATED_CREDITS_PER_WALLET_API_CALL = 200` in `convex/lib/constants.ts`.
- `convex/wallet/gateway/handler.ts` step 4 uses `balance.total < requiredCredits` where `requiredCredits` includes optional web-search add-on.
- Tests confirm 402 at 50 credits without web search and at 600 credits with web search.
- 402 body contains the actual required-credits number for diagnostic clarity.

## Known pitfalls

- **Reorder of step 4 vs step 5.** The old gate runs BEFORE request parsing (step 5). The new gate needs `req.web_search_options`, which is only available AFTER parsing. Move the balance check to between step 5 and step 6.
- **OpenAI-compatible error shape.** `openAIError("Insufficient credits", "insufficient_quota", 402, allowedOrigin)` has a fixed contract — including model-side error codes. Don't change `error.type` from `insufficient_quota`; downstream apps key off it.
- **No drain-to-zero needed here for the gate** — the pre-flight is the gate; the drain-to-zero (plan 03 site 3) handles in-flight overruns once a request is past the gate.
- **`web_search_options` is a request flag** — its mere presence (non-undefined) is the trigger, not a particular value. Use `Boolean(req.web_search_options)` in the boolean expression.
