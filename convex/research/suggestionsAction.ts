"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { resolveOpenRouterModel } from "../ai/provider";
import { executeAIOperation, getSuggestSearchesConfig } from "../../lib/ai/core";

/**
 * Writes a person's suggested searches (#964) when the refresh their last search asked for is
 * due, on our key: the set is never charged to credits. ./suggestions.ts decides whether it runs.
 */
export const refresh = internalAction({
  args: { workspaceId: v.id("workspaces"), userId: v.id("users"), dueAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { workspaceId, userId, dueAt }) => {
    const start = await ctx.runMutation(internal.research.suggestions.startRefresh, { workspaceId, userId, dueAt });
    if (!start) return null;
    const began = Date.now();
    try {
      const { model, modelSlug } = await resolveOpenRouterModel(ctx, start.modelId);
      const { output, usage } = await executeAIOperation({ model, effort: start.effort, ...getSuggestSearchesConfig({ searches: start.searches }) });
      const suggestions = output.suggestions.flatMap(({ question, from }) => (start.searches[from] === undefined ? [] : [{ question, from: start.searches[from] }]));
      console.log(JSON.stringify({ event: "search-suggestions", workspaceId, userId, model: modelSlug, effort: start.effort ?? null, searches: start.searches.length, written: suggestions.length, ms: Date.now() - began, usage }));
      await ctx.runMutation(internal.research.suggestions.finishRefresh, { workspaceId, userId, suggestions });
    } catch (error) {
      console.error(JSON.stringify({ event: "search-suggestions-failed", workspaceId, userId, ms: Date.now() - began, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }));
      await ctx.runMutation(internal.research.suggestions.finishRefresh, { workspaceId, userId });
    }
    return null;
  },
});
