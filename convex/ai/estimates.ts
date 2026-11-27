import { v } from "convex/values";
import { query } from "../_generated/server";
import { getCurrentUser } from "../lib/auth";
import { taskPricing } from "./serverModel";
import { workingIn } from "../workspaces/actor";
import { AI_TASKS, type AiTask } from "../../lib/ai/tasks";
import { CALL_TOKENS, estimateCredits } from "../../lib/pricing";

/**
 * What one call of each kind costs the signed-in person at most, on the model each task runs on
 * for them: a helper (a search, a translation, writing questions) and a paper (screening or
 * translating one). The browser checks their balance against these before it asks for work
 * (lib/ai/client/hook-factory.ts), as the server holds them. Null when signed out.
 */
const figures = v.object({ helper: v.number(), paper: v.number(), usual: v.number() });

export const mine = query({
  // The page's workspace, whose preset an organization's work runs on (#651); none, the person's own.
  args: { workspaceId: v.optional(v.id("workspaces")) },
  returns: v.union(v.null(), v.object(Object.fromEntries(AI_TASKS.map((task) => [task, figures])) as Record<AiTask, typeof figures>)),
  handler: async (ctx, { workspaceId }) => {
    const working = await workingIn(ctx, await getCurrentUser(ctx), workspaceId);
    if (!working) return null;
    const each = await Promise.all(
      AI_TASKS.map(async (task) => {
        const pricing = await taskPricing(ctx, working, task);
        return [task, { helper: estimateCredits(pricing, CALL_TOKENS.helper), paper: estimateCredits(pricing, CALL_TOKENS.paper), usual: estimateCredits(pricing, CALL_TOKENS.helperUsual) }] as const;
      }),
    );
    return Object.fromEntries(each) as Record<AiTask, { helper: number; paper: number; usual: number }>;
  },
});
