/**
 * AI overviews for signed-out visitors (#1070): written on the default preset's model for overviews, a daily allowance
 * a visitor's address and a daily total for every visitor, and never stored. The Next app's /api/overviews checks the
 * visitor is a person (Cloudflare Turnstile) and vouches for their address with the shared secret, as
 * app/actions/free-queries.ts does; this streams the overview back to it as lines of JSON.
 */
import { v } from "convex/values";
import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { internalMutation, internalQuery } from "../lib/functions";
import { rateLimit } from "../lib/rateLimit";
import { activeSource } from "../lib/searchSource";
import { captureGenerationLater } from "../lib/analyticsEvents";
import { effortValidator } from "../aiModelConfig/validators";
import { presetPick } from "../ai/serverModel";
import { resolveOpenRouterModel } from "../ai/provider";
import { searchRequestValidator } from "../paperSets/openalex";
import { spender } from "../paperSets/search";
import { FLAG_REGISTRY } from "../../lib/feature-flags/registry";
import { DEFAULT_PRESET } from "../../lib/ai/tasks";
import { parseSearchParamsFromUrl } from "../../lib/search-params/parsers";
import { paramsToBucketSearchFilters } from "../../lib/bucket/search-filters";
import { isRatingFilterActive } from "../../lib/search/rating-filter";
import { locales } from "../../i18n/config";
import { BUILT_IN_LENSES, SIGNED_OUT_PER_ADDRESS } from "./overviewValidators";
import { writeOverview } from "./overviewWriter";

export const SIGNED_OUT_OVERVIEWS_FLAG = "overviews.signedOut";
/** Overviews all signed-out visitors get a day together: what caps their cost. */
export const SIGNED_OUT_PER_DAY = 2_000;
/** The longest search address it reads. */
const PARAMS_MAX = 4_000;

const DAY_MS = 24 * 60 * 60 * 1000;
/** A fixed UTC day, as free question-to-query counts one (convex/ai/freeQueries.ts). */
const perUtcDay = (perDay: number) => ({ kind: "fixed window" as const, rate: perDay, period: DAY_MS, start: 0 });

/** The OpenAlex request a visitor's search makes, from its address, or why it has no overview, as ./overviews.ts decides it. */
export const prepare = internalQuery({
  args: { params: v.string() },
  returns: v.union(v.object({ request: searchRequestValidator }), v.object({ reason: v.union(v.literal("oql"), v.literal("ratings")) })),
  handler: async (ctx, { params: address }) => {
    const params = parseSearchParamsFromUrl(new URLSearchParams(address));
    // A visitor's ratings stay in their browser, where no count can read them.
    if (isRatingFilterActive([params.rmin, params.rmax], params.rated)) return { reason: "ratings" as const };
    // A visitor has no shortcuts of their own to expand.
    const filters = paramsToBucketSearchFilters(params, { expand: (query) => ({ expandedQuery: query, warnings: [] }) });
    const request = filters && { ...filters.openAlexQuery, source: await activeSource(ctx) };
    if (!request || request.oql || (request.source === "openscholar" && (request.semantic || request.similarTo))) return { reason: "oql" as const };
    return { request };
  },
});

/** Whether a visitor's overview may run, counting it if so: their own allowance first, so one over it can't use up the day's total. */
export const claim = internalMutation({
  args: { address: v.string() },
  returns: v.union(
    v.object({ kind: v.literal("go"), modelId: v.id("models"), effort: v.optional(effortValidator) }),
    v.object({ kind: v.union(v.literal("off"), v.literal("limit"), v.literal("unavailable")) }),
  ),
  handler: async (ctx, { address }) => {
    const flag = await ctx.db.query("featureFlags").withIndex("by_key", (q) => q.eq("key", SIGNED_OUT_OVERVIEWS_FLAG)).unique();
    if (!(flag?.enabled ?? FLAG_REGISTRY[SIGNED_OUT_OVERVIEWS_FLAG].enabled)) return { kind: "off" as const };
    const pick = await presetPick(ctx, DEFAULT_PRESET, "overview");
    if (!pick) {
      console.error(JSON.stringify({ event: "signed-out-overview-model-unavailable", preset: DEFAULT_PRESET }));
      return { kind: "unavailable" as const };
    }
    if (!(await rateLimit(ctx, { name: "overview-address", key: address, config: perUtcDay(SIGNED_OUT_PER_ADDRESS) })).ok) return { kind: "limit" as const };
    if (!(await rateLimit(ctx, { name: "overview-signed-out", key: "all", config: perUtcDay(SIGNED_OUT_PER_DAY) })).ok) {
      console.warn(JSON.stringify({ event: "signed-out-overview-daily-total-reached", perDay: SIGNED_OUT_PER_DAY }));
      return { kind: "limit" as const };
    }
    return { kind: "go" as const, modelId: pick.modelId, ...(pick.effort ? { effort: pick.effort } : {}) };
  },
});

const LENSES = new Map<string, string>(BUILT_IN_LENSES.map((lens) => [lens.id, lens.instruction]));
const json = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const lines = (...parts: object[]) =>
  new Response(parts.map((part) => `${JSON.stringify(part)}\n`).join(""), { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });

/**
 * `POST /overviews/signed-out`, from the Next app only: `{ address, params, lens, locale }`, the address hashed. It
 * answers lines of JSON: a run's steps, counts, paper lists and whole text as they come, then `{"done":true}`; or one
 * line saying why there's none: `unavailable` (with its reason), `limit`, `off`, or `failed`.
 */
export const stream = httpAction(async (ctx, request) => {
  const secret = process.env.FREE_QUERIES_SECRET;
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) return json(401, { error: "unauthorized" });
  const body = (await request.json().catch(() => null)) as { address?: unknown; params?: unknown; lens?: unknown; locale?: unknown } | null;
  const { address, params, lens, locale } = body ?? {};
  if (
    typeof address !== "string" || !/^[0-9a-f]{64}$/.test(address) ||
    typeof params !== "string" || params.length > PARAMS_MAX ||
    typeof lens !== "string" || !LENSES.has(lens) ||
    typeof locale !== "string" || !(locales as readonly string[]).includes(locale)
  ) return json(400, { error: "invalid_request" });

  const prepared = await ctx.runQuery(internal.research.signedOutOverviews.prepare, { params });
  if ("reason" in prepared) return lines({ unavailable: prepared.reason });
  const claimed = await ctx.runMutation(internal.research.signedOutOverviews.claim, { address });
  // A model nobody can run is a failure the visitor can try again, unlike a search no overview can count.
  if (claimed.kind !== "go") return lines(claimed.kind === "unavailable" ? { failed: true } : { [claimed.kind]: true });

  const encoder = new TextEncoder();
  const parts = new ReadableStream<Uint8Array>({
    async start(controller) {
      // A visitor who leaves closes the stream; the run goes on so it's counted and its cost known.
      const send = (part: object) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(part)}\n`));
        } catch {
          // Gone.
        }
      };
      const began = Date.now();
      let modelSlug = "";
      try {
        const resolved = await resolveOpenRouterModel(ctx, claimed.modelId);
        modelSlug = resolved.modelSlug;
        const written = await writeOverview({
          request: prepared.request,
          instruction: LENSES.get(lens)!,
          locale,
          resolved,
          ...(claimed.effort ? { effort: claimed.effort } : {}),
          // The visitor's OpenAlex allowance, counted by their address as their searches are.
          spend: spender(ctx, `visitor:${address}`),
          progress: async (update) => send(update),
          logId: "signed-out",
        });
        send({ text: written.text, done: true });
        await captureGenerationLater(ctx, {
          distinctId: "overviews-signed-out",
          provider: "openrouter",
          modelId: modelSlug,
          feature: "AI overview, signed out",
          usage: { inputTokens: written.usage.inputTokens, outputTokens: written.usage.outputTokens },
          latencyMs: Date.now() - began,
          creditsDeducted: 0,
          metadata: { lens, counts: written.counts, lists: written.lists, $ai_total_cost_usd: written.usd },
        });
        console.log(JSON.stringify({ event: "signed-out-overview", lens, model: modelSlug, usd: written.usd, counts: written.counts, lists: written.lists, chars: written.text.length, ms: Date.now() - began }));
      } catch (error) {
        console.error(JSON.stringify({ event: "signed-out-overview-failed", lens, ms: Date.now() - began, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }));
        send({ failed: true });
        if (modelSlug) await captureGenerationLater(ctx, { distinctId: "overviews-signed-out", provider: "openrouter", modelId: modelSlug, feature: "AI overview, signed out", usage: {}, latencyMs: Date.now() - began, isError: true, metadata: { lens } });
      } finally {
        try {
          controller.close();
        } catch {
          // Gone.
        }
      }
    },
  });
  return new Response(parts, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
});
