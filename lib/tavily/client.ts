import { z } from "zod";

export interface TavilySearchRequest {
  query: string;
  searchDepth?: "basic" | "advanced";
  maxResults?: number;
  topic?: "general" | "news";
  includeAnswer?: boolean | "basic" | "advanced";
  includeRawContent?: boolean | "markdown" | "text";
  includeDomains?: string[];
  excludeDomains?: string[];
  timeRange?: "day" | "week" | "month" | "year";
  country?: string;
  chunksPerSource?: number;
  includeUsage?: boolean;
}

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  rawContent?: string;
  publishedDate?: string;
}

export interface TavilySearchResponse {
  query: string;
  answer?: string;
  results: TavilySearchResult[];
  responseTime: number;
  requestId: string;
  usage?: { creditsUsed: number };
}

export function toSnakeCaseBody(
  req: TavilySearchRequest,
): Record<string, unknown> {
  const body: Record<string, unknown> = { query: req.query };
  if (req.searchDepth !== undefined) body.search_depth = req.searchDepth;
  if (req.maxResults !== undefined) body.max_results = req.maxResults;
  if (req.topic !== undefined) body.topic = req.topic;
  if (req.includeAnswer !== undefined) body.include_answer = req.includeAnswer;
  if (req.includeRawContent !== undefined)
    body.include_raw_content = req.includeRawContent;
  if (req.includeDomains !== undefined)
    body.include_domains = req.includeDomains;
  if (req.excludeDomains !== undefined)
    body.exclude_domains = req.excludeDomains;
  if (req.timeRange !== undefined) body.time_range = req.timeRange;
  if (req.country !== undefined) body.country = req.country;
  if (req.chunksPerSource !== undefined)
    body.chunks_per_source = req.chunksPerSource;
  if (req.includeUsage !== undefined) body.include_usage = req.includeUsage;
  return body;
}

const ResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string(),
  score: z.number(),
  raw_content: z.string().optional(),
  published_date: z.string().optional(),
});

const ApiResponseSchema = z.object({
  query: z.string(),
  answer: z.string().optional(),
  results: z.array(ResultSchema),
  response_time: z.number(),
  request_id: z.string(),
  usage: z.object({ credits: z.number() }).optional(),
});

export function parseResponse(json: unknown): TavilySearchResponse {
  const parsed = ApiResponseSchema.parse(json);
  const response: TavilySearchResponse = {
    query: parsed.query,
    results: parsed.results.map((r) => {
      const result: TavilySearchResult = {
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score,
      };
      if (r.raw_content !== undefined) result.rawContent = r.raw_content;
      if (r.published_date !== undefined)
        result.publishedDate = r.published_date;
      return result;
    }),
    responseTime: parsed.response_time,
    requestId: parsed.request_id,
  };
  if (parsed.answer !== undefined) response.answer = parsed.answer;
  if (parsed.usage) response.usage = { creditsUsed: parsed.usage.credits };
  return response;
}
