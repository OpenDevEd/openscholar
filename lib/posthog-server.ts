/**
 * Server-side PostHog capture for AI usage tracking.
 * Uses fetch (no posthog-node) to avoid Convex bundling issues with Node built-ins.
 * Used by Convex actions (credits mode, extraction).
 * Requires POSTHOG_KEY or NEXT_PUBLIC_POSTHOG_KEY and POSTHOG_HOST (default: https://eu.i.posthog.com)
 */

import {
  buildAIGenerationProperties,
  type AIGenerationParams,
} from "./posthog-ai-shared";

function getPostHogConfig(): { key: string; host: string } | null {
  const key =
    process.env.POSTHOG_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;

  const host =
    process.env.POSTHOG_HOST ??
    process.env.NEXT_PUBLIC_POSTHOG_HOST ??
    "https://eu.i.posthog.com";
  const baseUrl = host.startsWith("http") ? host : `https://${host}`;

  return { key, host: baseUrl };
}

export interface ServerAIGenerationParams extends AIGenerationParams {
  distinctId: string;
}

/**
 * Captures $ai_generation via PostHog HTTP API.
 * Fire-and-forget; does not block or throw.
 */
export async function captureAIGenerationServer(
  params: ServerAIGenerationParams
): Promise<void> {
  const config = getPostHogConfig();
  if (!config) return;

  const { distinctId, ...payloadParams } = params;
  const properties = buildAIGenerationProperties(payloadParams);

  try {
    await fetch(`${config.host}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: config.key,
        event: "$ai_generation",
        distinct_id: distinctId,
        properties,
      }),
    });
  } catch {
    // Fire-and-forget; avoid breaking the main flow
  }
}
