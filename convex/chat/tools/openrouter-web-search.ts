import { openrouter } from "@openrouter/ai-sdk-provider";

export const ACADEMIC_SEARCH_PROMPT = [
  "You are searching the web to supplement an academic paper corpus.",
  "Prefer scholarly sources (journals, preprint servers, official institutional pages).",
  "Avoid forums, social media, and content farms.",
  "Return at most 5 high-relevance results.",
].join(" ");

export interface BuildOpenRouterWebSearchOptions {
  academicBias?: boolean;
  maxResults?: number;
}

export function buildOpenRouterWebSearchTool(
  opts: BuildOpenRouterWebSearchOptions = {},
) {
  const { academicBias = true, maxResults = 5 } = opts;
  return openrouter.tools.webSearch({
    maxResults,
    engine: "auto",
    ...(academicBias ? { searchPrompt: ACADEMIC_SEARCH_PROMPT } : {}),
  });
}
