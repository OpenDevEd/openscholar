"use node";

import { action } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { internal, api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  AIUnauthenticatedError,
  AIInsufficientCreditsError,
  calculateCostInDollars,
  dollarsToCredits,
  executeAIOperation,
  type Usage,
} from "../../lib/ai/core";
import { SERVER_AI_CONFIG } from "./config";
import { getProviderModel } from "../../lib/ai/client/providers";
import type { AIProvider } from "../../lib/types/ai.types";
import type { OperationConfig } from "../../lib/ai/core/configs";
import { type PropertyValidators, type ObjectType } from "convex/values";

export async function getModel() {
  const provider = SERVER_AI_CONFIG.provider;
  // Vercel AI SDK automatically handles API keys from environment variables
  // (e.g. OPENAI_API_KEY, ANTHROPIC_API_KEY)
  // Pass undefined to signal that we should rely on env vars
  return getProviderModel(provider as AIProvider, undefined, SERVER_AI_CONFIG.model);
}

/**
 * Batch-aware auth and credits wrapper.
 * Checks auth/credits once, runs the batch handler, then deducts credits based on total usage.
 */
export async function withAuthAndCreditsBatch<T>(
  ctx: ActionCtx,
  operation: string,
  handler: (user: Doc<"users">) => Promise<{ result: T; totalUsage: Usage }>
): Promise<T> {
  const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
  if (!user) throw new AIUnauthenticatedError();

  const balance = await ctx.runQuery(api.credits.queries.getMyBalance);
  if (!balance || balance.total <= 0) {
    throw new AIInsufficientCreditsError();
  }

  const { result, totalUsage } = await handler(user);

  const costDollars = calculateCostInDollars(totalUsage, SERVER_AI_CONFIG.provider as AIProvider, SERVER_AI_CONFIG.model);
  const creditsToDeduct = Math.max(1, dollarsToCredits(costDollars));

  await ctx.runMutation(internal.credits.internal.deductCredits, {
    userId: user._id,
    amount: creditsToDeduct,
    description: `AI: ${operation}`,
  });

  return result;
}

/**
 * Credits wrapper for background jobs (internalActions) where we already know the userId.
 * Use this when auth context is not available (scheduled jobs, internal actions).
 */
export async function withUserCreditsBatch<T>(
  ctx: ActionCtx,
  userId: Id<"users">,
  operation: string,
  handler: () => Promise<{ result: T; totalUsage: Usage }>
): Promise<T> {
  // Get user by ID (no auth check needed - we trust the userId passed from the parent action)
  const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
  if (!user) throw new AIUnauthenticatedError();

  // Check credits for this user
  const balance = await ctx.runQuery(internal.credits.internal.getBalanceByUserId, { userId });
  if (!balance || balance.total <= 0) {
    throw new AIInsufficientCreditsError();
  }

  const { result, totalUsage } = await handler();

  const costDollars = calculateCostInDollars(totalUsage, SERVER_AI_CONFIG.provider as AIProvider, SERVER_AI_CONFIG.model);
  const creditsToDeduct = Math.max(1, dollarsToCredits(costDollars));

  await ctx.runMutation(internal.credits.internal.deductCredits, {
    userId,
    amount: creditsToDeduct,
    description: `AI: ${operation}`,
  });

  return result;
}

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

  const costDollars = calculateCostInDollars(usage, SERVER_AI_CONFIG.provider as AIProvider, SERVER_AI_CONFIG.model);
  const creditsToDeduct = Math.max(1, dollarsToCredits(costDollars));

  await ctx.runMutation(internal.credits.internal.deductCredits, {
    userId: user._id,
    amount: creditsToDeduct,
    description: `AI: ${operation}`,
  });

  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAIAction<
  Args extends PropertyValidators,
  Output,
  AIOutput
>(
  argsValidator: Args,
  // Using 'any' for Convex validator due to complex internal type inference
  returnsValidator: any,
  description: string,
  configFactory: (args: ObjectType<Args>) => OperationConfig<ObjectType<Args>, AIOutput>,
  formatOutput: (output: AIOutput, args: ObjectType<Args>) => Output
) {
  return action({
    args: argsValidator,
    returns: returnsValidator,
    handler: async (ctx, args: ObjectType<Args>) => {
      return withAuthAndCredits(ctx, description, async () => {
        const model = await getModel();
        const config = configFactory(args);
        
        const { output, usage } = await executeAIOperation({
          model,
          ...config,
        });

        return {
          result: formatOutput(output, args),
          usage,
        };
      });
    },
  });
}
