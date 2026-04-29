import { describe, expect, it } from "vitest";
import { pickWebSearchTool } from "./select-web-search-tool";

describe("pickWebSearchTool", () => {
  it("returns null when toggle is off", () => {
    expect(
      pickWebSearchTool({
        enabled: false,
        modelSupportsWebSearch: true,
        hasTavilyKey: true,
      }),
    ).toBeNull();
  });

  it("returns null when toggle is undefined", () => {
    expect(
      pickWebSearchTool({
        enabled: undefined,
        modelSupportsWebSearch: true,
        hasTavilyKey: true,
      }),
    ).toBeNull();
  });

  it("returns null when toggle is on but the model lacks tool support", () => {
    expect(
      pickWebSearchTool({
        enabled: true,
        modelSupportsWebSearch: false,
        hasTavilyKey: true,
      }),
    ).toBeNull();
  });

  it("returns 'tavily' when toggle is on, capability is true, and a Tavily key is present", () => {
    expect(
      pickWebSearchTool({
        enabled: true,
        modelSupportsWebSearch: true,
        hasTavilyKey: true,
      }),
    ).toBe("tavily");
  });

  it("returns 'openrouter' when toggle is on and capability is true but no Tavily key is configured", () => {
    expect(
      pickWebSearchTool({
        enabled: true,
        modelSupportsWebSearch: true,
        hasTavilyKey: false,
      }),
    ).toBe("openrouter");
  });
});
