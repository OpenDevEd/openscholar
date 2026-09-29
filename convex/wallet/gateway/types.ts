// ─── OpenAI Chat Completions API Types ──────────────────────

// ─── Request Types ──────────────────────────────────────────

export type TextContentPart = { type: "text"; text: string };
export type ImageContentPart = {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
};
export type ContentPart = TextContentPart | ImageContentPart;

export type SystemMessage = {
  role: "system";
  content: string;
  name?: string;
};

export type UserMessage = {
  role: "user";
  content: string | ContentPart[];
  name?: string;
};

export type AssistantMessage = {
  role: "assistant";
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  name?: string;
};

export type ToolMessage = {
  role: "tool";
  content: string;
  tool_call_id: string;
};

export type ChatMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;

export type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type OpenAIToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean | null;
  };
};

export type OpenAIToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

export type ResponseFormatText = { type: "text" };
export type ResponseFormatJsonObject = { type: "json_object" };
export type ResponseFormatJsonSchema = {
  type: "json_schema";
  json_schema: {
    name: string;
    description?: string;
    schema?: Record<string, unknown>;
    strict?: boolean | null;
  };
};
export type OpenAIResponseFormat =
  | ResponseFormatText
  | ResponseFormatJsonObject
  | ResponseFormatJsonSchema;

export type ReasoningEffort = "none" | "low" | "medium" | "high";

export type WebSearchUserLocation = {
  type: "approximate";
  city?: string;
  country?: string;
  region?: string;
  timezone?: string;
};

export type WebSearchOptions = {
  search_context_size?: "low" | "medium" | "high";
  user_location?: WebSearchUserLocation | null;
  /** Domain allow-list (OpenAI Responses API, Anthropic). */
  allowed_domains?: string[];
  /** Domain block-list (Anthropic only). */
  blocked_domains?: string[];
  /** Maximum number of searches (Anthropic only). */
  max_uses?: number;
};

export type StreamOptions = {
  include_usage?: boolean;
};

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number | null;
  top_p?: number | null;
  frequency_penalty?: number | null;
  presence_penalty?: number | null;
  max_tokens?: number | null;
  max_completion_tokens?: number | null;
  stop?: string | string[] | null;
  seed?: number | null;
  stream?: boolean | null;
  stream_options?: StreamOptions | null;
  tools?: OpenAIToolDefinition[];
  tool_choice?: OpenAIToolChoice;
  response_format?: OpenAIResponseFormat;
  reasoning_effort?: ReasoningEffort;
  web_search_options?: WebSearchOptions | null;
  provider_options?: Record<string, Record<string, unknown>>;
}

// ─── Response Types ─────────────────────────────────────────

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
}

export interface MessageAnnotation {
  type: "url_citation";
  url_citation: {
    url: string;
    title?: string;
    start_index?: number;
    end_index?: number;
  };
}

export interface ChatCompletionResponseMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  annotations?: MessageAnnotation[];
  refusal?: string | null;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatCompletionResponseMessage;
  finish_reason: string;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage;
}

// ─── Streaming Types ────────────────────────────────────────

export interface ChatCompletionChunkDelta {
  role?: "assistant";
  content?: string | null;
  tool_calls?: ChunkToolCall[];
  annotations?: MessageAnnotation[];
}

export interface ChunkToolCall {
  index: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkDelta;
  finish_reason: string | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  usage?: ChatCompletionUsage | null;
}
