# 01 — Pricing module (`lib/pricing/`)

## Goal

Stand up a single, framework-agnostic source-of-truth module that owns every USD-cost / credit-conversion / markup / web-search-pricing constant the codebase consumes. Pure-logic TDD, full unit coverage, no callers rewired in this plan — the module ships standalone so plans 02 (billing rewire + null-price fix) and 03 (UI rewire + i18n) can each consume a stable surface in parallel.

## Scope

**In:**
- New directory `lib/pricing/` with four files: `constants.ts`, `convert.ts`, `web-search.ts`, `index.ts` (barrel).
- New tests `lib/pricing/convert.test.ts`, `lib/pricing/web-search.test.ts`.
- Re-export of `WebSearchPath` from the module, with `convex/chat/tools/selectWebSearchTool.ts` updated to import from there. The body of `selectWebSearchTool.ts` stays where it is (it's Convex-server logic with the env read at the call site); only the type import moves.

**Out:**
- Rewiring billing (plan 02).
- Rewiring UI / i18n (plan 03).
- Deleting `convex/chat/billing.ts:TAVILY_USD_PER_CREDIT` and `components/ai-elements/tool-step.tsx:SEARCH_COST_DEFAULTS` — those happen in their respective rewire plans, in the same commit that swaps the import.
- Touching `convex/lib/constants.ts:AI_COST_MARKUP` (also plan 02 — rewires happen there).

## Design

### `lib/pricing/constants.ts`

```ts
/** 30% margin applied on raw provider USD cost when converting to credits.
 *  Single source of truth for the global markup. The wallet gateway path
 *  uses a per-model `costMarkup` column instead — see § 00-README §10. */
export const AI_COST_MARKUP = 1.3;

/** Default credit/USD exchange rate. Live runtime reads
 *  `process.env.CREDITS_PER_USD` via `getCreditsPerUsd()` (Convex side).
 *  This is the build-time fallback used by `convertUsdToCredits` when
 *  no explicit rate is provided. */
export const DEFAULT_CREDITS_PER_USD = 10_000;
```

### `lib/pricing/convert.ts`

```ts
import { AI_COST_MARKUP, DEFAULT_CREDITS_PER_USD } from "./constants";

/** Convert a USD cost into integer credits.
 *
 *   credits = max(1, ceil( usd × markup × creditsPerUsd ))
 *
 *  - Returns 0 when `usd <= 0` (no charge for free calls).
 *  - Returns 1 when the math rounds below 1 but the call wasn't free
 *    (i.e. floor under 1¢ still bills 1 credit; "any non-zero usage costs
 *    something" — matches the legacy Convex helper).
 *  - `markup` defaults to `AI_COST_MARKUP`. The wallet gateway path passes
 *    its per-model `costMarkup` here instead.
 *  - `creditsPerUsd` defaults to `DEFAULT_CREDITS_PER_USD`. Convex callers
 *    pass `getCreditsPerUsd()` to honour the runtime env override.
 *  - The intermediate product is rounded to `1e-8` precision BEFORE ceiling
 *    so JS floating-point noise (e.g. `0.008 × 1.3 = 0.010400000000000001`)
 *    does not silently overcharge by 1 credit on what should be exact
 *    integer-credit values. The naive legacy `Math.ceil(...)` path returned
 *    105 instead of 104 for `usd = 0.008`; this implementation returns 104.
 *    Real fractional values above an integer (e.g. 13.0001) still ceil up.
 */
export function convertUsdToCredits(args: {
  usd: number;
  markup?: number;
  creditsPerUsd?: number;
}): number {
  const { usd } = args;
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  const markup = args.markup ?? AI_COST_MARKUP;
  const creditsPerUsd = args.creditsPerUsd ?? DEFAULT_CREDITS_PER_USD;
  // Round to 8 decimal places to drop FP noise from float×float×float; any
  // truly fractional credit value (≥ 1e-8 above an integer) still ceils up.
  const raw = Math.round(usd * markup * creditsPerUsd * 1e8) / 1e8;
  return Math.max(1, Math.ceil(raw));
}
```

### `lib/pricing/web-search.ts`

```ts
import { convertUsdToCredits } from "./convert";

/** Which backend will service the next web-search call. `null` means the
 *  toggle is off OR the active model lacks web-search capability. */
export type WebSearchPath = "tavily" | "openrouter" | null;

/** Per-provider rate card. All values in USD. */
export const WEB_SEARCH_PRICING = {
  tavily: {
    /** Tavily basic search = 1 credit; advanced = 2 credits. We multiply
     *  by `usage.creditsUsed` from the API response, so this is a flat
     *  per-credit rate, NOT per-call. PAYG rate; subscription tiers run
     *  $0.005–$0.0075/credit but $0.008 is a safe upper bound. Verified
     *  Apr 29 2026 against docs.tavily.com/documentation/api-credits. */
    usdPerCredit: 0.008,
  },
  openrouterServerTool: {
    /** Cost when OpenRouter falls back to the Exa/Parallel server tool
     *  for a model with no native web search. Verified Apr 29 2026
     *  against openrouter.ai/docs/guides/features/server-tools/web-search. */
    usdPerResult: 0.004,
    defaultMaxResults: 5,
    /** Convenience: 5 × $0.004. Use this when the call site doesn't know
     *  the actual `maxResults` configured on the tool factory. */
    defaultUsdPerCall: 0.02,
  },
} as const;

/** Inputs that determine the call's pricing. Only the path is required;
 *  for `"openrouter"` callers should also pass the model row so we can
 *  pick between native (`pricing.web_search`) and the server-tool fallback. */
export interface PickWebSearchPricingArgs {
  path: WebSearchPath;
  /** Set when path is `"openrouter"`. Comes from the `models` table; the
 *   OpenRouter sync at `convex/models/sync.ts:117` populates it from the
 *   provider's `pricing.web_search`. `null`/`undefined` means the model
 *   has NO native web search and OpenRouter will fall back to the Exa
 *   server tool — we charge `defaultUsdPerCall` in that case. */
  modelWebSearchPriceUsd?: number | null;
  /** Optional override for OpenRouter `maxResults`. When provided AND the
 *   path is the server-tool fallback, the per-call price is recomputed
 *   as `maxResults × usdPerResult`. Native web-search prices are flat,
 *   so this is ignored on that branch. */
  maxResults?: number;
  /** Markup to apply when computing the credits estimate. Defaults to the
 *   global `AI_COST_MARKUP`. The wallet gateway path can pass per-model
 *   `costMarkup` here. */
  markup?: number;
  /** Credits-per-USD override; defaults to `DEFAULT_CREDITS_PER_USD`. */
  creditsPerUsd?: number;
}

export interface WebSearchPricing {
  /** Estimated USD cost of one search call on this path/model. `null` when
 *   the path itself is `null` (toggle off / model unsupported). */
  usdPerCall: number | null;
  /** Estimated credits that would be deducted for one such call after
 *   markup + creditsPerUsd. `null` mirrors `usdPerCall === null`. */
  creditsPerCall: number | null;
  /** Stable string for analytics / telemetry. One of
 *   `"tavily-basic"`, `"openrouter-native"`, `"openrouter-server-tool"`,
 *   or `"unsupported"`. */
  source:
    | "tavily-basic"
    | "openrouter-native"
    | "openrouter-server-tool"
    | "unsupported";
}

/** Single selector consumed by BOTH server-side billing AND the UI tooltip. */
export function pickWebSearchPricing(
  args: PickWebSearchPricingArgs,
): WebSearchPricing {
  if (args.path === null) {
    return { usdPerCall: null, creditsPerCall: null, source: "unsupported" };
  }

  if (args.path === "tavily") {
    // Display estimate: assume basic depth (1 credit). The actual bill is
    // driven by `usage.creditsUsed` × `usdPerCredit` at call time, so this
    // matches the cheap branch of the bill the user is most likely to see.
    const usd = WEB_SEARCH_PRICING.tavily.usdPerCredit;
    return {
      usdPerCall: usd,
      creditsPerCall: convertUsdToCredits({
        usd,
        markup: args.markup,
        creditsPerUsd: args.creditsPerUsd,
      }),
      source: "tavily-basic",
    };
  }

  // path === "openrouter"
  const native = args.modelWebSearchPriceUsd;
  if (native != null && Number.isFinite(native) && native > 0) {
    return {
      usdPerCall: native,
      creditsPerCall: convertUsdToCredits({
        usd: native,
        markup: args.markup,
        creditsPerUsd: args.creditsPerUsd,
      }),
      source: "openrouter-native",
    };
  }

  // Server-tool fallback (model has no native web search).
  const maxResults =
    args.maxResults ?? WEB_SEARCH_PRICING.openrouterServerTool.defaultMaxResults;
  const usd =
    maxResults * WEB_SEARCH_PRICING.openrouterServerTool.usdPerResult;
  return {
    usdPerCall: usd,
    creditsPerCall: convertUsdToCredits({
      usd,
      markup: args.markup,
      creditsPerUsd: args.creditsPerUsd,
    }),
    source: "openrouter-server-tool",
  };
}
```

### `lib/pricing/index.ts`

Barrel — re-exports every public symbol so callers can `import { ... } from "@/lib/pricing"`.

## TDD sequence

### Phase A — pure logic (commit per green)

**R1** — `lib/pricing/convert.test.ts`:
- `usd = 0` → returns `0`.
- `usd < 0` → returns `0`.
- `usd = NaN` → returns `0`.
- `usd = 0.008, markup default, rate default` → returns `104` (Tavily basic).
- `usd = 0.016, markup default, rate default` → returns `208` (Tavily advanced).
- `usd = 0.02, markup default, rate default` → returns `260` (OpenRouter server-tool default).
- `usd = 0.005, markup default, rate default` → returns `65` (Perplexity Sonar).
- `usd = 0.01, markup default, rate default` → returns `130` (Sonnet 4 native).
- `usd = 0.0001, markup default, rate default` → returns `2` (`ceil(0.0001 × 13_000) = ceil(1.3) = 2`) — verifies `ceil` not `floor`.
- `usd = 0.000001, markup default, rate default` → returns `1` (sub-cent floor: `ceil(0.013) = 1`) — verifies the `Math.max(1, ...)` clamp.
- `usd = 0.01, markup = 2.0, rate default` → returns `200` (verifies markup override).
- `usd = 0.01, markup default, rate = 1_000` → returns `13` (verifies rate override).

Watch fail. Commit `test(pricing): [plan-01] convertUsdToCredits cases`.

**G1** — implement `lib/pricing/convert.ts` and `lib/pricing/constants.ts`. Watch pass. Commit `feat(pricing): [plan-01] convertUsdToCredits + constants`.

**R2** — `lib/pricing/web-search.test.ts`:
- `path: null` → `{ usdPerCall: null, creditsPerCall: null, source: "unsupported" }`.
- `path: "tavily"` → `{ usdPerCall: 0.008, creditsPerCall: 104, source: "tavily-basic" }`.
- `path: "openrouter", modelWebSearchPriceUsd: 0.01` → `{ usdPerCall: 0.01, creditsPerCall: 130, source: "openrouter-native" }`.
- `path: "openrouter", modelWebSearchPriceUsd: 0.014` → `{ usdPerCall: 0.014, creditsPerCall: 182, source: "openrouter-native" }` (Gemini 2.5 Pro).
- `path: "openrouter", modelWebSearchPriceUsd: undefined` → `{ usdPerCall: 0.02, creditsPerCall: 260, source: "openrouter-server-tool" }`.
- `path: "openrouter", modelWebSearchPriceUsd: null` → `{ usdPerCall: 0.02, creditsPerCall: 260, source: "openrouter-server-tool" }` (the actual gateway nullable case).
- `path: "openrouter", modelWebSearchPriceUsd: 0` → server-tool fallback (zero is treated as "no native price", not "free native"); usdPerCall: 0.02, creditsPerCall: 260.
- `path: "openrouter", modelWebSearchPriceUsd: undefined, maxResults: 10` → `{ usdPerCall: 0.04, creditsPerCall: 520 }` (server-tool with override).
- `path: "openrouter", modelWebSearchPriceUsd: 0.01, maxResults: 10` → native rate ignores `maxResults` (still 0.01 / 130).
- `path: "tavily", markup: 2.0` → `{ usdPerCall: 0.008, creditsPerCall: 160 }` (verifies markup propagates through selector).
- `path: "tavily", creditsPerUsd: 1_000` → `{ creditsPerCall: 11 }` (`ceil(0.008 × 1.3 × 1000) = 11`) verifies rate propagates.

Watch fail. Commit `test(pricing): [plan-01] pickWebSearchPricing cases`.

**G2** — implement `lib/pricing/web-search.ts`. Watch pass. Commit `feat(pricing): [plan-01] pickWebSearchPricing selector`.

**G3** — `lib/pricing/index.ts` barrel. No new test (just exports). Run the full test suite to confirm nothing broke. Commit `feat(pricing): [plan-01] barrel export`.

### Phase B — type-import migration (one logical unit)

**U1** — Move `WebSearchPath` definition from `convex/chat/tools/selectWebSearchTool.ts:12` into `lib/pricing/web-search.ts`; update `selectWebSearchTool.ts` to `import type { WebSearchPath } from "@/lib/pricing"`. Keep the `pickWebSearchTool` function body where it is — it stays Convex-server-only because it reads env at the call site. Run `tsc --noEmit` and the existing `selectWebSearchTool.test.ts` to confirm no regression. Commit `refactor(pricing): [plan-01] hoist WebSearchPath into lib/pricing`.

## Files touched

- `lib/pricing/constants.ts` (new, ~12 LOC)
- `lib/pricing/convert.ts` (new, ~25 LOC)
- `lib/pricing/web-search.ts` (new, ~80 LOC)
- `lib/pricing/index.ts` (new, ~5 LOC barrel)
- `lib/pricing/convert.test.ts` (new, ~70 LOC)
- `lib/pricing/web-search.test.ts` (new, ~120 LOC)
- `convex/chat/tools/selectWebSearchTool.ts` (modify import only — the type moves out, the function stays)

## Migration stance

**None.** This plan is purely additive: new `lib/pricing/` files plus one type-import migration. Plans 02 and 03 perform the destructive deletions of the old constants. The dev DB is not touched.

## Test plan

- `npx vitest run lib/pricing/` — all new tests pass.
- `npx vitest run convex/chat/tools/selectWebSearchTool.test.ts` — existing test unchanged after the type-import migration; passes.
- `npx tsc --noEmit` — clean.
- Full project test run — nothing else regresses.

## Deployability gate

This plan does NOT touch `convex/`, `app/`, or `components/` runtime trees in a way pm2 cares about — only one `convex/chat/tools/selectWebSearchTool.ts` import statement is rewritten, which is a pure type-only change. Still, run the gate after the U1 commit since it touches `convex/`:

- After the U1 commit: `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!` (no `✖ Error`, no stuck "Preparing Convex functions...").

If the convex push wedges, stop and investigate before continuing — see § Deployability is mandatory in `CLAUDE.md`.

## Acceptance criteria

- [ ] `lib/pricing/{constants,convert,web-search,index}.ts` exist with the API above.
- [ ] `lib/pricing/convert.test.ts` covers all 12 `convertUsdToCredits` cases above and passes.
- [ ] `lib/pricing/web-search.test.ts` covers all 11 `pickWebSearchPricing` cases above and passes.
- [ ] `WebSearchPath` is defined in `lib/pricing/web-search.ts` and re-exported from the barrel.
- [ ] `convex/chat/tools/selectWebSearchTool.ts` imports `WebSearchPath` from `@/lib/pricing` (or whatever the project's TS path alias resolves to).
- [ ] `npx tsc --noEmit` clean. All new and existing tests pass.
- [ ] `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!` after the U1 commit.

## Known pitfalls

- **Floating-point intermediate rounding (deviation, 2026-04-29):** `usd × markup × creditsPerUsd` evaluated naively in JS produces values like `0.008 × 1.3 × 10000 = 104.00000000000001`, which `Math.ceil` rounds to **105** — silently overcharging by 1 credit on otherwise-exact rates. The legacy `convex/ai/lib/creditBilling.ts:convertUsdCostToCredits` has this bug (it billed 105 credits for a $0.008 Tavily basic search). The new implementation rounds the intermediate product to 8 decimal places (`Math.round(raw × 1e8) / 1e8`) BEFORE ceiling, so integer-credit values stay integer. Genuinely fractional values (e.g. `0.0001 × 1.3 × 10000 = 1.3`) still ceil up correctly. This is a behavior change vs the legacy Convex helper; plan 02 inherits the corrected behavior when the legacy becomes a re-export.
- **Do NOT** make `lib/pricing/` import anything from `convex/`. The module must be framework-agnostic so React components and Convex actions can both consume it. The `getCreditsPerUsd()` env reader stays in `convex/lib/creditTopups.ts`; Convex callers pass it as the optional `creditsPerUsd` argument. UI callers omit the argument and inherit `DEFAULT_CREDITS_PER_USD`.
- **Do NOT** add a `formatCreditsLabel(...)` helper here. `lib/chat/format-search-cost.ts` already exists and is the right home for label formatting; plan 03 rewires it.
- **Do NOT** unify `AI_COST_MARKUP` (global) with the per-model `costMarkup` column on `models`. They are two parallel mechanisms and that unification is out of scope (§ 00-README §10). The `markup` arg on `convertUsdToCredits` and `pickWebSearchPricing` is the seam — gateway code passes per-model markup; chat code passes the default.
- **Do NOT** re-export `WEB_SEARCH_PRICING` mutably. The `as const` annotation is mandatory; consumers must not be able to reassign `WEB_SEARCH_PRICING.tavily.usdPerCredit = ...` at runtime.
- **Tavily basic vs advanced**: do not branch on `searchDepth` in the selector. The Tavily API itself returns `usage.creditsUsed = 1 | 2`; the call-site (`recordTavilyCost` in plan 02) multiplies by `usdPerCredit` after the fact. The selector's `usdPerCall` for the Tavily path is the **basic** estimate (1 credit) — this matches the conservative tooltip behaviour the user asked for and matches the cheaper, more common case.
- **Server-tool zero-vs-null**: `modelWebSearchPriceUsd === 0` is treated identically to `null`/`undefined` — no native price, fall back to server tool. Verify the test covers this; an LLM might "improve" the code to bill nothing on `0` and break the gateway.
- **Type-only import for `WebSearchPath`** in `selectWebSearchTool.ts` — use `import type` to avoid a runtime barrel dep on framework-agnostic code from a Convex module. (`tsc` will reject value-imports of types from Convex builds in some configs.)
