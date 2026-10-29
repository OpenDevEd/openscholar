/**
 * Suggested searches on the home page (#964). A saved search asks for a new set a minute later
 * (./suggestionRefresh.ts); ./suggestionsAction.ts writes it on the Cheap preset's model, at
 * most as many times a day as the workspace's plan allows, and the page reads the set here.
 */
import { v } from "convex/values";
import { internalMutation, type MutationCtx, type QueryCtx } from "../lib/functions";
import type { Id } from "../_generated/dataModel";
import { accountQuery, assistantQuery, defineUserQuery } from "../lib/userActions";
import { planLimit } from "../billing/accounts";
import { rateLimit } from "../lib/rateLimit";
import { presetPick } from "../ai/serverModel";
import { effortValidator } from "../aiModelConfig/validators";
import { currentSearch } from "../../lib/research/records";
import { FROM_MAX, QUESTION_MAX, SUGGESTIONS_SHOWN, suggestionValidator, suggestionsValidator } from "./suggestionValidators";

/** The recent searches a set is written from. */
const RECENT_SEARCHES = 10;
/** Characters of each search the model reads. */
const SEARCH_MAX = 400;
const DAY = 24 * 60 * 60 * 1000;

const rowOf = (ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces">, userId: Id<"users">) =>
  ctx.db.query("searchSuggestions").withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId)).unique();

export const mineAction = defineUserQuery({
  path: "research/suggestions:mine",
  description:
    "The research questions suggested to the person on the home page, written from their own recent searches in the workspace, each with the search it builds on. `refreshing` is true while a new set is being written. Null before their first search.",
  args: {},
  returns: v.union(v.null(), v.object({ suggestions: suggestionsValidator, refreshing: v.boolean() })),
  run: async (ctx, { userId, workspaceId }) => {
    const row = await rowOf(ctx, workspaceId, userId);
    return row ? { suggestions: row.suggestions, refreshing: row.generating } : null;
  },
});
export const mine = accountQuery(mineAction);
export const mineForAssistant = assistantQuery(mineAction);

/**
 * Starts the refresh a search asked for at `dueAt`, if it's still the latest one asked for and the
 * plan allows another set today: marks the set as being written and returns what to write it from.
 */
export const startRefresh = internalMutation({
  args: { workspaceId: v.id("workspaces"), userId: v.id("users"), dueAt: v.number() },
  returns: v.union(v.null(), v.object({ searches: v.array(v.string()), modelId: v.id("models"), effort: v.optional(effortValidator) })),
  handler: async (ctx, { workspaceId, userId, dueAt }) => {
    const row = await rowOf(ctx, workspaceId, userId);
    if (!row || row.dueAt !== dueAt) return null;
    const searches = (await ctx.db.query("searches").withIndex("by_workspace_and_createdBy_and_createdAt", (q) => q.eq("workspaceId", workspaceId).eq("createdBy", userId)).order("desc").take(RECENT_SEARCHES))
      .map((row) => { const search = currentSearch(row.data); return (search.latestQuestion || search.query).trim().slice(0, SEARCH_MAX); })
      .filter((text, index, all) => text && all.indexOf(text) === index);
    const pick = await presetPick(ctx, "cheap", "questionToQuery");
    const perDay = await planLimit(ctx, workspaceId, "suggestions_per_day");
    if (!searches.length || !pick || perDay === 0) return await done(ctx, row._id);
    if (perDay !== undefined) {
      const { ok } = await rateLimit(ctx, { name: "search-suggestions", key: `${userId}:${workspaceId}`, config: { kind: "token bucket", rate: perDay, period: DAY, capacity: perDay } });
      // Past the plan's number for today, the last set stays.
      if (!ok) return await done(ctx, row._id);
    }
    await ctx.db.patch("searchSuggestions", row._id, { generating: true });
    // The lowest effort the model takes, whatever the preset sets.
    const effort = (await ctx.db.get("models", pick.modelId))?.reasoningEfforts?.[0];
    return { searches, modelId: pick.modelId, ...(effort && { effort }) };
  },
});

async function done(ctx: MutationCtx, id: Id<"searchSuggestions">) {
  await ctx.db.patch("searchSuggestions", id, { generating: false });
  return null;
}

/** Stores a new set, or with none, only ends the refresh and keeps the last set. */
export const finishRefresh = internalMutation({
  args: { workspaceId: v.id("workspaces"), userId: v.id("users"), suggestions: v.optional(v.array(suggestionValidator)) },
  returns: v.null(),
  handler: async (ctx, { workspaceId, userId, suggestions }) => {
    const row = await rowOf(ctx, workspaceId, userId);
    if (!row) return null;
    const kept = suggestions?.slice(0, SUGGESTIONS_SHOWN).map(({ question, from }) => ({ question: question.trim().slice(0, QUESTION_MAX), from: from.slice(0, FROM_MAX) }));
    await ctx.db.patch("searchSuggestions", row._id, { generating: false, ...(kept?.length && { suggestions: kept }) });
    return null;
  },
});
