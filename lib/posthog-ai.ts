import posthog from "posthog-js";
import {
  buildAIGenerationProperties,
  type AIGenerationParams,
} from "./posthog-ai-shared";

export function captureAIGeneration(params: AIGenerationParams): void {
  posthog.capture("$ai_generation", buildAIGenerationProperties(params));
}
