import { internalMutation } from "../_generated/server";

/**
 * Seed the walletModels table with the initial model catalog.
 * Run once: npx convex run wallet/seedModels:seed
 * Idempotent — skips models that already exist.
 */

const SEED_MODELS = [
  // OpenAI
  { modelId: "gpt-5.2", name: "GPT-5.2", provider: "openai" as const, description: "OpenAI's latest flagship model", contextWindow: 400000, inputPricePerMillion: 1.75, outputPricePerMillion: 14.0, capabilities: ["vision", "function-calling", "reasoning"], category: "flagship", sortOrder: 1 },
  { modelId: "gpt-5-mini", name: "GPT-5 Mini", provider: "openai" as const, description: "Fast and cost-effective GPT-5 model", contextWindow: 400000, inputPricePerMillion: 0.25, outputPricePerMillion: 2.0, capabilities: ["vision", "function-calling"], category: "efficient", sortOrder: 2 },
  { modelId: "gpt-4o", name: "GPT-4o", provider: "openai" as const, description: "Multimodal model with 128K context", contextWindow: 128000, inputPricePerMillion: 2.5, outputPricePerMillion: 10.0, capabilities: ["vision", "function-calling"], category: "standard", sortOrder: 3 },
  { modelId: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai" as const, description: "Fast and efficient small model", contextWindow: 128000, inputPricePerMillion: 0.15, outputPricePerMillion: 0.6, capabilities: ["vision", "function-calling"], category: "efficient", sortOrder: 4 },
  { modelId: "o4-mini", name: "o4-mini", provider: "openai" as const, description: "Latest compact reasoning model with vision", contextWindow: 200000, inputPricePerMillion: 1.1, outputPricePerMillion: 4.4, capabilities: ["vision", "function-calling", "reasoning"], category: "reasoning", sortOrder: 5 },
  { modelId: "o3", name: "o3", provider: "openai" as const, description: "Advanced reasoning model with vision", contextWindow: 200000, inputPricePerMillion: 2.0, outputPricePerMillion: 8.0, capabilities: ["vision", "function-calling", "reasoning"], category: "reasoning", sortOrder: 6 },
  // Google
  { modelId: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "google" as const, description: "Fast and efficient multimodal model", contextWindow: 1048576, inputPricePerMillion: 0.3, outputPricePerMillion: 2.5, capabilities: ["vision", "function-calling", "reasoning"], category: "efficient", sortOrder: 10 },
  { modelId: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "google" as const, description: "Advanced model with 1M token context", contextWindow: 1048576, inputPricePerMillion: 1.25, outputPricePerMillion: 10.0, capabilities: ["vision", "function-calling", "reasoning"], category: "flagship", sortOrder: 11 },
  // Anthropic
  { modelId: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", provider: "anthropic" as const, description: "Latest balanced performance model", contextWindow: 200000, inputPricePerMillion: 3.0, outputPricePerMillion: 15.0, capabilities: ["vision", "function-calling", "reasoning"], category: "flagship", sortOrder: 20 },
  { modelId: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic" as const, description: "Latest fast and efficient model", contextWindow: 200000, inputPricePerMillion: 1.0, outputPricePerMillion: 5.0, capabilities: ["vision", "function-calling", "reasoning"], category: "efficient", sortOrder: 21 },
  // DeepSeek
  { modelId: "deepseek-chat", name: "DeepSeek Chat", provider: "deepseek" as const, description: "DeepSeek Chat model", contextWindow: 128000, inputPricePerMillion: 0.14, outputPricePerMillion: 0.28, capabilities: [], category: "budget", sortOrder: 30 },
] as const;

export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    let added = 0;
    let skipped = 0;

    for (const model of SEED_MODELS) {
      const existing = await ctx.db
        .query("walletModels")
        .withIndex("by_model_id", (q) => q.eq("modelId", model.modelId))
        .unique();

      if (existing) {
        skipped++;
        continue;
      }

      const now = Date.now();
      await ctx.db.insert("walletModels", {
        ...model,
        capabilities: [...model.capabilities],
        costMarkup: 1.3,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      added++;
    }

    console.log(`[seedModels] Added ${added}, skipped ${skipped} (already exist)`);
    return { added, skipped };
  },
});
