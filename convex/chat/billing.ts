/**
 * Chat turns reserve credits before they stream (see messages.ts). This file
 * settles the turns that stop or fail after OpenRouter started a generation: the
 * generation record is looked up with retries, and its cost is charged.
 */
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { convertUsdToCredits } from "@/lib/pricing";
import { settleCredits } from "../billing/charge";
import { errorToLogString } from "../lib/errors";

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
    return { kind: "retryable", message: errorToLogString(error) };
  }
}

export const settleFromOpenRouter = internalAction({
  args: {
    userId: v.id("users"),
    jobId: v.id("extractionJobs"),
    chargeId: v.string(),
    generationId: v.string(),
    /** Cost already known outside this generation: its earlier steps. */
    extraUsd: v.number(),
    /** Token details of the steps that finished before this one; absent on retries scheduled before it existed. */
    earlierTokens: v.optional(v.object({ cacheReadTokens: v.number(), cacheWriteTokens: v.number(), reasoningTokens: v.number() })),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const earlier = args.earlierTokens ?? { cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
    const result = await fetchOpenRouterGeneration(args.generationId);
    if (result.kind === "retryable") {
      const delayMs = getChatGenerationRetryDelayMs(args.attempt);
      if (delayMs !== null) {
        await ctx.scheduler.runAfter(delayMs, internal.chat.billing.settleFromOpenRouter, {
          ...args,
          attempt: args.attempt + 1,
        });
        return null;
      }
    }
    if (result.kind !== "ok") {
      console.error(
        `[chat billing] no OpenRouter cost for ${args.generationId}; charging only the known ${args.extraUsd} USD for ${args.chargeId}: ${result.message}`,
      );
    }
    const usd = (result.kind === "ok" ? result.generation.totalCostUsd : 0) + args.extraUsd;
    await settleCredits(ctx, {
      userId: args.userId,
      chargeId: args.chargeId,
      credits: convertUsdToCredits({ usd }),
      usage: {
        kind: "chat",
        description: "Chat message",
        jobId: args.jobId,
        ...(result.kind === "ok" ? { model: result.generation.model } : {}),
        costUsd: usd,
        // OpenRouter's generation record has no cache-write count.
        cacheReadTokens: earlier.cacheReadTokens + (result.kind === "ok" ? result.generation.cachedPromptTokens : 0),
        cacheWriteTokens: earlier.cacheWriteTokens,
        reasoningTokens: earlier.reasoningTokens + (result.kind === "ok" ? result.generation.reasoningTokens : 0),
      },
    });
    return null;
  },
});
