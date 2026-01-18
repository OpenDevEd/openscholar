"use node";

import type { ActionCtx } from "../_generated/server";
import { internal, api } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import {
  AIUnauthenticatedError,
  AIInsufficientCreditsError,
  calculateCostInDollars,
  dollarsToCredits,
  DEEPSEEK_PRICING,
  type Usage,
} from "@/lib/ai/core";

export async function withAuthAndCredits<T>(
  ctx: ActionCtx,
  operation: string,
  handler: (user: Doc<"users">) => Promise<{ result: T; usage: Usage }>
): Promise<T> {
  const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
  if (!user) throw new AIUnauthenticatedError();

  const balance = await ctx.runQuery(api.credits.queries.getMyBalance);
  if (!balance || balance.total <= 0) {
    throw new AIInsufficientCreditsError();
  }

  const { result, usage } = await handler(user);

  const costDollars = calculateCostInDollars(usage, DEEPSEEK_PRICING);
  const creditsToDeduct = Math.max(1, dollarsToCredits(costDollars));

  await ctx.runMutation(internal.credits.internal.deductCredits, {
    userId: user._id,
    amount: creditsToDeduct,
    description: `AI: ${operation}`,
  });

  return result;
}
