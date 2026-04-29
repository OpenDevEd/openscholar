import { tool } from "ai";
import { z } from "zod";
import { INCLUDE_DOMAINS_ACADEMIC } from "../../../lib/tavily/academic-domains";
import {
  type TavilySearchRequest,
  tavilySearch,
} from "../../../lib/tavily/client";

export interface TavilyWebSource {
  url: string;
  title: string;
  snippet: string;
  score: number;
}

export interface TavilyWebSearchOutput {
  sources: TavilyWebSource[];
  creditsUsed: number;
}

export interface BuildTavilyWebSearchOptions {
  apiKey: string;
  academicBias?: boolean;
  maxResults?: number;
  searchDepth?: "basic" | "advanced";
  costSink?: (creditsUsed: number) => Promise<void> | void;
}

const TAVILY_TOOL_DESCRIPTION = [
  "Search the web ONLY when the included papers do not cover the user's question, or to add adjacent on-topic context.",
  "Always prefer paper [Pn] citations from the corpus over web sources.",
  "Use one short, focused query per call. Do not repeat searches.",
].join(" ");

const inputSchema = z.object({
  query: z
    .string()
    .describe(
      "A focused web search query that complements the user's paper corpus.",
    ),
});

export function buildTavilyWebSearchTool(opts: BuildTavilyWebSearchOptions) {
  const {
    apiKey,
    academicBias = true,
    maxResults = 5,
    searchDepth = "basic",
    costSink,
  } = opts;

  return tool({
    description: TAVILY_TOOL_DESCRIPTION,
    inputSchema,
    execute: async ({ query }, { abortSignal }): Promise<TavilyWebSearchOutput> => {
      const req: TavilySearchRequest = {
        query,
        searchDepth,
        maxResults,
        topic: "general",
        includeAnswer: false,
        includeRawContent: false,
      };
      if (academicBias) {
        req.includeDomains = [...INCLUDE_DOMAINS_ACADEMIC];
      }
      const res = await tavilySearch(apiKey, req, undefined, abortSignal);
      const creditsUsed =
        res.usage?.creditsUsed ?? (searchDepth === "advanced" ? 2 : 1);
      if (costSink) await costSink(creditsUsed);
      return {
        sources: res.results.map((r) => ({
          url: r.url,
          title: r.title,
          snippet: r.content,
          score: r.score,
        })),
        creditsUsed,
      };
    },
  });
}
