"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { resolveOpenRouterModel } from "../ai/provider";
import { releaseCredits, reserveCredits, settleCredits, tokenDetails } from "../billing/charge";
import { spender } from "../paperSets/search";
import { captureUserGenerationLater } from "../lib/analyticsEvents";
import { convertUsdToCredits } from "../../lib/pricing";
import { CALL_TOKENS, estimateCredits } from "../../lib/pricing/estimate";
import { runArgs } from "./overviews";
import { writeOverview } from "./overviewWriter";

/**
 * Writes a signed-in person's AI overview of a search through a lens (#967) on their model for overviews
 * (./overviewWriter.ts), storing its whole lines as they're written. A paid one holds its estimate first and is charged
 * what it cost. ./overviews.ts decides whether it runs.
 */
export const run = internalAction({
  args: runArgs,
  returns: v.null(),
  handler: async (ctx, { overviewId, startedAt, locale, request, instruction, modelId, effort }) => {
    const start = await ctx.runMutation(internal.research.overviews.startRun, { overviewId, startedAt });
    if (!start) return null;
    const { userId, workspaceId, paid } = start;
    const chargeId = `overview:${overviewId}:${Date.now()}`;
    const began = Date.now();
    let held = false;
    let settled = false;
    let modelSlug = "";
    try {
      const resolved = await resolveOpenRouterModel(ctx, modelId);
      modelSlug = resolved.modelSlug;
      if (paid) {
        held = await reserveCredits(ctx, { userId, workspaceId, chargeId, credits: estimateCredits(resolved.pricing, CALL_TOKENS.overview) });
        if (!held) throw new Error("Not enough credits for an overview");
      }
      const written = await writeOverview({
        request,
        instruction,
        locale: locale ?? "en-US",
        resolved,
        ...(effort ? { effort } : {}),
        spend: spender(ctx, start.clerkId),
        progress: (update) => ctx.runMutation(internal.research.overviews.progress, { overviewId, startedAt, ...update } as never),
        logId: overviewId,
      });
      const { text, usd, usage } = written;
      const credits = paid ? convertUsdToCredits({ usd }) || 1 : 0;
      // Charged only when this run is still the one writing the overview: one a newer run replaced is released instead.
      const kept = await ctx.runMutation(internal.research.overviews.finishRun, { overviewId, startedAt, text });
      if (paid && kept) {
        await settleCredits(ctx, { userId, workspaceId, chargeId, credits, usage: { kind: "search", description: "AI overview", model: modelSlug, ...tokenDetails(usage), costUsd: usd } });
        settled = true;
      }
      await captureUserGenerationLater(ctx, userId, {
        provider: "openrouter",
        modelId: modelSlug,
        feature: "AI overview",
        usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
        latencyMs: Date.now() - began,
        creditsDeducted: credits,
        metadata: { paid, counts: written.counts, lists: written.lists, $ai_total_cost_usd: usd },
      });
      console.log(JSON.stringify({ event: "search-overview", overviewId, workspaceId, userId, model: modelSlug, effort: effort ?? null, paid, credits, usd, counts: written.counts, lists: written.lists, chars: text.length, ms: Date.now() - began, usage }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ event: "search-overview-failed", overviewId, workspaceId, userId, paid, ms: Date.now() - began, error: error instanceof Error ? `${error.name}: ${message}` : message }));
      await ctx.runMutation(internal.research.overviews.finishRun, { overviewId, startedAt, error: held || !paid ? "failed" : "credits" });
      if (modelSlug) await captureUserGenerationLater(ctx, userId, { provider: "openrouter", modelId: modelSlug, feature: "AI overview", usage: {}, latencyMs: Date.now() - began, isError: true, metadata: { paid } });
    } finally {
      if (held && !settled) await releaseCredits(ctx, { chargeId }).catch(() => {});
    }
    return null;
  },
});
