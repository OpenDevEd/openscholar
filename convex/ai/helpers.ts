"use node";

import { action } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { internal, api } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import {
  AIUnauthenticatedError,
  AIInsufficientCreditsError,
  calculateCostInDollars,
  dollarsToCredits,
  executeAIOperation,
  type Usage,
} from "@/lib/ai/core";
import { SERVER_AI_CONFIG } from "./config";
import { getProviderModel } from "@/lib/ai/client/providers";
import type { AIProvider } from "@/lib/types/ai.types";
import type { OperationConfig } from "@/lib/ai/core/configs";
import { type PropertyValidators, type ObjectType } from "convex/values";

export async function getModel() {
  const provider = SERVER_AI_CONFIG.provider;
  // Vercel AI SDK automatically handles API keys from environment variables
  // (e.g. OPENAI_API_KEY, ANTHROPIC_API_KEY)
  // Pass undefined to signal that we should rely on env vars
  return getProviderModel(provider as AIProvider, undefined, SERVER_AI_CONFIG.model);
}

/**
 * Aggregates multiple Usage objects into a single total.
 */
export function aggregateUsage(usages: Usage[]): Usage {
  return usages.reduce(
    (acc, usage) => ({
      promptTokens: (acc.promptTokens || 0) + (usage.promptTokens || 0),
      inputTokens: (acc.inputTokens || 0) + (usage.inputTokens || 0),
      completionTokens: (acc.completionTokens || 0) + (usage.completionTokens || 0),
      outputTokens: (acc.outputTokens || 0) + (usage.outputTokens || 0),
    }),
    { promptTokens: 0, inputTokens: 0, completionTokens: 0, outputTokens: 0 } as Usage
  );
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

export function createAIAction<
  Args extends PropertyValidators,
  Output,
  AIOutput
>(
  argsValidator: Args,
  returnsValidator: any,
  description: string,
  configFactory: (args: ObjectType<Args>) => OperationConfig<ObjectType<Args>, AIOutput>,
  formatOutput: (output: AIOutput, args: ObjectType<Args>) => Output
) {
  return action({
    args: argsValidator,
    returns: returnsValidator,
    handler: async (ctx, args: any) => {
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
