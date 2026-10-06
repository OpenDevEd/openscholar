import { v } from "convex/values";
import { query } from "../_generated/server";
import { getCurrentUser } from "../lib/auth";
import { taskPricing } from "./serverModel";
import { AI_TASKS, type AiTask } from "../../lib/ai/tasks";
import { CALL_TOKENS, estimateCredits } from "../../lib/pricing";

/**
 * What one call of each kind costs the signed-in person at most, on the model each task runs on
 * for them: a helper (a search, a translation, writing questions) and a paper (screening or
 * translating one). The browser checks their balance against these before it asks for work
 * (lib/ai/client/hook-factory.ts), as the server holds them. Null when signed out.
 */
const figures = v.object({ helper: v.number(), paper: v.number() });

export const mine = query({
  args: {},
  returns: v.union(v.null(), v.object(Object.fromEntries(AI_TASKS.map((task) => [task, figures])) as Record<AiTask, typeof figures>)),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const each = await Promise.all(
      AI_TASKS.map(async (task) => {
        const pricing = await taskPricing(ctx, user._id, task);
        return [task, { helper: estimateCredits(pricing, CALL_TOKENS.helper), paper: estimateCredits(pricing, CALL_TOKENS.paper) }] as const;
      }),
    );
    return Object.fromEntries(each) as Record<AiTask, { helper: number; paper: number }>;
  },
});
