"use node";

import { action } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
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
import { resolveOpenRouterModel } from "../chat/provider";
import type { AIProvider } from "../../lib/types/ai.types";
import type { OperationConfig } from "../../lib/ai/core/configs";
import { type PropertyValidators, type ObjectType, type GenericValidator } from "convex/values";
import {
  type AITrackingEntry,
  truncateForTracking,
  extractHttpStatus,
  extractErrorCode,
} from "../../lib/posthog-ai-shared";
import { ESTIMATED_CREDITS_PER_QUERY } from "../lib/constants";
import { createError } from "../lib/errors";
import { creditsForUsage } from "../../lib/pricing";
import { reserveCredits, releaseCredits, settleCredits, tokenDetails } from "../billing/charge";
import type { Effort } from "../../lib/ai/core/call-options";
import type { UsageKind } from "../billing/validators";
import type { AiTask } from "../../lib/ai/tasks";

type Pricing = { input: number; output: number };

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
  // Normalize bare INSUFFICIENT_CREDITS from deductCredits into the AI-prefixed
  // code so the entire upstream chain (hook fallback, screening catch, toast system)
  // only ever sees one code: AI_INSUFFICIENT_CREDITS.
  if (hasStructuredConvexCode(error)) {
    const code = (error as { data: { code: string } }).data.code;
    if (code === "INSUFFICIENT_CREDITS") {
      throw createError("AI_INSUFFICIENT_CREDITS", "Insufficient credits for AI operation");
    }
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

/**
 * The model and effort a user's `task` runs on (their preset's or Custom
 * pick), with the model instance and its pricing.
 */
export type ServerModel = Awaited<ReturnType<typeof resolveOpenRouterModel>> & { effort?: Effort };
export async function resolveUserServerModel(
  ctx: ActionCtx,
  userId: Id<"users">,
  task: AiTask,
): Promise<ServerModel> {
  const pick = await ctx.runQuery(internal.ai.serverModel.resolveForUser, { userId, task });
  return { ...(await resolveOpenRouterModel(ctx, pick?.modelId ?? null)), effort: pick?.effort };
}

export type CreditTarget = {
  userId: Id<"users">;
  /** Unique per attempt. */
  chargeId: string;
  /** Credits reserved before the work starts. */
  estimate: number;
  kind: UsageKind;
  description: string;
  jobId?: Id<"extractionJobs">;
  model?: string;
  /**
   * False for bulk work of small, bounded items (a Screen all paper): nothing
   * is held; the work runs while the cached balance has credits, and its
   * cost is charged after with one `track`, as Firecrawl bills each page of a crawl.
   */
  hold?: boolean;
};

/**
 * Runs AI work that costs credits. Reserves `estimate` first (unless `hold`
 * is false) and refuses the work when the balance can't cover it. Afterwards it charges what the tokens
 * actually cost; releases the reservation if the work throws.
 */
export async function withCredits<T>(
  ctx: ActionCtx,
  target: CreditTarget,
  pricing: Pricing,
  work: () => Promise<{ result: T; usage: Usage }>,
): Promise<{ result: T; credits: number; usage: Usage }> {
  const allowed =
    target.hold === false
      ? ((await ctx.runQuery(internal.billing.accounts.forUser, { userId: target.userId }))?.balance ?? 0) > 0
      : await reserveCredits(ctx, { userId: target.userId, chargeId: target.chargeId, credits: target.estimate });
  if (!allowed) {
    throw createError(
      "AI_INSUFFICIENT_CREDITS",
      `Insufficient credits: this needs about ${target.estimate} credits`,
    );
  }
  let outcome: { result: T; usage: Usage };
  try {
    outcome = await work();
  } catch (error) {
    if (target.hold !== false) await releaseCredits(ctx, target);
    throw error;
  }
  const credits = creditsForUsage(outcome.usage, pricing);
  const settled = await settleCredits(ctx, {
    userId: target.userId,
    chargeId: target.chargeId,
    credits,
    usage: {
      kind: target.kind,
      description: target.description,
      jobId: target.jobId,
      model: target.model,
      ...tokenDetails(outcome.usage),
    },
  });
  // Unheld work runs on the cached balance; while its charges can't reach Autumn, it stops.
  if (!settled && target.hold === false) await ctx.runMutation(internal.billing.accounts.zeroBalance, { userId: target.userId });
  return { result: outcome.result, credits, usage: outcome.usage };
}

function tokenCounts(usage: Usage) {
  return {
    inputTokens: usage.inputTokens ?? usage.promptTokens ?? 0,
    outputTokens: usage.outputTokens ?? usage.completionTokens ?? 0,
  };
}

async function requireAIUser(ctx: ActionCtx): Promise<Doc<"users">> {
  const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
  if (!user) {
    throw createError("AI_UNAUTHENTICATED", "Authentication required to use AI features");
  }
  return user;
}

/**
 * Auth and credits for a batch run by the signed-in user. Reserves
 * `estimate` credits and charges the combined usage of every item.
 */
export async function withAuthAndCreditsBatch<T>(
  ctx: ActionCtx,
  operation: { description: string; kind: UsageKind; task: AiTask; estimate: number },
  handler: (user: Doc<"users">, model: ServerModel["model"], effort: Effort | undefined) => Promise<{
    result: T;
    totalUsage: Usage;
    trackingEntries?: AITrackingEntry[];
  }>,
): Promise<T> {
  try {
    const user = await requireAIUser(ctx);
    const { model, pricing, modelSlug, effort } = await resolveUserServerModel(ctx, user._id, operation.task);
    const start = Date.now();
    let trackingEntries: AITrackingEntry[] | undefined;
    const { result, credits, usage } = await withCredits(
      ctx,
      {
        userId: user._id,
        chargeId: `${operation.kind}:${crypto.randomUUID()}`,
        estimate: operation.estimate,
        kind: operation.kind,
        description: operation.description,
        model: modelSlug,
      },
      pricing,
      async () => {
        const outcome = await handler(user, model, effort);
        trackingEntries = outcome.trackingEntries;
        return { result: outcome.result, usage: outcome.totalUsage };
      },
    );
    if (trackingEntries && trackingEntries.length > 0) {
      await ctx.scheduler.runAfter(0, internal.lib.analytics.captureAIGenerationBatch, {
        distinctId: user.clerkId,
        provider: "openrouter",
        modelId: modelSlug,
        entries: trackingEntries.map((entry) => ({ ...entry, creditsDeducted: credits })),
        });
    } else {
      await ctx.scheduler.runAfter(0, internal.lib.analytics.captureAIGeneration, { params: {
        distinctId: user.clerkId,
        provider: "openrouter" as AIProvider,
        modelId: modelSlug,
        feature: operation.description,
        usage: tokenCounts(usage),
        latencyMs: Date.now() - start,
        input: `Batch: ${operation.description}`,
        output: "Completed (aggregated)",
        creditsDeducted: credits,
      } });
    }
    return result;
  } catch (error) {
    throwStructuredAIError(error);
  }
}

/**
 * Credits for background work where the user is known but not signed in to
 * this request (workpool items).
 */
export async function withUserCredits<T>(
  ctx: ActionCtx,
  target: CreditTarget,
  pricing: Pricing,
  handler: () => Promise<{ result: T; totalUsage: Usage; trackingEntries?: AITrackingEntry[] }>,
): Promise<T> {
  try {
    const user = await ctx.runQuery(internal.users.internal.getUserById, {
      userId: target.userId,
    });
    if (!user) {
      throw createError("AI_UNAUTHENTICATED", "Authentication required to use AI features");
    }
    let trackingEntries: AITrackingEntry[] | undefined;
    const { result, credits } = await withCredits(ctx, target, pricing, async () => {
      const outcome = await handler();
      trackingEntries = outcome.trackingEntries;
      return { result: outcome.result, usage: outcome.totalUsage };
    });
    if (trackingEntries && trackingEntries.length > 0) {
      await ctx.scheduler.runAfter(0, internal.lib.analytics.captureAIGenerationBatch, {
        distinctId: user.clerkId,
        provider: "openrouter",
        modelId: target.model ?? SERVER_AI_CONFIG.model,
        entries: trackingEntries.map((entry) => ({ ...entry, creditsDeducted: credits })),
        });
    }
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
  /** `task` may depend on the arguments, as with search, where one action serves three tasks. */
  options: { kind: UsageKind; task: AiTask | ((args: ObjectType<Args>) => AiTask) },
) {
  return action({
    args: argsValidator,
    returns: returnsValidator,
    handler: async (ctx, args: ObjectType<Args>): Promise<Output> => {
      try {
        const user = await requireAIUser(ctx);
        const task = typeof options.task === "function" ? options.task(args) : options.task;
        const { model, pricing, modelSlug, effort } = await resolveUserServerModel(ctx, user._id, task);
        const config = configFactory(args);
        const prompts = config.buildPrompts(config.input, 0);
        const inputForTracking = truncateForTracking(
          `[system] ${prompts.system}\n[user] ${prompts.prompt}`
        );
        const start = Date.now();
        try {
          const { result, credits, usage } = await withCredits<AIOutput>(
            ctx,
            {
              userId: user._id,
              chargeId: `${options.kind}:${crypto.randomUUID()}`,
              estimate: ESTIMATED_CREDITS_PER_QUERY,
              kind: options.kind,
              description,
              model: modelSlug,
            },
            pricing,
            async () => {
              const { output, usage } = await executeAIOperation({ model, effort, ...config });
              return { result: output, usage };
            },
          );
          await ctx.scheduler.runAfter(0, internal.lib.analytics.captureAIGeneration, { params: {
            distinctId: user.clerkId,
            provider: "openrouter" as AIProvider,
            modelId: modelSlug,
            feature: description,
            usage: tokenCounts(usage),
            latencyMs: Date.now() - start,
            input: inputForTracking,
            output: truncateForTracking(JSON.stringify(result)),
            temperature: config.temperature,
            creditsDeducted: credits,
          } });
          return formatOutput(result, args);
        } catch (error) {
          await ctx.scheduler.runAfter(0, internal.lib.analytics.captureAIGeneration, { params: {
            distinctId: user.clerkId,
            provider: "openrouter" as AIProvider,
            modelId: modelSlug,
            feature: description,
            usage: { inputTokens: 0, outputTokens: 0 },
            latencyMs: Date.now() - start,
            input: inputForTracking,
            output: "",
            isError: true,
            errorMessage: error instanceof Error ? error.message : String(error),
            httpStatus: extractHttpStatus(error),
            errorCode: extractErrorCode(error),
            temperature: config.temperature,
          } });
          throw error;
        }
      } catch (error) {
        throwStructuredAIError(error);
      }
    },
  });
}

// RAG helpers removed
