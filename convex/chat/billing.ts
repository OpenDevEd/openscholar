import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  calculateCreditsToDeductFromUsage,
  convertUsdCostToCredits,
} from "../ai/lib/creditBilling";
import { deductCreditsTransaction } from "../credits/internal";

const OPENROUTER_GENERATION_URL = "https://openrouter.ai/api/v1/generation";
// Back-off schedule for /api/v1/generation lookups. OpenRouter takes a
// while to publish the generation record — especially for cancelled
// streams, which are written after the upstream provider settles. The
// old 0.5s→10s schedule gave up after ~18.5s, leaving aborted turns
// permanently stuck with lastError "Generation not found". Extend to
// ~2.5 minutes total wait so cancelled records have time to land.
const CHAT_GENERATION_RETRY_DELAYS_MS = [
  1_000, 2_000, 5_000, 10_000, 20_000, 40_000, 60_000,
] as const;

export type NormalizedOpenRouterGeneration = {
  generationId: string;
  model: string;
  providerName: string | null;
  cancelled: boolean;
  finishReason: string | null;
  nativeFinishReason: string | null;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cachedPromptTokens: number;
  totalCostUsd: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pickNumber(...values: unknown[]): number {
  for (const value of values) {
    const number = asNumber(value);
    if (number !== null) return number;
  }
  return 0;
}

export function getOpenRouterGenerationIdFromProviderMetadata(
  providerMetadata: unknown,
): string | null {
  const metadata = asRecord(providerMetadata);
  const openrouter = metadata ? asRecord(metadata.openrouter) : null;
  const responseId = openrouter ? asString(openrouter.responseId) : null;
  return responseId && responseId.trim().length > 0 ? responseId.trim() : null;
}

export function normalizeOpenRouterGeneration(
  payload: unknown,
): NormalizedOpenRouterGeneration {
  const record = asRecord(payload);
  if (!record) {
    throw new Error("OpenRouter generation payload must be an object");
  }

  const generationId = asString(record.id);
  const model = asString(record.model);
  const totalCostUsd = asNumber(record.total_cost);

  if (!generationId) {
    throw new Error("OpenRouter generation payload is missing id");
  }
  if (!model) {
    throw new Error("OpenRouter generation payload is missing model");
  }
  if (totalCostUsd === null || totalCostUsd < 0) {
    throw new Error("OpenRouter generation payload is missing total_cost");
  }

  return {
    generationId,
    model,
    providerName: asString(record.provider_name),
    cancelled: record.cancelled === true,
    finishReason: asString(record.finish_reason),
    nativeFinishReason: asString(record.native_finish_reason),
    promptTokens: pickNumber(
      record.native_tokens_prompt,
      record.tokens_prompt,
    ),
    completionTokens: pickNumber(
      record.native_tokens_completion,
      record.tokens_completion,
    ),
    reasoningTokens: pickNumber(record.native_tokens_reasoning),
    cachedPromptTokens: pickNumber(record.native_tokens_cached),
    totalCostUsd,
  };
}

export function getChatGenerationRetryDelayMs(
  priorFailedAttempts: number,
): number | null {
  return CHAT_GENERATION_RETRY_DELAYS_MS[priorFailedAttempts] ?? null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function buildChatBillingMetadata(args: {
  billingSource: "sdk_usage" | "sdk_usage_cost" | "openrouter_generation_api";
  model: string;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cachedPromptTokens: number;
  generationId?: string;
  providerName?: string | null;
  totalCostUsd?: number;
  cancelled?: boolean;
  finishReason?: string | null;
  nativeFinishReason?: string | null;
}) {
  return {
    ...(args.generationId ? { generationId: args.generationId } : {}),
    billingSource: args.billingSource,
    model: args.model,
    ...(args.providerName ? { providerName: args.providerName } : {}),
    promptTokens: String(args.promptTokens),
    completionTokens: String(args.completionTokens),
    reasoningTokens: String(args.reasoningTokens),
    cachedPromptTokens: String(args.cachedPromptTokens),
    ...(args.totalCostUsd !== undefined
      ? { totalCostUsd: String(args.totalCostUsd) }
      : {}),
    ...(args.cancelled !== undefined
      ? { cancelled: String(args.cancelled) }
      : {}),
    ...(args.finishReason ? { finishReason: args.finishReason } : {}),
    ...(args.nativeFinishReason
      ? { nativeFinishReason: args.nativeFinishReason }
      : {}),
  };
}

type FetchGenerationResult =
  | { kind: "ok"; generation: NormalizedOpenRouterGeneration }
  | { kind: "retryable"; message: string }
  | { kind: "fatal"; message: string };

async function fetchOpenRouterGeneration(
  generationId: string,
): Promise<FetchGenerationResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return {
      kind: "fatal",
      message: "OPENROUTER_API_KEY is not configured",
    };
  }

  try {
    const response = await fetch(
      `${OPENROUTER_GENERATION_URL}?id=${encodeURIComponent(generationId)}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );
    const payload = await response.json().catch(() => null);
    const payloadRecord = asRecord(payload);
    const errorRecord = payloadRecord ? asRecord(payloadRecord.error) : null;
    const errorMessage =
      asString(errorRecord?.message) ??
      `OpenRouter generation lookup failed with status ${response.status}`;

    if (!response.ok) {
      if (
        response.status === 404 ||
        response.status === 429 ||
        response.status >= 500
      ) {
        return { kind: "retryable", message: errorMessage };
      }
      return { kind: "fatal", message: errorMessage };
    }

    const data = asRecord(payload)?.data;
    return {
      kind: "ok",
      generation: normalizeOpenRouterGeneration(data),
    };
  } catch (error) {
    return { kind: "retryable", message: toErrorMessage(error) };
  }
}

export const getGenerationUsageByGenerationId = internalQuery({
  args: { generationId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      generationId: v.string(),
      jobId: v.id("extractionJobs"),
      threadId: v.string(),
      userId: v.id("users"),
      requestedModel: v.union(v.string(), v.null()),
      status: v.union(
        v.literal("captured"),
        v.literal("retrying"),
        v.literal("billed"),
        v.literal("failed"),
      ),
      attemptCount: v.number(),
      billedAt: v.union(v.number(), v.null()),
      billedCredits: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, { generationId }) => {
    const row = await ctx.db
      .query("chatGenerationUsages")
      .withIndex("by_generation_id", (q) => q.eq("generationId", generationId))
      .unique();
    if (!row) return null;
    return {
      generationId: row.generationId,
      jobId: row.jobId,
      threadId: row.threadId,
      userId: row.userId,
      requestedModel: row.requestedModel ?? null,
      status: row.status,
      attemptCount: row.attemptCount,
      billedAt: row.billedAt ?? null,
      billedCredits: row.billedCredits ?? null,
    };
  },
});

export const getLatestGenerationUsageForThread = internalQuery({
  args: { threadId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      generationId: v.string(),
      status: v.union(
        v.literal("captured"),
        v.literal("retrying"),
        v.literal("billed"),
        v.literal("failed"),
      ),
      billedAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, { threadId }) => {
    const rows = await ctx.db
      .query("chatGenerationUsages")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .order("desc")
      .take(1);
    const row = rows[0];
    if (!row) return null;
    return {
      generationId: row.generationId,
      status: row.status,
      billedAt: row.billedAt ?? null,
    };
  },
});

export const captureGenerationFromResponse = internalMutation({
  args: {
    threadId: v.string(),
    generationId: v.string(),
    requestedModel: v.optional(v.string()),
  },
  returns: v.object({
    captured: v.boolean(),
  }),
  handler: async (ctx, { threadId, generationId, requestedModel }) => {
    const existing = await ctx.db
      .query("chatGenerationUsages")
      .withIndex("by_generation_id", (q) => q.eq("generationId", generationId))
      .unique();
    if (existing) {
      return { captured: false };
    }

    const job = await ctx.db
      .query("extractionJobs")
      .withIndex("by_chatThread", (q) => q.eq("chatThreadId", threadId))
      .unique();
    if (!job || job.mode !== "chat") {
      return { captured: false };
    }

    const now = Date.now();
    await ctx.db.insert("chatGenerationUsages", {
      generationId,
      jobId: job._id,
      threadId,
      userId: job.userId,
      requestedModel,
      source: "openrouter_response_id",
      status: "captured",
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { captured: true };
  },
});

export const billGenerationFromSdkUsage = internalMutation({
  args: {
    generationId: v.string(),
    model: v.string(),
    pricing: v.object({
      input: v.number(),
      output: v.number(),
    }),
    promptTokens: v.number(),
    completionTokens: v.number(),
    reasoningTokens: v.number(),
    cachedPromptTokens: v.number(),
    // Optional all-in USD cost from providerMetadata.openrouter.usage.cost
    // (set by the SDK when the chat factory is built with
    // `usage: { include: true }`). Includes any provider-side tool cost
    // such as OpenRouter server web search; preferred over the
    // pricing×tokens math whenever supplied.
    totalCostUsd: v.optional(v.number()),
  },
  returns: v.object({
    outcome: v.union(v.literal("already_billed"), v.literal("billed")),
    billedCredits: v.number(),
  }),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("chatGenerationUsages")
      .withIndex("by_generation_id", (q) => q.eq("generationId", args.generationId))
      .unique();
    if (!row) {
      throw new Error(`Missing chatGenerationUsages row for ${args.generationId}`);
    }
    if (row.billedAt) {
      return {
        outcome: "already_billed" as const,
        billedCredits: row.billedCredits ?? 0,
      };
    }

    const useCostReadback =
      args.totalCostUsd !== undefined &&
      Number.isFinite(args.totalCostUsd) &&
      args.totalCostUsd >= 0;
    const billedCredits = useCostReadback
      ? convertUsdCostToCredits(args.totalCostUsd as number)
      : calculateCreditsToDeductFromUsage({
          usage: {
            inputTokens: args.promptTokens,
            outputTokens: args.completionTokens,
          },
          pricing: args.pricing,
        });
    const now = Date.now();

    if (billedCredits > 0) {
      await deductCreditsTransaction(ctx, {
        userId: row.userId,
        amount: billedCredits,
        description: "AI: Chat message",
        jobId: row.jobId,
        billingType: "chat",
        metadata: buildChatBillingMetadata({
          billingSource: useCostReadback ? "sdk_usage_cost" : "sdk_usage",
          generationId: args.generationId,
          model: args.model,
          promptTokens: args.promptTokens,
          completionTokens: args.completionTokens,
          reasoningTokens: args.reasoningTokens,
          cachedPromptTokens: args.cachedPromptTokens,
          ...(useCostReadback ? { totalCostUsd: args.totalCostUsd } : {}),
        }),
      });
    }

    await ctx.db.patch(row._id, {
      requestedModel: row.requestedModel ?? args.model,
      authoritativeModel: row.authoritativeModel ?? args.model,
      source: "sdk_usage",
      status: "billed",
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      reasoningTokens: args.reasoningTokens,
      cachedPromptTokens: args.cachedPromptTokens,
      ...(useCostReadback ? { totalCostUsd: args.totalCostUsd } : {}),
      billedCredits,
      attemptCount: row.attemptCount + 1,
      lastAttemptAt: now,
      nextRetryAt: undefined,
      billedAt: now,
      lastError: undefined,
      updatedAt: now,
    });

    return { outcome: "billed" as const, billedCredits };
  },
});

export const billThreadUsageFromSdk = internalMutation({
  args: {
    threadId: v.string(),
    model: v.string(),
    pricing: v.object({
      input: v.number(),
      output: v.number(),
    }),
    promptTokens: v.number(),
    completionTokens: v.number(),
    reasoningTokens: v.number(),
    cachedPromptTokens: v.number(),
    // Defence-in-depth path mirrors billGenerationFromSdkUsage: when the
    // fetch wrapper missed the X-Generation-Id header but the SDK still
    // surfaced an all-in cost on providerMetadata, prefer it over the
    // pricing×tokens math.
    totalCostUsd: v.optional(v.number()),
  },
  returns: v.object({
    outcome: v.literal("billed"),
    billedCredits: v.number(),
  }),
  handler: async (ctx, args) => {
    const job = await ctx.db
      .query("extractionJobs")
      .withIndex("by_chatThread", (q) => q.eq("chatThreadId", args.threadId))
      .unique();
    if (!job || job.mode !== "chat") {
      throw new Error(`Missing chat job for thread ${args.threadId}`);
    }

    const useCostReadback =
      args.totalCostUsd !== undefined &&
      Number.isFinite(args.totalCostUsd) &&
      args.totalCostUsd >= 0;
    const billedCredits = useCostReadback
      ? convertUsdCostToCredits(args.totalCostUsd as number)
      : calculateCreditsToDeductFromUsage({
          usage: {
            inputTokens: args.promptTokens,
            outputTokens: args.completionTokens,
          },
          pricing: args.pricing,
        });

    if (billedCredits > 0) {
      await deductCreditsTransaction(ctx, {
        userId: job.userId,
        amount: billedCredits,
        description: "AI: Chat message",
        jobId: job._id,
        billingType: "chat",
        metadata: buildChatBillingMetadata({
          billingSource: useCostReadback ? "sdk_usage_cost" : "sdk_usage",
          model: args.model,
          promptTokens: args.promptTokens,
          completionTokens: args.completionTokens,
          reasoningTokens: args.reasoningTokens,
          cachedPromptTokens: args.cachedPromptTokens,
          ...(useCostReadback ? { totalCostUsd: args.totalCostUsd } : {}),
        }),
      });
    }

    return { outcome: "billed" as const, billedCredits };
  },
});

/**
 * Tavily-per-search cost — see plan-06.
 *
 * Each Tavily HTTP call returns a `usage.creditsUsed` integer. Plan 05
 * forwards that count to the orchestrator's `costSink`, which calls
 * this mutation once per search. We convert Tavily credits → USD →
 * deducted credits using the same `convertUsdCostToCredits` helper
 * model billing uses, so the AI cost markup applies symmetrically.
 *
 *   1 Tavily basic credit  = $0.008
 *   2 Tavily advanced credit = $0.016 (passed as tavilyCredits=2)
 *
 * The mutation rejects non-positive `tavilyCredits` so a misconfigured
 * call site shows up loudly in tests rather than silently no-opping.
 * No cross-call dedupe key is computed: each Tavily HTTP search is a
 * real charge, and `maxRetries: 0` on the streamText call site means
 * a logical retry of the same step cannot happen.
 */
const TAVILY_USD_PER_CREDIT = 0.008;

export const recordTavilyCost = internalMutation({
  args: {
    threadId: v.string(),
    tavilyCredits: v.number(),
  },
  returns: v.object({
    billedCredits: v.number(),
  }),
  handler: async (ctx, { threadId, tavilyCredits }) => {
    if (!Number.isFinite(tavilyCredits) || tavilyCredits <= 0) {
      throw new Error(
        `recordTavilyCost: tavilyCredits must be a positive number, got ${tavilyCredits}`,
      );
    }

    const job = await ctx.db
      .query("extractionJobs")
      .withIndex("by_chatThread", (q) => q.eq("chatThreadId", threadId))
      .unique();
    if (!job || job.mode !== "chat") {
      throw new Error(
        `recordTavilyCost: missing chat job for thread ${threadId}`,
      );
    }

    const usdCost = TAVILY_USD_PER_CREDIT * tavilyCredits;
    const billedCredits = convertUsdCostToCredits(usdCost);

    await deductCreditsTransaction(ctx, {
      userId: job.userId,
      amount: billedCredits,
      description: "AI: Web search (Tavily)",
      jobId: job._id,
      billingType: "search",
      metadata: {
        searchEngine: "tavily",
        tavilyCredits: String(tavilyCredits),
        usdCost: String(usdCost),
      },
    });

    return { billedCredits };
  },
});

export const markGenerationRetry = internalMutation({
  args: {
    generationId: v.string(),
    error: v.string(),
  },
  returns: v.object({
    shouldRetry: v.boolean(),
    delayMs: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, { generationId, error }) => {
    const row = await ctx.db
      .query("chatGenerationUsages")
      .withIndex("by_generation_id", (q) => q.eq("generationId", generationId))
      .unique();
    if (!row || row.billedAt) {
      return { shouldRetry: false, delayMs: null };
    }

    const delayMs = getChatGenerationRetryDelayMs(row.attemptCount);
    const now = Date.now();

    await ctx.db.patch(row._id, {
      status: delayMs === null ? "failed" : "retrying",
      attemptCount: row.attemptCount + 1,
      lastAttemptAt: now,
      nextRetryAt: delayMs === null ? undefined : now + delayMs,
      lastError: error,
      updatedAt: now,
    });

    return { shouldRetry: delayMs !== null, delayMs };
  },
});

export const settleGenerationUsage = internalMutation({
  args: {
    generationId: v.string(),
    authoritativeModel: v.string(),
    providerName: v.union(v.string(), v.null()),
    cancelled: v.boolean(),
    finishReason: v.union(v.string(), v.null()),
    nativeFinishReason: v.union(v.string(), v.null()),
    promptTokens: v.number(),
    completionTokens: v.number(),
    reasoningTokens: v.number(),
    cachedPromptTokens: v.number(),
    totalCostUsd: v.number(),
  },
  returns: v.object({
    outcome: v.union(v.literal("already_billed"), v.literal("billed")),
    billedCredits: v.number(),
  }),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("chatGenerationUsages")
      .withIndex("by_generation_id", (q) => q.eq("generationId", args.generationId))
      .unique();
    if (!row) {
      throw new Error(`Missing chatGenerationUsages row for ${args.generationId}`);
    }
    if (row.billedAt) {
      return {
        outcome: "already_billed" as const,
        billedCredits: row.billedCredits ?? 0,
      };
    }

    const billedCredits = convertUsdCostToCredits(args.totalCostUsd);
    const now = Date.now();

    if (billedCredits > 0) {
      await deductCreditsTransaction(ctx, {
        userId: row.userId,
        amount: billedCredits,
        description: "AI: Chat message",
        jobId: row.jobId,
        billingType: "chat",
        metadata: buildChatBillingMetadata({
          generationId: args.generationId,
          billingSource: "openrouter_generation_api",
          model: args.authoritativeModel,
          providerName: args.providerName,
          promptTokens: args.promptTokens,
          completionTokens: args.completionTokens,
          reasoningTokens: args.reasoningTokens,
          cachedPromptTokens: args.cachedPromptTokens,
          totalCostUsd: args.totalCostUsd,
          cancelled: args.cancelled,
          finishReason: args.finishReason,
          nativeFinishReason: args.nativeFinishReason,
        }),
      });
    }

    await ctx.db.patch(row._id, {
      requestedModel: row.requestedModel ?? args.authoritativeModel,
      authoritativeModel: args.authoritativeModel,
      providerName: args.providerName ?? undefined,
      source: "openrouter_generation_api",
      status: "billed",
      cancelled: args.cancelled,
      finishReason: args.finishReason ?? undefined,
      nativeFinishReason: args.nativeFinishReason ?? undefined,
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      reasoningTokens: args.reasoningTokens,
      cachedPromptTokens: args.cachedPromptTokens,
      totalCostUsd: args.totalCostUsd,
      billedCredits,
      attemptCount: row.attemptCount + 1,
      lastAttemptAt: now,
      nextRetryAt: undefined,
      authoritativeAt: now,
      billedAt: now,
      lastError: undefined,
      updatedAt: now,
    });

    return { outcome: "billed" as const, billedCredits };
  },
});

export const failGenerationUsage = internalMutation({
  args: {
    generationId: v.string(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { generationId, error }) => {
    const row = await ctx.db
      .query("chatGenerationUsages")
      .withIndex("by_generation_id", (q) => q.eq("generationId", generationId))
      .unique();
    if (!row || row.billedAt) {
      return null;
    }
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "failed",
      attemptCount: row.attemptCount + 1,
      lastAttemptAt: now,
      nextRetryAt: undefined,
      lastError: error,
      updatedAt: now,
    });
    return null;
  },
});

export const reconcileGenerationUsage = internalAction({
  args: { generationId: v.string() },
  returns: v.object({
    outcome: v.union(
      v.literal("missing"),
      v.literal("already_billed"),
      v.literal("retry_scheduled"),
      v.literal("billed"),
      v.literal("failed"),
    ),
  }),
  handler: async (ctx, { generationId }) => {
    const row = await ctx.runQuery(
      internal.chat.billing.getGenerationUsageByGenerationId,
      { generationId },
    );
    if (!row) {
      return { outcome: "missing" as const };
    }
    if (row.billedAt) {
      return { outcome: "already_billed" as const };
    }

    const result = await fetchOpenRouterGeneration(generationId);
    if (result.kind === "retryable") {
      const retry = await ctx.runMutation(
        internal.chat.billing.markGenerationRetry,
        { generationId, error: result.message },
      );
      if (retry.shouldRetry && retry.delayMs !== null) {
        await ctx.scheduler.runAfter(
          retry.delayMs,
          internal.chat.billing.reconcileGenerationUsage,
          { generationId },
        );
        return { outcome: "retry_scheduled" as const };
      }
      return { outcome: "failed" as const };
    }

    if (result.kind === "fatal") {
      await ctx.runMutation(internal.chat.billing.failGenerationUsage, {
        generationId,
        error: result.message,
      });
      return { outcome: "failed" as const };
    }

    await ctx.runMutation(internal.chat.billing.settleGenerationUsage, {
      generationId: result.generation.generationId,
      authoritativeModel: result.generation.model,
      providerName: result.generation.providerName,
      cancelled: result.generation.cancelled,
      finishReason: result.generation.finishReason,
      nativeFinishReason: result.generation.nativeFinishReason,
      promptTokens: result.generation.promptTokens,
      completionTokens: result.generation.completionTokens,
      reasoningTokens: result.generation.reasoningTokens,
      cachedPromptTokens: result.generation.cachedPromptTokens,
      totalCostUsd: result.generation.totalCostUsd,
    });
    return { outcome: "billed" as const };
  },
});
