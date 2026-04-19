import { Agent, stepCountIs } from "@convex-dev/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { components } from "../_generated/api";
import { SERVER_AI_CONFIG } from "../ai/config";

/**
 * Default chat agent.
 *
 * - languageModel is a fallback — generateResponse overrides it per-turn
 *   via resolveOpenRouterModel(ctx, job.chatModelId).
 * - No embeddingModel: chat has no RAG path; answers come from abstracts
 *   embedded directly in the system prompt.
 * - stopWhen: stepCountIs(1) disables tool looping — V1 has no tools.
 * - usageHandler is wired in P9.T14 (credits + metadata logging).
 */
const defaultModelId = SERVER_AI_CONFIG.model.includes("/")
  ? SERVER_AI_CONFIG.model
  : `${SERVER_AI_CONFIG.provider}/${SERVER_AI_CONFIG.model}`;

const openrouter = createOpenRouter();
const defaultLanguageModel = openrouter.chat(defaultModelId);

export const paperChat = new Agent(components.agent, {
  name: "Paper Chat",
  languageModel: defaultLanguageModel,
  contextOptions: {
    recentMessages: 40,
    excludeToolMessages: true,
  },
  storageOptions: {
    saveMessages: "promptAndOutput",
  },
  stopWhen: stepCountIs(1),
});
