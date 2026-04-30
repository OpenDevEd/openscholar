# Unified Pricing — Plan Set

Consolidate every USD-cost / credit-conversion / markup constant the codebase carries into a single source-of-truth module. Every consumer — billing mutations, gateway pricing replies, UI tooltips, tool-step chips, preflight estimators, i18n strings, tests — imports from there. Side benefit: it gives us a clean home for two pieces of new pricing data this work surfaces (Tavily basic vs advanced; OpenRouter server-tool fallback when `model.webSearchPrice` is null) and lets the chat tooltip show the **real** credit cost of the path that will actually run instead of the static "$0.02" placeholder.

## 1. Motivation / gap audit

The cost story is currently scattered. Adding a new constant or fixing a price drift requires editing 6+ files in 4+ trees. The code worked when the only "price" was a per-1M-token model rate, but web-search billing has multiplied the surfaces:

**Existing scatter (verified by grep on 2026-04-29):**

| Constant | Value | Location | Used by |
|---|---|---|---|
| `AI_COST_MARKUP` | `1.3` | `convex/lib/constants.ts:11` | chat billing (`creditBilling.ts:16`), batch deductions, helpers |
| Per-model `costMarkup` | DB column, number per row | `convex/schema.ts:63` | wallet gateway path (`handler.ts:267,463-475`) — **a parallel markup mechanism the chat path does not use** |
| `DEFAULT_CREDITS_PER_USD` | `10_000` | `convex/lib/creditTopups.ts:2` | `convertDollarsToCredits`, live-billing test support |
| `TAVILY_USD_PER_CREDIT` | `0.008` | `convex/chat/billing.ts:515` (file-private) | `recordTavilyCost` mutation only |
| `DEFAULT_EXTRACTION_EMBEDDING_USD_PER_1M_TOKENS` | `0.02` | `convex/extraction/workpoolActions.ts:100` (file-private) | embedding cost, env-overridable |
| `SEARCH_COST_DEFAULTS` | `{ creditsPerSearchEstimate: 3, costUsdEstimate: 0.02 }` | `components/ai-elements/tool-step.tsx:9-12` | tool-step UI placeholder during `input-available` |
| Hardcoded "(~$0.02 per search)" | string | `messages/en-US.json:1031`, `en-GB.json:1028`, `ja.json:1005`, `zh.json:1005`, `fr.json:1005`, `hi.json:1005` | composer toggle tooltip |
| Hardcoded `0.02` | string format | `lib/chat/format-search-cost.ts:12` (uses `costUsdEstimate.toFixed(2)`) | `formatSearchCostLabel` |
| `EXTRACTION_COST_CONSTANTS` | per-paper/question floors | `lib/extraction/cost-estimate.ts:34` | preflight + retry/resume estimators |

**Two real defects this scatter has hidden:**

1. **The composer tooltip lies in 5 of 7 cases.** "$0.02 per search" is roughly right only for the OpenRouter server-tool default path ($0.02 = 5 results × $0.004). For Tavily-basic users ($0.008 → 104 credits), it's overstating cost by ~2.5×. For native Perplexity / Grok ($0.005 → 65 credits) it's overstating ~3×. For GPT-4o-search-preview ($0.035 → 455 credits) it's understating by ~3×. The tooltip is fixed text, never sees the active path.
2. **`convex/wallet/gateway/cost.ts:69-72` under-bills when `model.webSearchPrice` is null.** Many top OpenRouter models — e.g. `openai/gpt-5` per the live `/api/v1/models` catalog fetched 2026-04-29 — have **no native web search**. They fall back to the server-tool Exa rate (~$0.02/call). Our gateway code computes `webSearchRequests × (model.webSearchPrice ?? 0)` and silently records $0 cost while OpenRouter still charges us. This is an active leak.

**Source-of-truth facts established (2026-04-29 research, see § 9):**

- Tavily PAYG: `$0.008/credit` confirmed against `docs.tavily.com/documentation/api-credits` and `tavily.com/pricing`. Basic = 1 credit, Advanced = 2 credits. The repo's `TAVILY_USD_PER_CREDIT = 0.008` constant is correct and remains a safe upper bound on any subscription tier (which run $0.005–$0.0075/credit within quota).
- OpenRouter `openrouter.tools.webSearch()` (the AI-SDK path used at `convex/chat/tools/openrouterWebSearch.ts:19`) maps to the **server tool `openrouter.web_search`** (NOT the deprecated plugin, NOT the `:online` suffix). Authoritative: `node_modules/@openrouter/ai-sdk-provider/dist/index.mjs:5018-5027`.
- Server-tool rate: **$0.004 per result** via Exa/Parallel; default `maxResults: 5` ⇒ **$0.02/call**. Unchanged since the Jan 23 2025 launch announcement; no 2025–2026 changelog entry alters it.
- For models with native web search, `pricing.web_search` is a flat $/call and lives on the model row — `convex/models/sync.ts:117` already syncs this from OpenRouter's `/api/v1/models`. Live values vary widely: $0.005 (Perplexity Sonar, Grok 4), $0.01 (Sonnet 4), $0.014 (Gemini 2.5 Pro), $0.035 (GPT-4o-search-preview legacy SKU). Our test fixtures `0.025` / `0.0275` are stale relative to the live catalog.
- The chat path uses the global `AI_COST_MARKUP = 1.3`. The wallet gateway path uses the per-model DB column `costMarkup`. **These are TWO independent markup mechanisms.** This plan does NOT unify them — too much surface for one set of plans — but it must surface the divide explicitly so future work can reconcile.

## 2. Locked design decisions (2026-04-29)

1. **Single source-of-truth module: `lib/pricing/`.** Framework-agnostic — no Convex imports, no React imports — so both `convex/` and `components/` can consume it. Subdirectories: `lib/pricing/constants.ts` (raw numbers), `lib/pricing/convert.ts` (formula), `lib/pricing/web-search.ts` (per-path catalog and selectors), `lib/pricing/index.ts` (barrel).
2. **The conversion formula lives once, in `lib/pricing/convert.ts`.** Existing helpers (`convertUsdCostToCredits` at `convex/ai/lib/creditBilling.ts`, `convertDollarsToCredits` at `convex/lib/creditTopups.ts`) become thin re-exports / adapters. The formula: `credits = max(1, ceil(usd × markup × creditsPerUsd))` where `markup` defaults to `AI_COST_MARKUP` and is overridable per-call (e.g. for the wallet gateway's per-model markup).
3. **Web-search catalog: a typed object literal** in `lib/pricing/web-search.ts`:
   ```
   WEB_SEARCH_PRICING = {
     tavily: { basicUsdPerCredit: 0.008, advancedUsdPerCredit: 0.008 /* still 1cr=$0.008; 2cr=$0.016 falls out by multiplying creditsUsed */ },
     openrouterServerTool: { usdPerResult: 0.004, defaultMaxResults: 5, defaultUsdPerCall: 0.02 },
   }
   ```
   The Tavily basic/advanced split is captured by the existing wire-level `creditsUsed` field returned by Tavily's API; we keep multiplying by `usdPerCredit` and never branch on `searchDepth` ourselves.
4. **A new selector `pickWebSearchPricing({ path, model? })`** that returns `{ usdEstimatePerCall, creditsEstimatePerCall, label }` for ANY caller — billing AND UI. Inputs are the path string from `selectWebSearchTool.ts:pickWebSearchTool` plus the optional model row (for the OpenRouter native-vs-server-tool fallback). One function, both surfaces.
5. **Tooltip shows REAL credits.** Replace `(~$0.02 per search)` in all 6 locale files with a parameterized message (`"Search the web for current info (~{credits} credits per search)."`) and supply the value at render time from `pickWebSearchPricing(...)`. Drop the dollar number from user-facing copy entirely — credits are the unit users actually pay in.
6. **Tool-step chip uses the same selector.** `components/ai-elements/tool-step.tsx` deletes its private `SEARCH_COST_DEFAULTS` and reads from the module. The `output-available` real-cost path stays as-is.
7. **Gateway null-price fallback.** When `model.webSearchPrice` is null AND a `web_search` tool call fired, fall back to `WEB_SEARCH_PRICING.openrouterServerTool.defaultUsdPerCall` × `webSearchRequests`. This closes the leak. Per-model `costMarkup` continues to apply on top, identical to the existing path. Plan 02 owns this fix.
8. **i18n stance: parameterize every locale.** Use the existing `next-intl` interpolation syntax (the file already uses `{name}`-style placeholders in other strings — confirmed by file-internal grep during execution). All 6 locales: en-US, en-GB, ja, zh, fr, hi.
9. **Migration stance: destructive.** Old constants are deleted, not re-exported with a deprecation comment. Every consumer is rewired in the same plan that introduces the module export. No "compat shim" file. No `@deprecated` jsdoc tags pointing at "use X instead". The duplicate is gone after the rewire commit.
10. **Out of scope for this plan set:** unifying `AI_COST_MARKUP` (global) with the per-model `costMarkup` column. They remain two parallel mechanisms; this plan only removes the **value-level** duplication, not the mechanism-level duplication. A follow-up plan can decide whether the chat path should also read per-model markup.
11. **Out of scope:** `EXTRACTION_COST_CONSTANTS` in `lib/extraction/cost-estimate.ts`. Those are credit-floor heuristics for preflight UX, not USD-denominated; they're already in `lib/`. Leave them where they are. (If we later want to derive them from `AI_COST_MARKUP × CREDITS_PER_USD × empirical-token-budgets`, that's a separate plan.)
12. **Out of scope:** the embedding `$/1M tokens` constant at `convex/extraction/workpoolActions.ts:100`. It's env-overridable and lives entirely inside the extraction workpool. Leave it; a follow-up can fold it in once we decide whether per-1M-token rates belong alongside per-call rates in the same module.

## 3. Plan-file inventory

| # | Plan | Slice |
|---|---|---|
| 01 | `01-pricing-module.md` | Create `lib/pricing/` (constants + convert + web-search catalog + selector). Pure-logic TDD. No callers rewired yet — module ships standalone with full unit coverage. |
| 02 | `02-rewire-billing-and-fix-null-fallback.md` | Rewire `convex/chat/billing.ts:recordTavilyCost`, `convex/ai/lib/creditBilling.ts:convertUsdCostToCredits`, and `convex/wallet/gateway/cost.ts:calculateEnhancedModelCost` to import from the module. **Add the OpenRouter server-tool fallback** when `model.webSearchPrice` is null. Delete the old file-private constants. Extend gateway tests with the null-price case. |
| 03 | `03-rewire-ui-and-i18n.md` | Rewire `components/ai-elements/tool-step.tsx`, `lib/chat/format-search-cost.ts`, `components/extraction/chat/web-search-toggle.tsx` to consume `pickWebSearchPricing(...)`. Parameterize the `tooltipOff` string in all 6 locale files. Update component tests to assert behavior (data attrs / role / text), not on dollar literals. |

`PROMPTS.md` carries one copy-paste execution prompt per numbered plan, in the established `STANDING RULES` / `EXECUTION RHYTHM` / `WHEN TO STOP` / `START NOW` shape.

## 4. Dependency graph

```
01 (module)  ─── no deps
              │
              ├─→ 02 (rewire billing) ── needs 01
              └─→ 03 (rewire UI) ────── needs 01
              
02 and 03 are independent of each other and can be executed in parallel.
```

## 5. Reuse / DRY notes

- **DO NOT** introduce a new `getCreditsPerUsd()` reader. Reuse `convex/lib/creditTopups.ts:getCreditsPerUsd` — keep the env-override pathway (`process.env.CREDITS_PER_USD`). The new module's `convert.ts` calls into it.
- **DO NOT** add a second `convertUsdCostToCredits`. The existing one in `convex/ai/lib/creditBilling.ts` becomes a 3-line re-export of the new module's function so live-billing tests don't shift their import path uselessly. (We delete the body, not the symbol.)
- **DO NOT** add an `AI_COST_MARKUP_V2`. The existing constant moves to `lib/pricing/constants.ts`; `convex/lib/constants.ts` re-exports it (we cannot delete that file because non-pricing constants live there too — `ESTIMATED_CREDITS_PER_QUERY` etc.). The re-export is the **only** allowed compat shim because `convex/lib/constants.ts` is already a multi-purpose grab-bag.
- **DO NOT** create a `formatCredits` utility — `lib/chat/format-search-cost.ts:formatSearchCostLabel` already does it. Keep that file; just point it at the new pricing module for its defaults.
- **DO NOT** put `pickWebSearchPricing` next to `pickWebSearchTool` (`convex/chat/tools/selectWebSearchTool.ts`). The latter is server-only Convex code; the new selector lives in `lib/pricing/` so the UI can call it without dragging the Convex client. The two selectors share the `WebSearchPath` type — re-export it from the module so they agree.
- **REUSE** the existing `WebSearchPath = "tavily" | "openrouter" | null` type from `convex/chat/tools/selectWebSearchTool.ts`. Move the definition to `lib/pricing/web-search.ts` and update the import on the existing file.

## 6. Testing doctrine

- **Pure-logic TDD** for everything in `lib/pricing/`: `convertUsdToCredits`, `pickWebSearchPricing` selector, the per-path math. One commit per green test.
- **Behavioral tests** for the UI rewire: assert on `getByRole`, `getByText`, `data-*` attributes — never on the dollar string or Tailwind classes. Tooltip text matches an interpolation **template** (`/~\d+ credits per search/`), not a fixed dollar amount.
- **Convex-test extension** for the gateway null-price fallback: extend `convex/wallet/gateway/gateway.test.ts` with a case where the model's `webSearchPrice` is null AND `webSearchRequests > 0`, assert the resulting credit deduction matches `ceil(0.02 × markup × creditsPerUsd) × n`.
- **No tests on dollar literals.** Existing tests that match `expect(...).toBe("~$0.02 / ~3 credits")` (e.g. `lib/chat/format-search-cost.test.ts:31`) are rewritten to match credit counts only, since the user-facing label is being changed. The change is intentional, not a regression.

## 7. Migration stance

**Project default: destructive.** Old constants are removed, not re-exported with deprecation jsdoc. The single allowed re-export — `AI_COST_MARKUP` from `convex/lib/constants.ts` — is necessary because that file is a multi-purpose constants grab-bag, not because we're preserving compat. All other duplicates are deleted in the same commit that wires their replacement.

No `@convex-dev/migrations` script. No backfill. No "old field too" code path. The dev DB has no migration to run for this work — the changes are pure code-side constant relocation. Per-model `costMarkup` rows on `models` are untouched.

## 8. Delegation policy

- **Investigations spanning ≥3 files**: delegate to an `Explore` subagent. Examples: "find every consumer of `convertUsdCostToCredits`", "list all `messages/*.json` files using `tooltipOff`".
- **External research**: not expected for this plan set — the pricing facts are already grounded (§ 9). If a new pricing question arises mid-execution, delegate to a `general-purpose` subagent with WebFetch.
- **Single-file edits and TDD loops**: keep in main session.
- Per-plan prompts in `PROMPTS.md` repeat this policy so every fresh `/clear`'d run inherits it.

## 9. Grounding sources

Pricing facts established by parallel research agents on 2026-04-29:

- **Tavily**: official docs `https://docs.tavily.com/documentation/api-credits`, public pricing `https://www.tavily.com/pricing`, third-party tracker `https://costbench.com/software/web-scraping/tavily/` (last updated Apr 23, 2026). Verdict: PAYG `$0.008/credit` unchanged. Repo's existing constant correct.
- **OpenRouter**: official docs `https://openrouter.ai/docs/guides/features/server-tools/web-search`, deprecated plugin docs `https://openrouter.ai/docs/guides/features/plugins/web-search`, launch announcement `https://openrouter.ai/announcements/introducing-web-search-via-the-api` (Jan 23 2025), live catalog `https://openrouter.ai/api/v1/models` fetched 2026-04-29. Provider source: `node_modules/@openrouter/ai-sdk-provider@2.8.0/dist/index.mjs:5018-5027` and `dist/index.d.mts:709-757`. Verdict: server tool $0.02/call default; per-model native varies $0.005–$0.10; `null` for models without native web search.

Code-level grounding (read directly from the working tree on 2026-04-29):

- Conversion formula: `convex/ai/lib/creditBilling.ts:14-20` × `convex/lib/creditTopups.ts:30-36` × `convex/lib/constants.ts:11`.
- Tavily billing: `convex/chat/billing.ts:497-560` (`recordTavilyCost`).
- Gateway billing: `convex/wallet/gateway/cost.ts:38-87` (`calculateEnhancedModelCost`).
- Gateway model-list response: `convex/wallet/gateway/handler.ts:438-486` (`m.webSearchPrice * m.costMarkup` per-model markup).
- Selector for path: `convex/chat/tools/selectWebSearchTool.ts:14-23` (`pickWebSearchTool`).
- UI placeholders: `components/ai-elements/tool-step.tsx:9-12`, `lib/chat/format-search-cost.ts:1-13`, `components/extraction/chat/web-search-toggle.tsx:56-60`.
- i18n strings: `messages/en-US.json:1031`, `en-GB.json:1028`, `ja.json:1005`, `zh.json:1005`, `fr.json:1005`, `hi.json:1005`.
