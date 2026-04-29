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
   *  OpenRouter sync at `convex/models/sync.ts` populates it from the
   *  provider's `pricing.web_search`. `null`/`undefined`/`0` means the
   *  model has NO native web search and OpenRouter will fall back to the
   *  Exa server tool — we charge `defaultUsdPerCall` in that case. */
  modelWebSearchPriceUsd?: number | null;
  /** Optional override for OpenRouter `maxResults`. When provided AND the
   *  path is the server-tool fallback, the per-call price is recomputed
   *  as `maxResults × usdPerResult`. Native web-search prices are flat,
   *  so this is ignored on that branch. */
  maxResults?: number;
  /** Markup to apply when computing the credits estimate. Defaults to the
   *  global `AI_COST_MARKUP`. The wallet gateway path can pass per-model
   *  `costMarkup` here. */
  markup?: number;
  /** Credits-per-USD override; defaults to `DEFAULT_CREDITS_PER_USD`. */
  creditsPerUsd?: number;
}

export interface WebSearchPricing {
  /** Estimated USD cost of one search call on this path/model. `null` when
   *  the path itself is `null` (toggle off / model unsupported). */
  usdPerCall: number | null;
  /** Estimated credits that would be deducted for one such call after
   *  markup + creditsPerUsd. `null` mirrors `usdPerCall === null`. */
  creditsPerCall: number | null;
  /** Stable string for analytics / telemetry. */
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
