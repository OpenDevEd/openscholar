import type { ModelMessage, ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { INCLUDE_DOMAINS_ACADEMIC } from "../../../lib/tavily/academic-domains";
import type {
  TavilySearchRequest,
  TavilySearchResponse,
} from "../../../lib/tavily/client";

const mockTavilySearch =
  vi.fn<
    (
      apiKey: string,
      req: TavilySearchRequest,
      fetchImpl?: typeof fetch,
      signal?: AbortSignal,
    ) => Promise<TavilySearchResponse>
  >();

vi.mock("../../../lib/tavily/client", () => ({
  tavilySearch: (...args: Parameters<typeof mockTavilySearch>) =>
    mockTavilySearch(...args),
}));

import {
  buildTavilyWebSearchTool,
  type TavilyWebSearchOutput,
} from "./tavilyWebSearch";

const SAMPLE_TAVILY_RESPONSE: TavilySearchResponse = {
  query: "carbon capture",
  results: [
    {
      title: "Direct air capture",
      url: "https://arxiv.org/abs/2401.00001",
      content: "Snippet about DAC",
      score: 0.91,
    },
    {
      title: "Mineralization pathways",
      url: "https://nature.com/articles/example",
      content: "Snippet about pathways",
      score: 0.82,
    },
  ],
  responseTime: 0.4,
  requestId: "req_basic",
  usage: { creditsUsed: 1 },
};

function makeExecOptions(
  abortSignal?: AbortSignal,
): ToolExecutionOptions {
  const opts: ToolExecutionOptions = {
    toolCallId: "call_1",
    messages: [] as ModelMessage[],
  };
  if (abortSignal) opts.abortSignal = abortSignal;
  return opts;
}

describe("buildTavilyWebSearchTool", () => {
  beforeEach(() => {
    mockTavilySearch.mockReset();
  });

  it("returns a function-type tool with non-empty description", () => {
    const tool = buildTavilyWebSearchTool({ apiKey: "tvly-x" });
    expect(tool.type ?? "function").toBe("function");
    expect(typeof tool.description).toBe("string");
    expect(tool.description!.length).toBeGreaterThan(0);
  });

  it("inputSchema accepts { query: string } and rejects an empty object", () => {
    const tool = buildTavilyWebSearchTool({ apiKey: "tvly-x" });
    const schema = tool.inputSchema as z.ZodTypeAny;
    expect(() => schema.parse({ query: "carbon capture" })).not.toThrow();
    expect(() => schema.parse({})).toThrow();
  });

  it("execute calls the client and returns mapped sources + creditsUsed", async () => {
    mockTavilySearch.mockResolvedValueOnce(SAMPLE_TAVILY_RESPONSE);
    const tool = buildTavilyWebSearchTool({ apiKey: "tvly-x" });
    const out = (await tool.execute!(
      { query: "carbon capture" },
      makeExecOptions(),
    )) as TavilyWebSearchOutput;
    expect(out).toEqual({
      sources: [
        {
          url: "https://arxiv.org/abs/2401.00001",
          title: "Direct air capture",
          snippet: "Snippet about DAC",
          score: 0.91,
        },
        {
          url: "https://nature.com/articles/example",
          title: "Mineralization pathways",
          snippet: "Snippet about pathways",
          score: 0.82,
        },
      ],
      creditsUsed: 1,
    });
  });

  it("forwards apiKey and the academic include-domains list when academicBias is on", async () => {
    mockTavilySearch.mockResolvedValueOnce(SAMPLE_TAVILY_RESPONSE);
    const tool = buildTavilyWebSearchTool({ apiKey: "tvly-secret" });
    await tool.execute!({ query: "x" }, makeExecOptions());
    expect(mockTavilySearch).toHaveBeenCalledTimes(1);
    const [apiKey, req] = mockTavilySearch.mock.calls[0]!;
    expect(apiKey).toBe("tvly-secret");
    expect(req.maxResults).toBe(5);
    expect(req.searchDepth).toBe("basic");
    expect(req.topic).toBe("general");
    expect(req.includeAnswer).toBe(false);
    expect(req.includeRawContent).toBe(false);
    expect(req.includeDomains).toEqual([...INCLUDE_DOMAINS_ACADEMIC]);
  });

  it("omits includeDomains when academicBias is false", async () => {
    mockTavilySearch.mockResolvedValueOnce(SAMPLE_TAVILY_RESPONSE);
    const tool = buildTavilyWebSearchTool({
      apiKey: "tvly-x",
      academicBias: false,
    });
    await tool.execute!({ query: "x" }, makeExecOptions());
    const [, req] = mockTavilySearch.mock.calls[0]!;
    expect(req.includeDomains).toBeUndefined();
  });

  it("invokes costSink exactly once with the credit count", async () => {
    mockTavilySearch.mockResolvedValueOnce(SAMPLE_TAVILY_RESPONSE);
    const costSink = vi.fn();
    const tool = buildTavilyWebSearchTool({ apiKey: "tvly-x", costSink });
    await tool.execute!({ query: "x" }, makeExecOptions());
    expect(costSink).toHaveBeenCalledTimes(1);
    expect(costSink).toHaveBeenCalledWith(1);
  });

  it("falls back to 2 credits for advanced searches when usage is missing", async () => {
    const noUsageResponse: TavilySearchResponse = {
      ...SAMPLE_TAVILY_RESPONSE,
    };
    delete noUsageResponse.usage;
    mockTavilySearch.mockResolvedValueOnce(noUsageResponse);
    const costSink = vi.fn();
    const tool = buildTavilyWebSearchTool({
      apiKey: "tvly-x",
      searchDepth: "advanced",
      costSink,
    });
    const out = (await tool.execute!(
      { query: "x" },
      makeExecOptions(),
    )) as TavilyWebSearchOutput;
    expect(out.creditsUsed).toBe(2);
    expect(costSink).toHaveBeenCalledWith(2);
  });

  it("falls back to 1 credit for basic searches when usage is missing", async () => {
    const noUsageResponse: TavilySearchResponse = {
      ...SAMPLE_TAVILY_RESPONSE,
    };
    delete noUsageResponse.usage;
    mockTavilySearch.mockResolvedValueOnce(noUsageResponse);
    const costSink = vi.fn();
    const tool = buildTavilyWebSearchTool({ apiKey: "tvly-x", costSink });
    const out = (await tool.execute!(
      { query: "x" },
      makeExecOptions(),
    )) as TavilyWebSearchOutput;
    expect(out.creditsUsed).toBe(1);
    expect(costSink).toHaveBeenCalledWith(1);
  });

  it("forwards abortSignal from ToolExecutionOptions to the client", async () => {
    mockTavilySearch.mockResolvedValueOnce(SAMPLE_TAVILY_RESPONSE);
    const controller = new AbortController();
    const tool = buildTavilyWebSearchTool({ apiKey: "tvly-x" });
    await tool.execute!({ query: "x" }, makeExecOptions(controller.signal));
    const [, , , signal] = mockTavilySearch.mock.calls[0]!;
    expect(signal).toBe(controller.signal);
  });

  it("applies a custom maxResults", async () => {
    mockTavilySearch.mockResolvedValueOnce(SAMPLE_TAVILY_RESPONSE);
    const tool = buildTavilyWebSearchTool({ apiKey: "tvly-x", maxResults: 10 });
    await tool.execute!({ query: "x" }, makeExecOptions());
    const [, req] = mockTavilySearch.mock.calls[0]!;
    expect(req.maxResults).toBe(10);
  });
});
