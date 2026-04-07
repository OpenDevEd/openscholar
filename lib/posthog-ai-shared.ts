/**
 * Shared logic for PostHog $ai_generation payloads.
 * Used by both client (posthog-ai) and server (posthog-server).
 */

import type { AIProvider } from "./types";

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

export const MAX_TRACKING_CONTENT_LENGTH = 2000;

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface AIGenerationParams {
  provider: AIProvider;
  modelId: string;
  feature: string;
  usage: { inputTokens?: number; outputTokens?: number };
  latencyMs: number;
  input: string;
  output: string;
  isError?: boolean;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  /** Shared trace ID for multi-step operations. Auto-generated if omitted. */
  traceId?: string;
  /** Actual HTTP status from the provider (e.g. 429, 503). Falls back to 200/500 if omitted. */
  httpStatus?: number;
  /** Structured error code (e.g. "AI_PROVIDER_ERROR", "AI_INSUFFICIENT_CREDITS"). */
  errorCode?: string;
  /** Temperature setting used for this generation. */
  temperature?: number;
  /** Max tokens setting used for this generation. */
  maxTokens?: number;
  /** Credits deducted for this operation. */
  creditsDeducted?: number;
  /** Credits remaining after this operation. */
  creditsRemaining?: number;
  /** Lifetime credits used by this user (cumulative). */
  lifetimeCreditsUsed?: number;
  /** Raw fractional credit cost before ceiling/minimum (for analytics). */
  creditsRawCost?: number;
}

/** Per-item tracking entry for batch operations. */
export interface AITrackingEntry {
  feature: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  input: string;
  output: string;
  isError?: boolean;
  errorMessage?: string;
  errorCode?: string;
  httpStatus?: number;
  temperature?: number;
  maxTokens?: number;
  creditsDeducted?: number;
  creditsRemaining?: number;
  lifetimeCreditsUsed?: number;
  creditsRawCost?: number;
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

/** Truncate content for tracking to avoid oversized PostHog events. */
export function truncateForTracking(s: string): string {
  if (s.length <= MAX_TRACKING_CONTENT_LENGTH) return s;
  return s.slice(0, MAX_TRACKING_CONTENT_LENGTH) + "...[truncated]";
}

/**
 * Extracts HTTP status code from provider errors.
 * Vercel AI SDK errors typically carry `statusCode` or `status`.
 */
export function extractHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as Record<string, unknown>;
  if (typeof e.statusCode === "number") return e.statusCode;
  if (typeof e.status === "number") return e.status;
  if (e.cause && typeof e.cause === "object") {
    const cause = e.cause as Record<string, unknown>;
    if (typeof cause.statusCode === "number") return cause.statusCode;
    if (typeof cause.status === "number") return cause.status;
  }
  if (e.data && typeof e.data === "object") {
    const data = e.data as Record<string, unknown>;
    if (typeof data.statusCode === "number") return data.statusCode;
  }
  return undefined;
}

/**
 * Extracts a structured error code from an error object.
 * Checks common patterns: `.code`, `.data.code`, AIError subclasses.
 */
export function extractErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as Record<string, unknown>;
  if (typeof e.code === "string") return e.code;
  if (e.data && typeof e.data === "object") {
    const data = e.data as Record<string, unknown>;
    if (typeof data.code === "string") return data.code;
  }
  return undefined;
}

// ═══════════════════════════════════════════════════════════════
// EVENT BUILDER
// ═══════════════════════════════════════════════════════════════

/**
 * Builds the $ai_generation event properties.
 * Shared between client and server capture.
 */
export function buildAIGenerationProperties(params: AIGenerationParams): Record<string, unknown> {
  const promptTokens = params.usage.inputTokens ?? 0;
  const completionTokens = params.usage.outputTokens ?? 0;

  return {
    $ai_trace_id: params.traceId ?? crypto.randomUUID(),
    $ai_provider: params.provider,
    $ai_model: params.modelId,
    $ai_input_tokens: promptTokens,
    $ai_output_tokens: completionTokens,
    $ai_latency: params.latencyMs / 1000,
    $ai_is_error: params.isError ?? false,
    $ai_http_status: params.httpStatus ?? (params.isError ? 500 : 200),
    $ai_input: [{ role: "user" as const, content: params.input }],
    $ai_output_choices: [{ role: "assistant" as const, content: params.output }],
    feature: params.feature,
    ...(params.temperature !== undefined && { $ai_temperature: params.temperature }),
    ...(params.maxTokens !== undefined && { $ai_max_tokens: params.maxTokens }),
    ...(params.errorMessage && { $ai_error: params.errorMessage }),
    ...(params.errorCode && { $ai_error_code: params.errorCode }),
    ...(params.creditsDeducted !== undefined && { credits_deducted: params.creditsDeducted }),
    ...(params.creditsRawCost !== undefined && { credits_raw_cost: params.creditsRawCost }),
    ...(params.creditsRemaining !== undefined && { credits_remaining: params.creditsRemaining }),
    ...(params.lifetimeCreditsUsed !== undefined && { lifetime_credits_used: params.lifetimeCreditsUsed }),
    ...(params.metadata || {}),
  };
}
