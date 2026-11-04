"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { captureGenerationLater } from "../lib/analyticsEvents";
import { executeAIOperation, getEnhanceQueryConfig } from "../../lib/ai/core";
import { calculateCostInDollars } from "../../lib/ai/core/cost";
import { FREE_QUERY_MAX_OUTPUT_TOKENS, FREE_QUERY_MAX_RETRIES, FREE_QUESTION_MAX } from "../../lib/ai/free-queries";
import type { AIProvider } from "../../lib/types/ai.types";
import { resolveOpenRouterModel } from "./provider";

type FreeQueryAnswer = { ok: true; query: string } | { ok: false; reason: "off" | "limit" | "unavailable" | "failed" };

/**
 * Writes a search query from a research question on our key, for someone who can't pay for it
 * (lib/ai/free-queries.ts). Only app/actions/free-queries.ts calls this, with the shared secret:
 * it's what knows who's asking, and a function anyone could call could claim to be any address.
 */
export const write = action({
  args: {
    secret: v.string(),
    who: v.union(v.object({ person: v.string() }), v.object({ address: v.string() })),
    question: v.string(),
    language: v.optional(v.string()),
    syntax: v.optional(v.literal("oql")),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), query: v.string() }),
    v.object({ ok: v.literal(false), reason: v.union(v.literal("off"), v.literal("limit"), v.literal("unavailable"), v.literal("failed")) }),
  ),
  handler: async (ctx, { secret, who, question, language, syntax }): Promise<FreeQueryAnswer> => {
    const expected = process.env.FREE_QUERIES_SECRET;
    if (!expected || secret !== expected) throw createError("FORBIDDEN", "Not allowed");
    const claim = await ctx.runMutation(internal.ai.freeQueries.claim, { who });
    if (claim.kind !== "go") return { ok: false as const, reason: claim.kind };

    const audience = "person" in who ? "signedIn" as const : "signedOut" as const;
    const day = new Date().toISOString().slice(0, 10);
    const began = Date.now();
    // Every call the question took, a retried or failed one too.
    let costUsd = 0;
    try {
      const { model, modelSlug, pricing } = await resolveOpenRouterModel(ctx, claim.modelId);
      const config = getEnhanceQueryConfig({ query: question.slice(0, FREE_QUESTION_MAX), language, syntax });
      const { output, usage } = await executeAIOperation({
        model,
        effort: claim.effort,
        ...config,
        ...(config.retryConfig && { retryConfig: { ...config.retryConfig, maxRetries: FREE_QUERY_MAX_RETRIES } }),
        maxOutputTokens: FREE_QUERY_MAX_OUTPUT_TOKENS,
        onUsage: (used) => {
          costUsd += calculateCostInDollars(used, pricing);
        },
      });
      console.log(JSON.stringify({ event: "free-query", audience, model: modelSlug, effort: claim.effort ?? null, ms: Date.now() - began, costUsd }));
      await ctx.runMutation(internal.ai.freeQueries.record, { audience, day, costUsd, failed: false });
      await captureGenerationLater(ctx, {
        distinctId: "person" in who ? who.person : "free-queries-signed-out",
        provider: "openrouter" as AIProvider,
        modelId: modelSlug,
        feature: "Free question to query",
        usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 },
        latencyMs: Date.now() - began,
        temperature: config.temperature,
        creditsDeducted: 0,
      });
      return { ok: true as const, query: output.enhancedQuery };
    } catch (error) {
      console.error(JSON.stringify({ event: "free-query-failed", audience, ms: Date.now() - began, costUsd, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }));
      await ctx.runMutation(internal.ai.freeQueries.record, { audience, day, costUsd, failed: true });
      return { ok: false as const, reason: "failed" as const };
    }
  },
});
