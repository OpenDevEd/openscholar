import posthog from "posthog-js";
import {
  buildAIGenerationProperties,
  type AIGenerationParams,
  type AITrackingEntry,
} from "./posthog-ai-shared";
import type { AIProvider } from "./types";

export function captureAIGeneration(params: AIGenerationParams): void {
  posthog.capture("$ai_generation", buildAIGenerationProperties(params));
}

/**
 * Captures per-item $ai_generation events for client-side batch operations.
 * All entries share a single trace ID for correlation in PostHog traces view.
 */
export function captureAIGenerationBatch(
  provider: AIProvider,
  modelId: string,
  entries: AITrackingEntry[],
): void {
  if (entries.length === 0) return;

  const traceId = crypto.randomUUID();

  for (const entry of entries) {
    posthog.capture(
      "$ai_generation",
      buildAIGenerationProperties({
        provider,
        modelId,
        traceId,
        ...entry,
      }),
    );
  }
}
