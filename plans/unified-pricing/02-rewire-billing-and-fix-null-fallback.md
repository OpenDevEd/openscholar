# 02 — Rewire billing + fix null-price under-charge

## Goal

Cut over every USD-cost / credit-conversion site on the Convex side to the new `lib/pricing/` module. Delete the old file-private constants in the same commit that swaps the import. Then close the active billing leak: when a model's `pricing.web_search` is `null` and a `web_search` tool call fired, OpenRouter charges us via the Exa server tool (~$0.02/call) but our `convex/wallet/gateway/cost.ts:69-72` records `$0`. Fall back to `WEB_SEARCH_PRICING.openrouterServerTool.defaultUsdPerCall × webSearchRequests` so we capture the cost.

## Scope

**In:**
- `convex/chat/billing.ts:497-560` (`recordTavilyCost`) — replace the file-private `TAVILY_USD_PER_CREDIT = 0.008` with `WEB_SEARCH_PRICING.tavily.usdPerCredit`.
- `convex/ai/lib/creditBilling.ts:14-20` (`convertUsdCostToCredits`) — make it a thin re-export adapter pointing at `convertUsdToCredits` from the new module. Same signature; same behaviour. Live-billing test imports keep working.
- `convex/lib/creditTopups.ts:30-36` (`convertDollarsToCredits`) — same: thin adapter that calls into the new module's `convertUsdToCredits` (it lacks the markup multiplier, so it passes `markup: 1`).
- `convex/wallet/gateway/cost.ts:38-87` (`calculateEnhancedModelCost`) — replace the inline `usage.webSearchRequests * (model.webSearchPrice ?? 0)` with a call to `pickWebSearchPricing(...)` so the null-price path falls back to the server-tool rate. Note: this function returns USD; `creditsFromCost` at line 80 does the credit conversion. The fix is at the **USD layer**, not the credits layer.
- `convex/lib/constants.ts:11` — `AI_COST_MARKUP` becomes a re-export of `lib/pricing` constant. The file is a multi-purpose grab-bag (`ESTIMATED_CREDITS_PER_QUERY` etc. lives there too), so we keep the file but redirect the value to the single source-of-truth.
- `convex/wallet/gateway/gateway.test.ts` — extend with the null-price case (see § Test plan).
- Existing tests that reference `TAVILY_USD_PER_CREDIT`, `convertUsdCostToCredits`, `convertDollarsToCredits`, `AI_COST_MARKUP` — confirm none break (these are adapters; behaviour is unchanged for non-null callers).

**Out:**
- UI rewire (plan 03).
- The `convex/extraction/workpoolActions.ts:100` `DEFAULT_EXTRACTION_EMBEDDING_USD_PER_1M_TOKENS` constant — out of scope per § 00-README §12.
- Reconciling `AI_COST_MARKUP` (chat path) with per-model `costMarkup` (gateway path). They stay parallel mechanisms.

## Design

### Adapter shape — `convex/ai/lib/creditBilling.ts`

```ts
import { convertUsdToCredits, AI_COST_MARKUP } from "@/lib/pricing";
import { getCreditsPerUsd } from "../../lib/creditTopups";

/** Convert provider/model dollar cost into credit units.
 *  Adapter retained so existing imports (chat billing, batch deductions,
 *  ai/helpers) don't need touch-ups. New code should import directly from
 *  `@/lib/pricing`. */
export function convertUsdCostToCredits(
  costDollars: number,
  markupMultiplier = AI_COST_MARKUP,
): number {
  return convertUsdToCredits({
    usd: costDollars,
    markup: markupMultiplier,
    creditsPerUsd: getCreditsPerUsd(),
  });
}

// `calculateCreditsToDeductFromUsage` and `calculateRawCreditCost` keep
// their existing bodies; they only depend on `convertUsdCostToCredits`
// and `AI_COST_MARKUP`, which now resolve to the new module.
```

### Adapter shape — `convex/lib/creditTopups.ts:convertDollarsToCredits`

```ts
import { convertUsdToCredits } from "@/lib/pricing";

export function convertDollarsToCredits(
  dollars: number,
  creditsPerUsd = getCreditsPerUsd(),
): number {
  // No markup at this layer — caller has either pre-applied markup (chat
  // path via `convertUsdCostToCredits`) or is intentionally using the raw
  // rate (Tavily-credits path before this PR). Pass `markup: 1`.
  return convertUsdToCredits({ usd: dollars, markup: 1, creditsPerUsd });
}
```

### Re-export shape — `convex/lib/constants.ts`

```ts
// At the top of the file:
export { AI_COST_MARKUP } from "@/lib/pricing";
// (Delete the existing `export const AI_COST_MARKUP = 1.3;` line.)
```

### Tavily rewire — `convex/chat/billing.ts:497-560`

Delete the file-private `TAVILY_USD_PER_CREDIT` constant (line 515). The handler reads from the module:

```ts
// imports (top of file)
import { WEB_SEARCH_PRICING } from "@/lib/pricing";

// inside the handler (replacing line 542):
const usdCost = WEB_SEARCH_PRICING.tavily.usdPerCredit * tavilyCredits;
```

The doc comment at lines 506-507 stays accurate (1 basic credit = $0.008, advanced = 2 credits = $0.016) but is rewritten to **reference the module** as the source-of-truth so future maintainers update the right place.

### Gateway null-price fix — `convex/wallet/gateway/cost.ts:69-72`

The current code:

```ts
const webSearchCost =
  usage.webSearchRequests * (model.webSearchPrice ?? 0);
```

Replace with:

```ts
import { pickWebSearchPricing } from "@/lib/pricing";

// inside calculateEnhancedModelCost:
const webSearchPricing = pickWebSearchPricing({
  path: usage.webSearchRequests > 0 ? "openrouter" : null,
  modelWebSearchPriceUsd: model.webSearchPrice,
  // markup intentionally omitted here — `creditsFromCost` at line 80 (the
  // gateway's existing credit converter) applies per-model `costMarkup`
  // separately. This function returns USD, not credits.
});
const webSearchCost =
  usage.webSearchRequests *
  (webSearchPricing.usdPerCall ?? 0);
```

Note the path argument: `null` when `webSearchRequests === 0` (no web search this turn) so the selector returns `usdPerCall: null` and we charge zero, identical to the old behaviour. When `webSearchRequests > 0`, we pass `"openrouter"` and rely on the selector to pick native vs server-tool fallback based on `model.webSearchPrice`.

**Why not at the Tavily layer too?** The Tavily flow goes through `recordTavilyCost`, not `calculateEnhancedModelCost`. The gateway path is OpenRouter-only — Tavily searches don't hit this code path.

### `pickWebSearchPricing` for gateway — markup handling

The gateway path applies per-model `costMarkup` via `creditsFromCost(costDollars, walletModel.costMarkup)` at `handler.ts:267`. So `calculateEnhancedModelCost` returns a markup-FREE USD figure; the markup is applied once, at the credit-conversion step. We pass `markup: 1` is NOT correct here — we don't pass `markup` to the selector at all. The selector returns USD; the credit conversion happens later. The selector's `markup` field is only consulted when callers ask for `creditsPerCall`. Gateway code reads `usdPerCall` only.

### Static analysis after the rewire

Run a final grep — there should be **zero** matches for these literals outside `lib/pricing/`:

```
grep -rn "0\.008" --include="*.ts" convex/ lib/ components/ app/ messages/   # no hits
grep -rn "TAVILY_USD_PER_CREDIT" --include="*.ts" .                            # no hits
grep -rn "AI_COST_MARKUP\s*=\s*1\.3" --include="*.ts" .                        # no hits (only re-export)
grep -rn "DEFAULT_CREDITS_PER_USD\s*=\s*10_000" --include="*.ts" .             # no hits (only re-export)
```

Add this grep as a manual check to the acceptance criteria; do NOT codify it as a test (lint rule) — premature.

## TDD sequence

### Phase A — pure logic (commit per green)

No new pure logic in this plan; the new logic shipped in plan 01. The tests here are integration-shaped.

### Phase B — test-after, one commit per logical unit

**U1** — Tavily rewire. Edit `convex/chat/billing.ts` to delete `TAVILY_USD_PER_CREDIT` and import from `@/lib/pricing`. Run `npx vitest run convex/chat/billing.recordTavilyCost.test.ts`. Confirm pass (the test asserts on observable bill behaviour, not on the constant). Commit `refactor(billing): [plan-02] recordTavilyCost reads from lib/pricing`.

**U2** — `convex/ai/lib/creditBilling.ts:convertUsdCostToCredits` adapter. Edit body. Run the live-billing tests at `tests/live-billing/` AND `npx vitest run convex/ai/lib/creditBilling` (if a unit test exists; if not, the chat billing integration tests cover it). Confirm pass. Commit `refactor(billing): [plan-02] convertUsdCostToCredits adapter -> lib/pricing`.

**U3** — `convex/lib/creditTopups.ts:convertDollarsToCredits` adapter. Edit body. Run the credit-topup config test at `tests/credit-topup-config.test.ts`. Confirm pass. Commit `refactor(billing): [plan-02] convertDollarsToCredits adapter -> lib/pricing`.

**U4** — `convex/lib/constants.ts:AI_COST_MARKUP` re-export. Run the integration test at `tests/credit-calculation-integration.test.ts:16-21` which asserts the value is `1.3` and the rate is `10_000`. Confirm pass — the values match by construction. Commit `refactor(billing): [plan-02] AI_COST_MARKUP re-export from lib/pricing`.

**U5** — Gateway rewire + null-price fix. This is the load-bearing change. Sequence:

1. **R5a** — Extend `convex/wallet/gateway/gateway.test.ts` with a new test case: model with `webSearchPrice: undefined`, `webSearchRequests: 1`, `costMarkup: 2.0`. Expected: USD cost from web search alone = `0.02`; credits after markup = `ceil(0.02 × 2.0 × 10_000) = 400`. Confirm RED (current code computes USD = 0, credits from web search = 0). Commit `test(gateway): [plan-02] null webSearchPrice falls back to server-tool rate`.

2. **G5a** — Edit `convex/wallet/gateway/cost.ts` per the design above. Confirm RED test now passes AND the existing tests at `gateway.test.ts:2162` (`webSearchPrice: 0.025`) and `gateway.test.ts:2204` (`webSearchPrice: 0.025`) still pass — those exercise the native-price branch and should be unaffected. Commit `fix(gateway): [plan-02] charge OpenRouter server-tool rate when webSearchPrice is null`.

3. **U5b** — Update the `web_search_per_request` field in `handler.ts:474-475` to use the same selector. The current code is:
   ```ts
   web_search_per_request: m.webSearchPrice
     ? m.webSearchPrice * m.costMarkup
     : undefined,
   ```
   With the new selector this becomes:
   ```ts
   web_search_per_request:
     pickWebSearchPricing({
       path: "openrouter",
       modelWebSearchPriceUsd: m.webSearchPrice,
       markup: m.costMarkup,
       creditsPerUsd: 1, // we want USD here, not credits — see note
     }).usdPerCall ?? undefined,
   ```
   Wait — that's wrong. The existing line returns USD (in the OpenAI-models-list response shape it ships USD-per-request times markup, which is the **price the user pays in USD** if the wallet ever quotes in USD). For our `currency: "credits"` fixed at line 477 it's de-facto already pre-markup credits. Re-read the surrounding code in `handler.ts:438-486` carefully and decide whether to ship native USD × markup (today's behaviour) or credits-per-call. **DEFER this sub-step**: keep the existing line as-is in U5b and address it in a follow-up plan once we've eyeballed real wallet-API consumer expectations. Skip U5b. Commit nothing for this sub-step.

   *Deviation note:* if implementer finds the answer mid-execution (e.g., the wallet docs make it obvious), add U5b as a logical-unit commit with `refactor(gateway): [plan-02] handler reports web_search_per_request via pickWebSearchPricing` and update this plan via `docs: [plan-02] revise § Design — U5b clarified` per the deviation protocol in `CLAUDE.md`. Otherwise leave alone.

**U6** — Final grep audit. From the repo root, run the four greps in § Static analysis after the rewire. Manually confirm zero hits. Document the audit in the commit body of the next commit (no code change in this step itself).

## Files touched

- `convex/chat/billing.ts` — delete file-private const, swap import (~5 LOC change).
- `convex/ai/lib/creditBilling.ts` — body of `convertUsdCostToCredits` becomes a 1-line delegation (~5 LOC change).
- `convex/lib/creditTopups.ts` — body of `convertDollarsToCredits` becomes a 1-line delegation (~5 LOC change).
- `convex/lib/constants.ts` — `AI_COST_MARKUP` becomes a re-export (~2 LOC change).
- `convex/wallet/gateway/cost.ts` — web-search USD computation now goes through `pickWebSearchPricing` (~10 LOC change).
- `convex/wallet/gateway/gateway.test.ts` — new test case for null-price fallback (~40 LOC addition).

## Migration stance

**Destructive at the constant level.** `TAVILY_USD_PER_CREDIT` is deleted. The two `AI_COST_MARKUP` and `DEFAULT_CREDITS_PER_USD` original `export const` statements are deleted. Their replacements are re-exports from `@/lib/pricing`. No deprecation comments. No `@deprecated` jsdoc. Importers that referenced them by name keep working because the re-export preserves the symbol.

The dev DB is not touched. Per-model `costMarkup` rows on `models` are untouched. No `@convex-dev/migrations` script.

## Test plan

- `npx vitest run convex/chat/billing.recordTavilyCost.test.ts` — passes after U1.
- `npx vitest run convex/wallet/gateway/gateway.test.ts` — existing cases pass after U5; new null-price case is RED before G5a, GREEN after G5a.
- `npx vitest run tests/credit-calculation-integration.test.ts` — passes after U4 (tests assert `AI_COST_MARKUP === 1.3` and `DEFAULT_CREDITS_PER_USD === 10_000`; both hold).
- `npx vitest run tests/live-billing/` — passes after U2 / U3.
- `npx vitest run tests/credit-topup-config.test.ts` — passes after U3.
- `npx tsc --noEmit` — clean after every commit.
- Full `npx vitest run` — no regressions anywhere.
- Manual smoke: send a chat turn with web search enabled to a model that has `pricing.web_search: null` (any current OpenAI top-tier model — verify against `https://openrouter.ai/api/v1/models` first). Observe the credits-deducted line on the resulting `creditTransactions` row matches `ceil(0.02 × model.costMarkup × creditsPerUsd)` × `webSearchRequests`.

## Deployability gate

This plan touches `convex/` heavily. Run after **every** commit:

```
npx pm2 logs convex --lines 5 --nostream
```

Expected: most recent line is `✔ Convex functions ready!` (no `✖ Error`, no stuck `- Preparing Convex functions...`).

Specifically watch for:
- **File-naming**: this plan adds no new convex files; only edits existing ones. No risk.
- **Stale `returns` validators**: this plan does not change any `returns` shape. The Tavily mutation's returned `{ billedCredits }` shape is unchanged.
- **Args validator changes**: none.

If pm2 wedges, **stop**. Do not commit further on top of a broken push. Diagnose and either revert the offending commit or push a fix commit before continuing.

## Acceptance criteria

- [ ] `convex/chat/billing.ts` no longer declares `TAVILY_USD_PER_CREDIT`; reads `WEB_SEARCH_PRICING.tavily.usdPerCredit` from `@/lib/pricing`.
- [ ] `convex/ai/lib/creditBilling.ts:convertUsdCostToCredits` is a 1-line delegation to `convertUsdToCredits` from `@/lib/pricing`.
- [ ] `convex/lib/creditTopups.ts:convertDollarsToCredits` is a 1-line delegation to `convertUsdToCredits` from `@/lib/pricing` (with `markup: 1`).
- [ ] `convex/lib/constants.ts:AI_COST_MARKUP` is a re-export from `@/lib/pricing` (no local `= 1.3`).
- [ ] `convex/wallet/gateway/cost.ts:calculateEnhancedModelCost` uses `pickWebSearchPricing` for the web-search USD line; null `model.webSearchPrice` falls back to `0.02 × webSearchRequests`.
- [ ] New test case at `convex/wallet/gateway/gateway.test.ts` covers the null-price fallback and bills the expected credits after per-model markup.
- [ ] All four post-rewire greps return ZERO hits outside `lib/pricing/` and (legitimately) `lib/pricing/`'s own `.test.ts` fixtures.
- [ ] `npx tsc --noEmit` clean.
- [ ] Full `npx vitest run` passes (no regressions).
- [ ] `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!` after the final commit.
- [ ] Manual smoke test (above) shows the gateway captures cost on a null-price model.

## Known pitfalls

- **Adapter signatures must not drift.** `convertUsdCostToCredits(costDollars, markupMultiplier?)` is the existing call shape used in 4+ places (chat billing, batch deductions, helpers). Keep it identical. Same for `convertDollarsToCredits(dollars, creditsPerUsd?)`.
- **Don't pass `markup` to `pickWebSearchPricing` from the gateway USD branch.** The selector multiplies markup into `creditsPerCall`, but the gateway only consumes `usdPerCall`. Markup is applied once, by the gateway's existing `creditsFromCost(costDollars, walletModel.costMarkup)` step at `handler.ts:267`. Passing markup twice = double-charge.
- **Watch for circular imports.** `lib/pricing/` imports nothing from Convex. Convex imports from `lib/pricing/` via the project's TS path alias. If your tsconfig/baseUrl can't resolve `@/lib/pricing` from inside `convex/`, the build will fail with a misleading "module not found"; check `tsconfig.json` paths first. (The existing `lib/chat/web-search-capability.ts` is imported from `convex/chat/messages.ts` already, so the alias works.)
- **The `0` vs `null` model price**: `model.webSearchPrice === 0` is treated as "no native price, fall back" by the selector. If a real model ever sets `0` to mean "free", that's a Convex-side data error, not a code bug — `0` is operationally indistinguishable from "missing" for billing. Document this in the commit body and don't try to "fix" it.
- **Existing test fixtures with stale prices** (`gateway.test.ts:2162` uses `webSearchPrice: 0.025`, which doesn't appear in the live OpenRouter catalog as of 2026-04-29). Don't fix the fixtures in this plan — they exercise the native-price branch correctly with whatever number is set; updating fixtures to match live values is an unrelated cleanup.
- **The `usage.webSearchRequests` field is set externally** (per `cost.ts:34`'s comment "Set externally from source event count"). Don't try to derive it inside `calculateEnhancedModelCost`; it arrives pre-counted from the gateway's request handler. Just consume it.
- **`getCreditsPerUsd()` is a function, not a constant.** The adapter at `convex/ai/lib/creditBilling.ts` calls it inline so the env override `CREDITS_PER_USD=125` continues to work. Don't pass `DEFAULT_CREDITS_PER_USD` directly — that bypasses the env override.
- **`@/lib/pricing` import path**: confirm the project's tsconfig path alias before writing imports. The existing pattern in `convex/chat/messages.ts:47` (`import { buildTavilyWebSearchTool } from "./tools/tavilyWebSearch";`) is relative; check whether `@/lib/...` works from `convex/` (it should, given Next.js root tsconfig, but verify against an existing convex-side `@/lib/...` import). Worst case use a relative path `../../../lib/pricing`.
