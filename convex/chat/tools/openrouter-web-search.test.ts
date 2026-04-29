import { describe, expect, it } from "vitest";
import {
  ACADEMIC_SEARCH_PROMPT,
  buildOpenRouterWebSearchTool,
} from "./openrouter-web-search";

describe("buildOpenRouterWebSearchTool", () => {
  it("returns a provider-typed tool with the OpenRouter web_search id", () => {
    const tool = buildOpenRouterWebSearchTool();
    expect(tool.type).toBe("provider");
    if (tool.type !== "provider") throw new Error("expected provider tool");
    expect(tool.id).toBe("openrouter.web_search");
  });

  it("defaults to academic search prompt, maxResults=5, engine='auto'", () => {
    const tool = buildOpenRouterWebSearchTool();
    if (tool.type !== "provider") throw new Error("expected provider tool");
    expect(tool.args).toEqual({
      maxResults: 5,
      searchPrompt: ACADEMIC_SEARCH_PROMPT,
      engine: "auto",
    });
  });

  it("omits searchPrompt when academicBias is false", () => {
    const tool = buildOpenRouterWebSearchTool({ academicBias: false });
    if (tool.type !== "provider") throw new Error("expected provider tool");
    expect(tool.args).not.toHaveProperty("searchPrompt");
    expect(tool.args.maxResults).toBe(5);
    expect(tool.args.engine).toBe("auto");
  });

  it("forwards a custom maxResults", () => {
    const tool = buildOpenRouterWebSearchTool({ maxResults: 10 });
    if (tool.type !== "provider") throw new Error("expected provider tool");
    expect(tool.args.maxResults).toBe(10);
  });

  it("exports the academic search prompt as a non-empty string", () => {
    expect(typeof ACADEMIC_SEARCH_PROMPT).toBe("string");
    expect(ACADEMIC_SEARCH_PROMPT.length).toBeGreaterThan(0);
  });
});
