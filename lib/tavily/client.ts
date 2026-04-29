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

export const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

export class TavilyError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly retryAfter?: number;

  constructor(status: number, body: unknown, retryAfter?: number) {
    super(`Tavily ${status}`);
    this.name = "TavilyError";
    this.status = status;
    this.body = body;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

function parseRetryAfter(headerVal: string | null): number | undefined {
  if (headerVal === null) return undefined;
  const parsed = Number.parseInt(headerVal, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export async function tavilySearch(
  apiKey: string,
  req: TavilySearchRequest,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<TavilySearchResponse> {
  const init: RequestInit = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(toSnakeCaseBody(req)),
  };
  if (signal) init.signal = signal;
  const res = await fetchImpl(TAVILY_SEARCH_URL, init);
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // leave body as null when the upstream payload isn't JSON
    }
    throw new TavilyError(
      res.status,
      body,
      parseRetryAfter(res.headers.get("retry-after")),
    );
  }
  const json = (await res.json()) as unknown;
  return parseResponse(json);
}
