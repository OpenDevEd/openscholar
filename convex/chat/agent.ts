import { Agent, stepCountIs } from "@convex-dev/agent";
import type { ModelMessage } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { SERVER_AI_CONFIG } from "../ai/config";
import { calculateServerCreditsToDeduct } from "../ai/helpers";

/**
 * Default chat agent.
 *
 * - languageModel is a fallback — generateResponse overrides it per-turn
 *   via resolveOpenRouterModel(ctx, job.chatModelId).
 * - No embeddingModel: chat has no RAG path; answers come from abstracts
 *   embedded directly in the system prompt.
 * - stopWhen: stepCountIs(1) disables tool looping — V1 has no tools.
 * - usageHandler deducts credits via the exact same path extraction
 *   uses (calculateServerCreditsToDeduct → internal.credits.internal
 *   .deductCredits), so the billing math stays unified. V1 has no
 *   prompt caching so cacheReadTokens is always 0 — consistent with
 *   extraction, which also doesn't discount cache reads today.
 */
const defaultModelId = SERVER_AI_CONFIG.model.includes("/")
  ? SERVER_AI_CONFIG.model
  : `${SERVER_AI_CONFIG.provider}/${SERVER_AI_CONFIG.model}`;

const openrouter = createOpenRouter();
const defaultLanguageModel = openrouter.chat(defaultModelId);

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
    { jobId: meta.jobId },
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
  stopWhen: stepCountIs(1),
  usageHandler: async (ctx, { userId, usage, model }) => {
    if (!userId) return;

    const pricing = await ctx.runQuery(
      internal.models.queries.getPricing,
      { modelId: model },
    );

    const credits = calculateServerCreditsToDeduct(
      usage,
      pricing ?? { input: 0, output: 0 },
    );
    if (credits <= 0) return;

    await ctx.runMutation(internal.credits.internal.deductCredits, {
      userId: userId as Id<"users">,
      amount: credits,
      description: "AI: Chat message",
      billingType: "chat",
      metadata: {
        model,
        inputTokens: String(usage.inputTokens ?? 0),
        outputTokens: String(usage.outputTokens ?? 0),
      },
    });
  },
});
