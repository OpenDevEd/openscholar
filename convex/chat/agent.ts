import { Agent, stepCountIs } from "@convex-dev/agent";
import type { ModelMessage } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { components, internal } from "../_generated/api";
import { SERVER_AI_CONFIG } from "../ai/config";

/**
 * Default chat agent.
 *
 * - languageModel is a fallback — generateResponse overrides it per-turn
 *   via resolveOpenRouterModel(ctx, job.chatModelId).
 * - No embeddingModel: chat has no RAG path; answers come from abstracts
 *   embedded directly in the system prompt.
 * - stopWhen: stepCountIs(5) is a CAP, not a forced step count. Single-
 *   turn questions still terminate at step 1; the cap exists to bound
 *   tool loops (web search → reflect → answer) at five steps total.
 * - Billing is handled in chat/messages.generateResponse after the
 *   stream settles; keep the agent callback path free of extra DB work
 *   so stop/abort transitions do not race dangling mutations.
 */
const defaultModelId = SERVER_AI_CONFIG.model.includes("/")
  ? SERVER_AI_CONFIG.model
  : `${SERVER_AI_CONFIG.provider}/${SERVER_AI_CONFIG.model}`;

const openrouter = createOpenRouter();
// `usage: { include: true }` makes OpenRouter ship the all-in USD
// cost on providerMetadata.openrouter.usage.cost — the source-of-
// truth that chat billing prefers when present (see plan-02 and
// convex/chat/billing.ts).
const defaultLanguageModel = openrouter.chat(defaultModelId, {
  usage: { include: true },
});

async function buildChatContext(
  ctx: Parameters<NonNullable<Agent["options"]["contextHandler"]>>[0],
  args: Parameters<NonNullable<Agent["options"]["contextHandler"]>>[1],
): Promise<ModelMessage[]> {
  if (!args.threadId) {
    return args.allMessages;
  }

  const meta = await ctx.runQuery(
    internal.chat.threads.getModelForThread,
    { threadId: args.threadId },
  );
  if (!meta) {
    return args.allMessages;
  }

  const systemMessages = await ctx.runQuery(
    internal.chat.context.buildSystemPromptForJob,
    {
      jobId: meta.jobId,
      webSearchEnabled: meta.webSearchEnabled,
    },
  );
  return [...systemMessages, ...args.allMessages];
}

export const paperChat: Agent = new Agent(components.agent, {
  name: "Paper Chat",
  languageModel: defaultLanguageModel,
  contextOptions: {
    recentMessages: 40,
    excludeToolMessages: true,
  },
  contextHandler: buildChatContext,
  storageOptions: {
    saveMessages: "promptAndOutput",
  },
  stopWhen: stepCountIs(5),
});
