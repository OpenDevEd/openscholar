/**
 * The assistant searches the web (#648): reports, policy documents, news and anything else
 * outside the literature OpenAlex holds. OpenRouter's web plugin runs the search on Exa,
 * through a small model that only has to cite what it found; the pages come back as its
 * citations, each with its text. The person is asked first unless they allowed searches in
 * the chat, and the search is charged on its own line at what OpenRouter reports it cost.
 */
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { releaseCredits, reserveCredits, settleCredits } from "../billing/charge";
import { createError } from "../lib/errors";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { convertUsdToCredits } from "../../lib/pricing";
import { openRouterUsageCost } from "../../lib/ai/pick-provider-cost";
import { WEB_RESULTS_MAX, webResultsValidator } from "./searchValidators";
import { WEB_SEARCH_ENGINE, WEB_SEARCH_HOLD_USD, WEB_SEARCH_MAX_RESULTS, WEB_SEARCH_MODEL, WEB_SEARCH_MODEL_TOKENS } from "../../lib/pricing/web-search";

/** The most of a page's text the model is given per result. */
const EXCERPT_CHARS = 1_200;
const QUERY_MAX = 400;

type Result = { title: string; url: string; excerpt: string };
type Annotation = { type?: string; url_citation?: { url?: string; title?: string; content?: string } };

/** Waits before each retry of a search the provider was too busy for, as the AI SDK does for model calls. */
const RETRY_MS = [1_000, 2_000];

/** One search: the pages it found, and what OpenRouter says it cost. Logged in full when it fails, so a failure says why. */
async function searchWeb(query: string): Promise<{ results: Result[]; usd: number | null }> {
  type Body = { choices?: Array<{ message?: { annotations?: Annotation[] } }>; usage?: { cost?: number; cost_details?: { upstream_inference_cost?: number | null } }; error?: unknown } | null;
  let body: Body;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json", "X-Title": "Openscholar assistant web search" },
      body: JSON.stringify({
        model: WEB_SEARCH_MODEL,
        max_tokens: WEB_SEARCH_MODEL_TOKENS,
        usage: { include: true },
        plugins: [{ id: "web", engine: WEB_SEARCH_ENGINE, max_results: WEB_SEARCH_MAX_RESULTS }],
        messages: [{ role: "user", content: `List the sources you found, one line each: ${query}` }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    body = (await response.json().catch(() => null)) as Body;
    if (response.ok && body?.choices) break;
    console.error("[web search] OpenRouter failed", { attempt, status: response.status, error: body?.error ?? body });
    // Busy or down for a moment (one provider serves the model): tried again. A failed request costs nothing.
    const wait = response.status === 429 || response.status >= 500 ? RETRY_MS[attempt] : undefined;
    if (wait === undefined) throw createError("AI_PROVIDER_ERROR", "The web search didn't go through. Try again in a moment.");
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  const seen = new Set<string>();
  const results = (body.choices[0]?.message?.annotations ?? []).flatMap((annotation) => {
    const cited = annotation.type === "url_citation" ? annotation.url_citation : undefined;
    if (!cited?.url || seen.has(cited.url)) return [];
    seen.add(cited.url);
    return [{ title: cited.title?.trim() || cited.url, url: cited.url, excerpt: (cited.content ?? "").replace(/\s+/g, " ").trim().slice(0, EXCERPT_CHARS) }];
  });
  // What the search cost, the provider's charge included when it ran on our own key.
  return { results: results.slice(0, WEB_RESULTS_MAX), usd: openRouterUsageCost(body.usage) };
}

export const searchAction = defineUserAction({
  path: "research/web:search",
  description:
    "Searches the web for pages outside the scholarly literature: reports, policy documents, guidance, statistics, news and organisations' own pages. " +
    "Returns up to 5 pages, each with its title, address and an excerpt of what it says. Search OpenAlex for papers instead. " +
    "Cite what you use as a link to its address. The person is asked first, with what a search costs.",
  args: { query: v.string() },
  returns: v.object({ query: v.string(), results: webResultsValidator }),
  spendsCredits: true,
  outsideEffect: false,
  undoable: false,
  estimate: async () => convertUsdToCredits({ usd: WEB_SEARCH_HOLD_USD }),
  check: async (_ctx, _actor, { query }) => {
    if (!query.trim()) throw createError("VALIDATION_ERROR", "A web search needs a query.");
    if (query.length > QUERY_MAX) throw createError("VALIDATION_ERROR", `A web search query can be up to ${QUERY_MAX} characters.`);
  },
  run: async (ctx, { userId, workspaceId }, { query }, call): Promise<{ query: string; results: Result[] }> => {
    const chargeId = `web:${call?.stepId ?? call?.from ?? crypto.randomUUID()}`;
    const held = convertUsdToCredits({ usd: WEB_SEARCH_HOLD_USD });
    if (!(await reserveCredits(ctx, { userId, workspaceId, chargeId, credits: held }))) throw createError("INSUFFICIENT_CREDITS", "There aren't enough credits for a web search.");
    try {
      const { results, usd } = await searchWeb(query.trim());
      const spent = usd ?? WEB_SEARCH_HOLD_USD;
      await settleCredits(ctx, { userId, workspaceId, chargeId, credits: convertUsdToCredits({ usd: spent }), usage: { kind: "search", description: "Web search", model: WEB_SEARCH_MODEL, costUsd: spent } });
      return { query: query.trim(), results };
    } catch (error) {
      await releaseCredits(ctx, { chargeId }).catch(() => {});
      throw error;
    }
  },
});
export const search = userAction(searchAction);
export const searchForAssistant = assistantAction(searchAction);
