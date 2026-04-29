# 03 — Rewire UI + i18n

## Goal

Cut every UI surface that displays web-search cost over to the `lib/pricing/` module so the tooltip and the tool-step chip show the **real** credit cost of the path that will actually run — not the static "$0.02 per search" placeholder. Drop the dollar number from user-facing copy entirely; users pay in credits, so we show credits.

## Scope

**In:**
- New Convex query `getChatWebSearchPricing(threadId)` that resolves the active path + model pricing server-side and returns `{ source, usdPerCall, creditsPerCall }`. Lives at `convex/chat/messages.ts` next to the other thread-scoped queries.
- `components/extraction/chat/web-search-toggle.tsx` — subscribe to the new query; pass the resolved `credits` into the tooltip via `next-intl` interpolation. Add `data-web-search-source` for tests.
- `components/ai-elements/tool-step.tsx` — delete file-private `SEARCH_COST_DEFAULTS`; import from `@/lib/pricing` and resolve via `pickWebSearchPricing(...)` using the props the parent already has.
- `lib/chat/format-search-cost.ts` — change the estimate-only branch to take `{ source, creditsEstimate }` instead of `{ creditsPerSearchEstimate, costUsdEstimate }`. Drop the dollar formatting.
- `messages/{en-US,en-GB,ja,zh,fr,hi}.json` — rewrite `webSearch.tooltipOff` to use a `{credits}` placeholder. Translation per locale (see § Design for the canonical strings).
- Tests:
  - `tests/components/web-search-toggle.test.tsx` — new assertions for tooltip text containing the resolved credit count; mock the new query.
  - `tests/components/tool-step.test.tsx` — rewrite assertions on the dollar string; use credits.
  - `lib/chat/format-search-cost.test.ts` — rewrite to match the new signature.
- Component-tree wiring: `MessageRow`/`message-list.tsx` passes the resolved web-search source from the existing parts iteration into `<ToolStep>` so it knows which path to bill against. (Path is already implicit from the tool name; we just need to pass model row context if not already there.)

**Out:**
- Server-side billing (plan 02).
- Adding `costUsd` columns to thread rows or new persisted fields. The pricing query computes on read.
- Reworking the cost-display once the tool finishes (`output-available` state) — that already shows real `creditsUsed` from the bill, no change needed.

## Design

### New Convex query — `getChatWebSearchPricing(threadId)`

Lives at `convex/chat/messages.ts` (same file as `setChatWebSearchEnabled`). Reads:

1. The job row for `threadId` to know `chatModelId` (NOT `webSearchEnabled` — see deviation note below).
2. The `models` row for `chatModelId` to know `webSearchPrice` and `costMarkup` and `supportedParameters`.
3. `process.env.TAVILY_API_KEY` to choose the path.

Then computes:

```ts
import { pickWebSearchPricing } from "@/lib/pricing";
import { pickWebSearchTool } from "./tools/selectWebSearchTool";

// Compute the path AS IF the toggle were on. The whole point of this
// query is to power the off-state tooltip ("if you enabled this, it
// would cost ~N credits per search"); reading `job.webSearchEnabled`
// here would force the off-state tooltip to render "~0 credits per
// search" forever, defeating the work. Path resolves to null (→
// `unsupported`) only when the model itself lacks the tools
// capability — that's the genuine "no web search possible" case.
const path = pickWebSearchTool({
  enabled: true,
  modelSupportsWebSearch: model.supportedParameters?.includes("tools") ?? false,
  hasTavilyKey: Boolean(process.env.TAVILY_API_KEY),
});

const pricing = pickWebSearchPricing({
  path,
  modelWebSearchPriceUsd: model.webSearchPrice,
  // Note: chat path uses global AI_COST_MARKUP, not per-model costMarkup.
  // pickWebSearchPricing defaults markup to AI_COST_MARKUP when omitted.
});

return {
  source: pricing.source,
  usdPerCall: pricing.usdPerCall,
  creditsPerCall: pricing.creditsPerCall,
};
```

Returns validator:

```ts
returns: v.object({
  source: v.union(
    v.literal("tavily-basic"),
    v.literal("openrouter-native"),
    v.literal("openrouter-server-tool"),
    v.literal("unsupported"),
  ),
  usdPerCall: v.union(v.number(), v.null()),
  creditsPerCall: v.union(v.number(), v.null()),
}),
```

The `returns` validator MUST list every field the implementation returns; missing a field silently strips it on the wire (CLAUDE.md § Deployability — "Stale return validators"). Add a unit test that `getChatWebSearchPricing` returns all three fields.

Auth: same pattern as `setChatWebSearchEnabled` — auth-gated, returns the `unsupported` shape if the caller can't see the thread (rather than throwing — UI shouldn't surface a permission error here).

### Toggle component rewire

```tsx
// components/extraction/chat/web-search-toggle.tsx
const pricing = useQuery(api.chat.messages.getChatWebSearchPricing, { threadId });

// ...
const tooltipText = !supported
  ? t("webSearch.tooltipUnsupported")
  : enabled
    ? t("webSearch.tooltipOn")
    : t("webSearch.tooltipOff", {
        credits: pricing?.creditsPerCall ?? 0,
      });

// Add data attribute for tests:
<Button
  ...
  data-web-search-source={pricing?.source ?? "unsupported"}
  data-web-search-credits-estimate={String(pricing?.creditsPerCall ?? 0)}
>
```

Render fallback: while `pricing` is loading (`undefined`), the tooltip falls back to the `tooltipOffLoading` string (new key — copy: "Search the web for current info."). No flash of the dollar amount; no flash of "0 credits per search".

### `tool-step.tsx` rewire

Today (`components/ai-elements/tool-step.tsx:9-12`):

```ts
const SEARCH_COST_DEFAULTS = {
  creditsPerSearchEstimate: 3,
  costUsdEstimate: 0.02,
} as const;
```

After:

```ts
import { pickWebSearchPricing, type WebSearchPath } from "@/lib/pricing";

// component prop addition:
interface ToolStepProps {
  part: ToolUIPart;
  messageStatus?: "pending" | "streaming" | "success" | "failed";
  aborted?: boolean;
  /** The active path so we can compute the estimate cost while in flight.
 *   Provided by the parent `MessageRow`, which knows the active job's path. */
  webSearchSource?:
    | "tavily-basic"
    | "openrouter-native"
    | "openrouter-server-tool"
    | "unsupported";
  /** Native web-search USD price for the active model, when applicable.
 *   Used only when `webSearchSource === "openrouter-native"`; ignored
 *   otherwise. */
  modelWebSearchPriceUsd?: number | null;
}
```

The estimate label (used during `input-streaming`/`input-available`) is computed from the pricing module. `formatSearchCostLabel` is updated (see below) to take `{ source, creditsEstimate }` and produce e.g. `"~104 credits"` (Tavily-basic), `"~260 credits"` (OpenRouter server-tool), `"~130 credits"` (OpenRouter native @ Sonnet-4 price).

When the call resolves to `output-available`, the chip prefers the **actual** `creditsUsed` if present in the tool output (today's behaviour for Tavily; OpenRouter doesn't surface usage on the part). Fallback: keep the estimate label.

### `format-search-cost.ts` rewire

Old signature:

```ts
function formatSearchCostLabel(input: {
  creditsUsed?: number;
  creditsPerSearchEstimate: number;
  costUsdEstimate: number;
}): string;
```

New signature:

```ts
import type { WebSearchPricing } from "@/lib/pricing";

function formatSearchCostLabel(input: {
  /** Actual credits billed, when known (output-available with usage). */
  creditsUsed?: number;
  /** Estimate path data when no actual cost is known yet. */
  estimate: { source: WebSearchPricing["source"]; creditsPerCall: number | null };
}): string {
  if (input.creditsUsed != null) {
    return `${input.creditsUsed} credit${input.creditsUsed === 1 ? "" : "s"}`;
  }
  if (input.estimate.creditsPerCall == null) {
    return ""; // unsupported / not in flight — caller should hide the chip
  }
  return `~${input.estimate.creditsPerCall} credits`;
}
```

Drop the dollar formatting entirely. Drop the singular/plural-of-the-estimate dance — estimates are always plural (`~104 credits`, `~1 credit` is unrealistic for our rates).

### i18n key changes — all 6 locales

`webSearch.tooltipOff` becomes interpolated. New translations (verify with a native-speaker pass during execution; below are first-cut working translations consistent with the existing per-locale tone):

| Locale | Before | After |
|---|---|---|
| en-US, en-GB | `Search the web for current info (~$0.02 per search).` | `Search the web for current info (~{credits} credits per search).` |
| ja | `最新情報をウェブで検索（1 回あたり約 $0.02）。` | `最新情報をウェブで検索（1 回あたり約 {credits} クレジット）。` |
| zh | `在网络上搜索最新信息（每次约 $0.02）。` | `在网络上搜索最新信息（每次约 {credits} 积分）。` |
| fr | `Rechercher des informations actuelles sur le web (~0,02 $ par recherche).` | `Rechercher des informations actuelles sur le web (~{credits} crédits par recherche).` |
| hi | `मौजूदा जानकारी वेब पर खोजें (~$0.02 प्रति खोज)।` | `मौजूदा जानकारी वेब पर खोजें (~{credits} क्रेडिट प्रति खोज)।` |

New companion key `webSearch.tooltipOffLoading` (rendered while the pricing query resolves):

| Locale | tooltipOffLoading |
|---|---|
| en-US, en-GB | `Search the web for current info.` |
| ja | `最新情報をウェブで検索します。` |
| zh | `在网络上搜索最新信息。` |
| fr | `Rechercher des informations actuelles sur le web.` |
| hi | `मौजूदा जानकारी वेब पर खोजें।` |

### Test coverage philosophy

All assertions must be **behavioral** — never on Tailwind classes, never on the dollar string. Use:

- `getByRole("tooltip")` / `getByText(/\d+ credits per search/)` for tooltip presence.
- `data-web-search-source` / `data-web-search-credits-estimate` attributes for tests that need to assert the resolved path/value without parsing the locale string.
- Mock `useQuery(api.chat.messages.getChatWebSearchPricing, ...)` with explicit return values per scenario.

## TDD sequence

### Phase A — pure logic (commit per green)

**R1** — Update `lib/chat/format-search-cost.test.ts` to match the new signature. Cover:
- `creditsUsed = 1, estimate = ...` → `"1 credit"`.
- `creditsUsed = 2, estimate = ...` → `"2 credits"`.
- `creditsUsed = 0, estimate = ...` → `"0 credits"`.
- `creditsUsed = undefined, estimate = { source: "tavily-basic", creditsPerCall: 104 }` → `"~104 credits"`.
- `creditsUsed = undefined, estimate = { source: "openrouter-native", creditsPerCall: 130 }` → `"~130 credits"`.
- `creditsUsed = undefined, estimate = { source: "openrouter-server-tool", creditsPerCall: 260 }` → `"~260 credits"`.
- `creditsUsed = undefined, estimate = { source: "unsupported", creditsPerCall: null }` → `""` (empty — caller decides whether to hide).

Watch fail. Commit `test(chat): [plan-03] formatSearchCostLabel new signature`.

**G1** — Implement the new body of `formatSearchCostLabel`. Watch pass. Commit `refactor(chat): [plan-03] formatSearchCostLabel reads from lib/pricing`.

### Phase B — Convex query (one logical unit, one commit)

**U1** — New `getChatWebSearchPricing` query. Add the query, the `returns` validator, and a unit test (extend `convex/chat/messages.test.ts` if it has the right scaffolding, otherwise spawn a small new file `convex/chat/getChatWebSearchPricing.test.ts`):

- Toggle off on job, model has tools → returns concrete pricing for the path that WOULD run if enabled (the tooltip renders "if you enabled this, ~N credits per search"). NOT `unsupported`.
- Model lacks `"tools"` → `unsupported` (toggle state irrelevant — the model itself can't web-search).
- Model has tools, no `TAVILY_API_KEY` → `openrouter-native` if model has `webSearchPrice`, else `openrouter-server-tool`.
- Model has tools, `TAVILY_API_KEY` set → `tavily-basic` with `creditsPerCall: 104`.
- Auth missing → `unsupported` (does not throw).

Run `npx pm2 logs convex --lines 5 --nostream` after the commit. Confirm `✔ Convex functions ready!`. Commit `feat(chat): [plan-03] getChatWebSearchPricing query`.

### Phase B — UI rewires (one commit per logical unit)

**U2** — `tool-step.tsx`: delete `SEARCH_COST_DEFAULTS`, add the new props, switch label rendering to the new `formatSearchCostLabel` signature. Update `tests/components/tool-step.test.tsx` to assert behavior:
- `data-tool-state="input-available"` AND `webSearchSource="tavily-basic"` → text matches `/~104 credits/`.
- `data-tool-state="output-available"` with `creditsUsed: 2` → text is `"2 credits"`.
- Drop the `expect(...).toContain("~$0.02 / ~3 credits")` assertion at line 115; rewrite to `expect(...).toContain("~104 credits")` (or the appropriate value per scenario).

Run `npx pm2 logs next --lines 5 --nostream` after the commit. Confirm recent `✓ Compiled` with no errors. Commit `refactor(chat): [plan-03] tool-step reads pricing from lib/pricing`.

**U3** — `web-search-toggle.tsx`: add the `useQuery` for the pricing, add the `data-*` attributes, parameterize the tooltip. Tests (`tests/components/web-search-toggle.test.tsx`):
- Mock `useQuery` to return `{ source: "tavily-basic", creditsPerCall: 104, ... }`. Assert tooltip text matches `/104 credits per search/i`.
- Mock to return loading (`undefined`). Assert tooltip text equals `tooltipOffLoading` (`"Search the web for current info."` for en-US). Verify no `0 credits` flash.
- Mock `{ source: "openrouter-server-tool", creditsPerCall: 260, ... }`. Assert tooltip matches `/260 credits per search/`.
- Mock `{ source: "unsupported", ... }`. Tooltip is `tooltipUnsupported`.

Commit `refactor(chat): [plan-03] WebSearchToggle tooltip shows real credits`.

**U4** — i18n: rewrite the 6 locale files' `webSearch.tooltipOff` per § i18n key changes; add the new `tooltipOffLoading` key. Confirm `tsc --noEmit` and the toggle tests still pass (the test mocks the locale, but interpolation parsing should fail loudly if the placeholder is wrong). Commit `i18n(chat): [plan-03] tooltipOff parameterized; tooltipOffLoading added (6 locales)`.

**U5** — `MessageRow` parts iteration: pass the resolved `webSearchSource` and `modelWebSearchPriceUsd` into each `<ToolStep>` it renders for `web_search` parts. Source: same `useQuery(getChatWebSearchPricing)` reused (or read the data already in scope from the parent component's existing job/model query — prefer reuse). Commit `feat(chat): [plan-03] MessageRow forwards webSearchSource into ToolStep`.

**U6** — Final acceptance grep:
```
grep -rn "0\.02" --include="*.tsx" --include="*.json" components/ messages/ | grep -v "from-primary/\[0\.02\]" | grep -v "oklch"   # zero hits
grep -rn "costUsdEstimate\|creditsPerSearchEstimate" --include="*.ts" --include="*.tsx" .                                       # zero hits
grep -rn "SEARCH_COST_DEFAULTS" --include="*.ts" --include="*.tsx" .                                                            # zero hits
grep -rn "\\$0\\.02\|\\$0,02" messages/                                                                                          # zero hits
```

Note: the first grep filters out cosmetic Tailwind opacity values like `from-primary/[0.02]` and `oklch(...0.02...)` which are unrelated visual constants.

## Files touched

- `convex/chat/messages.ts` — new query (~40 LOC).
- `convex/chat/messages.test.ts` (or new `getChatWebSearchPricing.test.ts`) — new test cases (~80 LOC).
- `components/extraction/chat/web-search-toggle.tsx` — `useQuery` + tooltip interpolation + data attrs (~10 LOC change).
- `components/ai-elements/tool-step.tsx` — delete defaults, add props, swap label call (~15 LOC change).
- `components/extraction/chat/message-list.tsx` (`MessageRow`) — forward props to `<ToolStep>` (~5 LOC change).
- `lib/chat/format-search-cost.ts` — new signature (~15 LOC change).
- `lib/chat/format-search-cost.test.ts` — new cases (~50 LOC change).
- `tests/components/web-search-toggle.test.tsx` — new tooltip-text assertions (~40 LOC addition).
- `tests/components/tool-step.test.tsx` — rewrite credit-string assertion at line 115 and any sibling cases (~10 LOC change).
- `messages/en-US.json`, `en-GB.json`, `ja.json`, `zh.json`, `fr.json`, `hi.json` — `tooltipOff` rewrite + `tooltipOffLoading` add (1 line change + 1 line add per locale).

## Migration stance

**Destructive at the API level.** `formatSearchCostLabel`'s old `{ creditsPerSearchEstimate, costUsdEstimate }` shape is gone. The two callers (`tool-step.tsx`, the test file) are rewired in the same plan. The old `tooltipOff` strings are deleted, not preserved as `tooltipOffLegacy`. No back-compat shims, no `@deprecated` annotations.

The dev DB is untouched. Per-thread state (`extractionJobs.webSearchEnabled`) is unaffected. No schema change.

## Test plan

- `npx vitest run lib/chat/format-search-cost.test.ts` — passes after G1.
- `npx vitest run convex/chat/messages.test.ts` (or the new file) — passes after U1; covers all 5 cases above.
- `npx vitest run tests/components/web-search-toggle.test.tsx` — passes after U3.
- `npx vitest run tests/components/tool-step.test.tsx` — passes after U2.
- `npx tsc --noEmit` — clean after every commit.
- Full `npx vitest run` — no regressions anywhere.
- Manual smoke test:
  1. Open the chat; toggle off; hover the toggle. Tooltip shows the actual credit count for the active path (~104 for Tavily, ~260 for server-tool model, ~130 for Sonnet-4 native).
  2. Send a turn with web search on. The "Searching the web…" chip shows the same estimate during in-flight, then snaps to actual `N credits` once the tool completes.
  3. Switch to a model that lacks `"tools"`. Tooltip says "Selected model does not support web search." Toggle is disabled.
  4. With `TAVILY_API_KEY` unset (set the env to empty in local pm2 ecosystem and restart convex), tooltip shows the OpenRouter path's credits instead.
- A11y smoke: VoiceOver / screen reader announces the tooltip with the credit count read aloud as part of the button's accessible description.

## Deployability gate

Touches both `convex/` (new query) and `components/` + `messages/`. Run after **every** commit:

```
npx pm2 logs convex --lines 5 --nostream    # expect ✔ Convex functions ready!
npx pm2 logs next --lines 5 --nostream      # expect recent ✓ Compiled, no Module not found / Type error
```

Specifically watch for:
- **Stale return validators** on the new `getChatWebSearchPricing` query. Add a field to `returns` for every field returned. If you add `source` to the return body but forget it in `returns`, the query strips it on the wire and the toggle silently shows `0 credits`.
- **i18n placeholder mismatches**. `next-intl` throws at runtime if a string says `{credits}` but the component passes `{ source: ... }`. Run the toggle tests to catch this.
- **Convex args validator changes**: the new query's args is `{ threadId: v.string() }` — ensure `useQuery` callers don't pass extra fields.

If pm2 wedges on either, **stop**. Don't commit further until the offending commit is fixed or reverted.

## Acceptance criteria

- [ ] `getChatWebSearchPricing(threadId)` exists, has full `returns` validator, all 5 unit-test cases pass.
- [ ] `WebSearchToggle` subscribes to the new query and renders the tooltip via interpolation; `data-web-search-source` and `data-web-search-credits-estimate` attributes track state.
- [ ] `<ToolStep>` reads its in-flight cost label from `pickWebSearchPricing(...)` (no file-private `SEARCH_COST_DEFAULTS`).
- [ ] `formatSearchCostLabel` accepts the new `{ creditsUsed?, estimate: { source, creditsPerCall } }` signature; old fields are gone.
- [ ] All 6 locale files have parameterized `tooltipOff` and the new `tooltipOffLoading` key.
- [ ] All four post-rewire greps in § Phase B U6 return zero unrelated hits.
- [ ] Existing test that asserted `"~$0.02 / ~3 credits"` (`lib/chat/format-search-cost.test.ts:31`) is replaced with credit-only assertion.
- [ ] No assertion in any test references a Tailwind class string or a literal dollar number.
- [ ] `npx tsc --noEmit` clean.
- [ ] Full `npx vitest run` passes.
- [ ] `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!` after the final commit.
- [ ] `npx pm2 logs next --lines 5 --nostream` shows recent `✓ Compiled` after the final commit.
- [ ] Manual smoke test (above) shows the tooltip and chip both reflect the active path's real credit cost.

## Deviations

### 2026-04-29 — Query computes cost-if-enabled, not cost-as-currently-configured

**Problem.** The plan as originally written said `getChatWebSearchPricing` should pass `enabled: job.webSearchEnabled` into `pickWebSearchTool`, AND that the U1 unit tests should assert "Web search disabled on job → unsupported". Both were fine in isolation. But U3's design parameterizes the off-state tooltip with `credits: pricing?.creditsPerCall ?? 0` — meaning a query that returns `unsupported` (creditsPerCall: null) for an off-but-supported thread forces the tooltip to render "~0 credits per search" permanently, which is exactly the failure mode this plan exists to fix.

**Fix.** The query now passes `enabled: true` into `pickWebSearchTool` unconditionally. `path` resolves to `null` (→ `unsupported`) only when the model itself lacks the tools capability — the genuine "no web search possible" branch. For an off-but-supported thread the query returns concrete pricing, and the tooltip renders the real cost-if-enabled.

**Consequences.**
- U1 § design no longer reads `job.webSearchEnabled`. The bullet "Web search disabled on job → unsupported" is replaced with "Toggle off on job, model has tools → returns concrete pricing".
- The `enabled` prop on `<WebSearchToggle>` (which mirrors the persisted server state) still discriminates which tooltip key fires (`tooltipOn` vs `tooltipOff`). The query result only feeds the credit-count interpolation.
- No code change in `tool-step.tsx` or the i18n strings; this is a server-side semantics fix in the query only.

## Known pitfalls

- **`useQuery` returning `undefined` while loading.** The toggle MUST handle `pricing === undefined` gracefully — show `tooltipOffLoading` instead of falling through to `tooltipOff` with `credits: 0` (which would render "~0 credits per search" — wrong and confusing). This is NOT a `useEffect` case; it's a render-time check.
- **Don't add a `useEffect` to "hide the tooltip until pricing loads"**. The CLAUDE.md ban applies. Render the loading text directly during render based on whether `pricing` is `undefined`.
- **Path detection on the UI side** — DO NOT replicate `pickWebSearchTool`'s env read in the browser (`TAVILY_API_KEY` is server-only). The new Convex query is the only path that knows the env. Don't add a `NEXT_PUBLIC_HAS_TAVILY_KEY` env var either; the query is the right interface.
- **`formatSearchCostLabel` callers**: there are exactly two — `tool-step.tsx` and the test file. Touch both in the same plan; don't leave a dangling caller using the old signature.
- **`messages/*.json` line endings**: some locale files have CRLF, some LF. Match the existing line-ending of each file when editing — don't let your editor normalize them silently. Verify with `git diff --check` before committing.
- **Singular vs plural**: at the rates in scope (65–1300 credits per call) the plural form is always correct. Don't add singular-form branches to the i18n strings; the runtime will only ever ask for plural. (`creditsUsed === 1` for the actual-billed case is handled by `formatSearchCostLabel` directly, not by i18n.)
- **`MessageRow` wiring**: if `MessageRow` doesn't already have access to the active model row, prefer extending its existing query result over adding a second query. Reuse the same `useQuery(getChatWebSearchPricing)` the toggle uses — Convex deduplicates identical queries client-side, so two subscribers cost one round trip.
- **Test mocking**: when mocking `useQuery` for `getChatWebSearchPricing`, return the FULL shape (`{ source, usdPerCall, creditsPerCall }`) — partial mocks will silently render `undefined` paths and the test will pass for the wrong reason.
- **Server-tool credit count is path-dependent on `maxResults`**: the OpenRouter tool factory at `convex/chat/tools/openrouterWebSearch.ts:18` defaults `maxResults: 5`, matching `WEB_SEARCH_PRICING.openrouterServerTool.defaultMaxResults`. If you ever bump that default, also bump the constants in `lib/pricing/`. The selector takes an optional `maxResults` arg for callers that need to override; keep it.
- **Locale fallback**: `next-intl` falls back from a missing key, so if you forget to add `tooltipOffLoading` to (say) `hi.json`, the runtime silently uses the en-US version. Don't rely on this — explicitly add the key in every locale during U4.
