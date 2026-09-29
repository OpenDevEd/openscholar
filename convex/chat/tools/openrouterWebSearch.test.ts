import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, type ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import { buildOpenRouterWebSearchTool } from "./openrouterWebSearch";

describe("buildOpenRouterWebSearchTool", () => {
  it("sends its options inside `parameters`, the only place OpenRouter reads them", async () => {
    let body: { tools?: unknown[] } = {};
    const provider = createOpenRouter({
      apiKey: "test",
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({
          id: "gen-1",
          model: "openai/gpt-6-luna",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      },
    });

    await generateText({
      model: provider.chat("openai/gpt-6-luna"),
      prompt: "hi",
      tools: { web_search: buildOpenRouterWebSearchTool() } as ToolSet,
    });

    expect(body.tools).toEqual([
      {
        type: "openrouter:web_search",
        parameters: { engine: "exa", max_results: 5, max_uses: 3 },
      },
    ]);
  });
});
