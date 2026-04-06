"use node";

import { action } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { internal, api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  AIError,
  AIApiKeyRequiredError,
  AIUnauthenticatedError,
  AIInsufficientCreditsError,
  AIPlanEntitlementError,
  AIValidationError,
  AIProviderError,
  AIMaxRetriesExceededError,
  executeAIOperation,
  type Usage,
} from "../../lib/ai/core";
import { SERVER_AI_CONFIG } from "./config";
import { getProviderModel } from "../../lib/ai/server/providers";
import type { AIProvider } from "../../lib/types/ai.types";
import type { OperationConfig } from "../../lib/ai/core/configs";
import { type PropertyValidators, type ObjectType, type GenericValidator } from "convex/values";
import { captureAIGenerationServer } from "../../lib/posthog-server";
import { AI_COST_MARKUP } from "../lib/constants";
import { createError } from "../lib/errors";

import {
  calculateCreditsToDeductFromUsage,
  convertUsdCostToCredits,
} from "./lib/creditBilling";

const MAX_TRACKING_CONTENT_LENGTH = 2000;

function truncateForTracking(s: string): string {
  if (s.length <= MAX_TRACKING_CONTENT_LENGTH) return s;
  return s.slice(0, MAX_TRACKING_CONTENT_LENGTH) + "...[truncated]";
}

function hasStructuredConvexCode(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const data = (error as { data?: unknown }).data;
  return Boolean(
    data &&
      typeof data === "object" &&
      "code" in data &&
      typeof (data as { code?: unknown }).code === "string",
  );
}

function isApiKeyMissingMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("api key") && (
    normalized.includes("missing") ||
    normalized.includes("not configured") ||
    normalized.includes("not set") ||
    normalized.includes("required") ||
    normalized.includes("no key")
  );
}

function throwStructuredAIError(error: unknown): never {
  if (hasStructuredConvexCode(error)) {
    throw error;
  }

  if (error instanceof AIApiKeyRequiredError) {
    throw createError("AI_API_KEY_REQUIRED", error.message);
  }
  if (error instanceof AIUnauthenticatedError) {
    throw createError("AI_UNAUTHENTICATED", error.message);
  }
  if (error instanceof AIInsufficientCreditsError) {
    throw createError("AI_INSUFFICIENT_CREDITS", error.message);
  }
  if (error instanceof AIPlanEntitlementError) {
    throw createError("AI_PLAN_ENTITLEMENT", error.message);
  }
  if (error instanceof AIValidationError) {
    throw createError("AI_VALIDATION_ERROR", error.message);
  }
  if (error instanceof AIMaxRetriesExceededError) {
    throw createError("AI_MAX_RETRIES_EXCEEDED", error.message);
  }
  if (error instanceof AIProviderError) {
    if (isApiKeyMissingMessage(error.message)) {
      throw createError("AI_API_KEY_REQUIRED", error.message);
    }
    throw createError("AI_PROVIDER_ERROR", error.message);
  }
  if (error instanceof AIError) {
    if (error.code === "AI_API_KEY_REQUIRED") {
      throw createError("AI_API_KEY_REQUIRED", error.message);
    }
    if (error.code === "AI_UNAUTHENTICATED") {
      throw createError("AI_UNAUTHENTICATED", error.message);
    }
    if (error.code === "AI_INSUFFICIENT_CREDITS") {
      throw createError("AI_INSUFFICIENT_CREDITS", error.message);
    }
    if (error.code === "AI_PLAN_ENTITLEMENT") {
      throw createError("AI_PLAN_ENTITLEMENT", error.message);
    }
    if (error.code === "AI_VALIDATION_ERROR") {
      throw createError("AI_VALIDATION_ERROR", error.message);
    }
    if (error.code === "AI_PROVIDER_ERROR") {
      throw createError("AI_PROVIDER_ERROR", error.message);
    }
    if (error.code === "AI_MAX_RETRIES_EXCEEDED") {
      throw createError("AI_MAX_RETRIES_EXCEEDED", error.message);
    }
  }

  if (error instanceof Error) {
    if (isApiKeyMissingMessage(error.message)) {
      throw createError("AI_API_KEY_REQUIRED", error.message);
    }
    throw createError("AI_PROVIDER_ERROR", error.message);
  }

  throw createError("AI_PROVIDER_ERROR", String(error));
}

export async function getModel() {
  const provider = SERVER_AI_CONFIG.provider;
  // Vercel AI SDK automatically handles API keys from environment variables
  // (e.g. OPENAI_API_KEY, ANTHROPIC_API_KEY)
  // Pass undefined to signal that we should rely on env vars
  return getProviderModel(
    provider as AIProvider,
    undefined,
    SERVER_AI_CONFIG.model,
    {
      openrouterProviderOrder: SERVER_AI_CONFIG.openrouterProviderOrder,
      openrouterAllowFallbacks: SERVER_AI_CONFIG.openrouterAllowFallbacks,
    }
  );
}

export function convertServerCostDollarsToCredits(costDollars: number): number {
  return convertUsdCostToCredits(costDollars, AI_COST_MARKUP);
}

export function calculateServerCreditsToDeduct(usage: Usage): number {
  return calculateCreditsToDeductFromUsage({
    usage,
    provider: SERVER_AI_CONFIG.provider as AIProvider,
    modelId: SERVER_AI_CONFIG.model,
    markupMultiplier: AI_COST_MARKUP,
  });
}

export type UsageBreakdownEntry = {
  usage: Usage;
  description?: string;
  metadata?: Record<string, string>;
};

/**
 * Batch-aware auth and credits wrapper.
 * Checks auth/credits once, runs the batch handler, then deducts credits based on total usage.
 * @param minimumRequired - Minimum credits required before starting (e.g. papers.length).
 *                          Each AI call costs at least 1 credit, so this prevents burning
 *                          provider cost when the user clearly can't afford the batch.
 */
export async function withAuthAndCreditsBatch<T>(
  ctx: ActionCtx,
  operation: string,
  handler: (user: Doc<"users">) => Promise<{
    result: T;
    totalUsage: Usage;
    usageBreakdown?: UsageBreakdownEntry[];
  }>,
  minimumRequired = 1,
): Promise<T> {
  try {
    const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
    if (!user) {
      throw createError("AI_UNAUTHENTICATED", "Authentication required to use AI features");
    }

    const balance = await ctx.runQuery(api.credits.queries.getMyBalance);
    if (!balance || balance.total < minimumRequired) {
      throw createError(
        "AI_INSUFFICIENT_CREDITS",
        `Insufficient credits: need at least ${minimumRequired} but have ${balance?.total ?? 0}`,
      );
    }

    const start = Date.now();
    const { result, totalUsage, usageBreakdown } = await handler(user);
    const latencyMs = Date.now() - start;

    await captureAIGenerationServer({
      distinctId: user.clerkId,
      provider: SERVER_AI_CONFIG.provider as AIProvider,
      modelId: SERVER_AI_CONFIG.model,
      feature: operation,
      usage: {
        inputTokens: totalUsage.inputTokens ?? totalUsage.promptTokens ?? 0,
        outputTokens: totalUsage.outputTokens ?? totalUsage.completionTokens ?? 0,
      },
      latencyMs,
      input: `Batch: ${operation}`,
      output: "Completed",
    });

    if (usageBreakdown && usageBreakdown.length > 0) {
      for (const entry of usageBreakdown) {
        const amount = calculateServerCreditsToDeduct(entry.usage);
        if (amount <= 0) continue;
        await ctx.runMutation(internal.credits.internal.deductCredits, {
          userId: user._id,
          amount,
          description: entry.description ?? `AI: ${operation}`,
          metadata: entry.metadata,
        });
      }
    } else {
      const creditsToDeduct = calculateServerCreditsToDeduct(totalUsage);
      await ctx.runMutation(internal.credits.internal.deductCredits, {
        userId: user._id,
        amount: creditsToDeduct,
        description: `AI: ${operation}`,
      });
    }

    return result;
  } catch (error) {
    throwStructuredAIError(error);
  }
}

/**
 * Credits wrapper for background jobs (internalActions) where we already know the userId.
 * Use this when auth context is not available (scheduled jobs, internal actions).
 */
export async function withUserCreditsBatch<T>(
  ctx: ActionCtx,
  userId: Id<"users">,
  operation: string,
  handler: () => Promise<{ result: T; totalUsage: Usage }>,
): Promise<T> {
  try {
    // Get user by ID (no auth check needed - we trust the userId passed from the parent action)
    const user = await ctx.runQuery(internal.users.internal.getUserById, {
      userId,
    });
    if (!user) {
      throw createError("AI_UNAUTHENTICATED", "Authentication required to use AI features");
    }

    // Check credits for this user
    const balance = await ctx.runQuery(
      internal.credits.internal.getBalanceByUserId,
      { userId },
    );
    if (!balance || balance.total <= 0) {
      throw createError("AI_INSUFFICIENT_CREDITS", "Insufficient credits for AI operation");
    }

    const start = Date.now();
    const { result, totalUsage } = await handler();
    const latencyMs = Date.now() - start;

    const creditsToDeduct = calculateServerCreditsToDeduct(totalUsage);

    await captureAIGenerationServer({
      distinctId: user.clerkId,
      provider: SERVER_AI_CONFIG.provider as AIProvider,
      modelId: SERVER_AI_CONFIG.model,
      feature: operation,
      usage: {
        inputTokens: totalUsage.inputTokens ?? totalUsage.promptTokens ?? 0,
        outputTokens: totalUsage.outputTokens ?? totalUsage.completionTokens ?? 0,
      },
      latencyMs,
      input: `Batch: ${operation}`,
      output: "Completed",
    });

    await ctx.runMutation(internal.credits.internal.deductCredits, {
      userId,
      amount: creditsToDeduct,
      description: `AI: ${operation}`,
    });

    return result;
  } catch (error) {
    throwStructuredAIError(error);
  }
}

export async function withAuthAndCredits<T>(
  ctx: ActionCtx,
  operation: string,
  handler: (user: Doc<"users">) => Promise<{ result: T; usage: Usage }>,
): Promise<T> {
  try {
    const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
    if (!user) {
      throw createError("AI_UNAUTHENTICATED", "Authentication required to use AI features");
    }

    const balance = await ctx.runQuery(api.credits.queries.getMyBalance);
    if (!balance || balance.total <= 0) {
      throw createError("AI_INSUFFICIENT_CREDITS", "Insufficient credits for AI operation");
    }

    const { result, usage } = await handler(user);

    const creditsToDeduct = calculateServerCreditsToDeduct(usage);

    await ctx.runMutation(internal.credits.internal.deductCredits, {
      userId: user._id,
      amount: creditsToDeduct,
      description: `AI: ${operation}`,
    });

    return result;
  } catch (error) {
    throwStructuredAIError(error);
  }
}

export function createAIAction<
  Args extends PropertyValidators,
  Output,
  AIOutput,
>(
  argsValidator: Args,
  returnsValidator: GenericValidator | PropertyValidators,
  description: string,
  configFactory: (
    args: ObjectType<Args>,
  ) => OperationConfig<ObjectType<Args>, AIOutput>,
  formatOutput: (output: AIOutput, args: ObjectType<Args>) => Output,
) {
  return action({
    args: argsValidator,
    returns: returnsValidator,
    handler: async (ctx, args: ObjectType<Args>) => {
      return withAuthAndCredits(ctx, description, async (user) => {
        const model = await getModel();
        const config = configFactory(args);
        const prompts = config.buildPrompts(config.input, 0);
        const inputForTracking = truncateForTracking(
          `[system] ${prompts.system}\n[user] ${prompts.prompt}`
        );

        const start = Date.now();
        try {
          const { output, usage } = await executeAIOperation({
            model,
            ...config,
          });
          const latencyMs = Date.now() - start;
          const outputForTracking = truncateForTracking(JSON.stringify(output));

          await captureAIGenerationServer({
            distinctId: user.clerkId,
            provider: SERVER_AI_CONFIG.provider as AIProvider,
            modelId: SERVER_AI_CONFIG.model,
            feature: description,
            usage: {
              inputTokens: usage.inputTokens ?? usage.promptTokens ?? 0,
              outputTokens: usage.outputTokens ?? usage.completionTokens ?? 0,
            },
            latencyMs,
            input: inputForTracking,
            output: outputForTracking,
          });

          return {
            result: formatOutput(output, args),
            usage,
          };
        } catch (error) {
          const latencyMs = Date.now() - start;
          await captureAIGenerationServer({
            distinctId: user.clerkId,
            provider: SERVER_AI_CONFIG.provider as AIProvider,
            modelId: SERVER_AI_CONFIG.model,
            feature: description,
            usage: { inputTokens: 0, outputTokens: 0 },
            latencyMs,
            input: inputForTracking,
            output: "",
            isError: true,
            errorMessage: error instanceof Error ? error.message : String(error),
          });
          throwStructuredAIError(error);
        }
      });
    },
  });
}

// RAG helpers removed
