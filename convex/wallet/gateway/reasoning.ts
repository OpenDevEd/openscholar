import type { Doc } from "../../_generated/dataModel";
import type { ReasoningEffort } from "./types";

/**
 * Map a generic `reasoning_effort` to provider-specific `providerOptions`.
 *
 * Only applies when the model's `supportedParameters` includes "reasoning".
 * Returns `undefined` when reasoning should not be enabled.
 */
export function buildReasoningProviderOptions(
  provider: string,
  effort: ReasoningEffort,
  model: Doc<"models">,
): Record<string, Record<string, unknown>> | undefined {
  if (effort === "none") return undefined;

  const supportsReasoning = model.supportedParameters?.includes("reasoning");
  if (!supportsReasoning) return undefined;

  switch (provider) {
    case "anthropic":
      return {
        anthropic: {
          thinking: { type: "enabled", budgetTokens: anthropicBudget(effort) },
        },
      };

    case "openai":
      return {
        openai: { reasoningEffort: mapToOpenAIEffort(effort) },
      };

    case "deepseek":
      return {
        deepseek: { thinking: { type: "enabled" } },
      };

    case "google":
      return {
        google: {
          thinkingConfig: { thinkingBudget: googleBudget(effort) },
        },
      };

    default:
      return undefined;
  }
}

function anthropicBudget(effort: ReasoningEffort): number {
  switch (effort) {
    case "low":
      return 1_024;
    case "medium":
      return 8_192;
    case "high":
      return 32_768;
    default:
      return 8_192;
  }
}

function mapToOpenAIEffort(
  effort: ReasoningEffort,
): "low" | "medium" | "high" {
  switch (effort) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    default:
      return "medium";
  }
}

function googleBudget(effort: ReasoningEffort): number {
  switch (effort) {
    case "low":
      return 1_024;
    case "medium":
      return 8_192;
    case "high":
      return 32_768;
    default:
      return 8_192;
  }
}
