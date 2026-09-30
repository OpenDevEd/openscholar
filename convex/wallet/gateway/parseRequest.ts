import { tool, jsonSchema, Output } from "ai";
import type {
  ChatCompletionRequest,
  ChatMessage,
  OpenAIToolDefinition,
  OpenAIToolChoice,
  OpenAIResponseFormat,
  ContentPart,
  OpenAIToolCall,
  ReasoningEffort,
} from "./types";

// ─── Validation ─────────────────────────────────────────────

type ParseResult =
  | { ok: true; request: ChatCompletionRequest }
  | { ok: false; error: string };

const VALID_ROLES = new Set(["system", "user", "assistant", "tool"]);
const VALID_REASONING = new Set(["none", "low", "medium", "high"]);

export function parseAndValidateRequest(body: unknown): ParseResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body must be a JSON object" };
  }

  const b = body as Record<string, unknown>;

  // Required: model
  if (typeof b.model !== "string" || b.model.length === 0) {
    return { ok: false, error: '"model" is required and must be a non-empty string' };
  }

  // Required: messages
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    return { ok: false, error: '"messages" is required and must be a non-empty array' };
  }

  // Validate each message
  for (let i = 0; i < b.messages.length; i++) {
    const msg = b.messages[i] as Record<string, unknown>;
    if (!msg || typeof msg !== "object") {
      return { ok: false, error: `messages[${i}] must be an object` };
    }
    if (!VALID_ROLES.has(msg.role as string)) {
      return {
        ok: false,
        error: `messages[${i}].role must be one of: system, user, assistant, tool`,
      };
    }
    if (msg.role === "tool" && typeof msg.tool_call_id !== "string") {
      return {
        ok: false,
        error: `messages[${i}] with role "tool" must include a string "tool_call_id"`,
      };
    }
  }

  // Optional numeric validations
  if (b.temperature != null && typeof b.temperature !== "number") {
    return { ok: false, error: '"temperature" must be a number' };
  }
  if (b.top_p != null && typeof b.top_p !== "number") {
    return { ok: false, error: '"top_p" must be a number' };
  }

  // Validate tools array
  if (b.tools != null) {
    if (!Array.isArray(b.tools)) {
      return { ok: false, error: '"tools" must be an array' };
    }
    for (let i = 0; i < b.tools.length; i++) {
      const t = b.tools[i] as Record<string, unknown>;
      if (t?.type !== "function" || !t.function || typeof t.function !== "object") {
        return {
          ok: false,
          error: `tools[${i}] must have type "function" and a "function" object`,
        };
      }
      const fn = t.function as Record<string, unknown>;
      if (typeof fn.name !== "string" || fn.name.length === 0) {
        return {
          ok: false,
          error: `tools[${i}].function.name must be a non-empty string`,
        };
      }
    }
  }

  // Validate response_format
  if (b.response_format != null) {
    const rf = b.response_format as Record<string, unknown>;
    if (!["text", "json_object", "json_schema"].includes(rf.type as string)) {
      return {
        ok: false,
        error: '"response_format.type" must be "text", "json_object", or "json_schema"',
      };
    }
    if (rf.type === "json_schema") {
      const js = rf.json_schema as Record<string, unknown> | undefined;
      if (!js || typeof js.name !== "string") {
        return {
          ok: false,
          error: '"response_format.json_schema.name" is required for json_schema type',
        };
      }
    }
  }

  // Validate reasoning_effort
  if (b.reasoning_effort != null && !VALID_REASONING.has(b.reasoning_effort as string)) {
    return {
      ok: false,
      error: '"reasoning_effort" must be "none", "low", "medium", or "high"',
    };
  }

  // Validate web_search_options
  if (b.web_search_options != null) {
    const ws = b.web_search_options as Record<string, unknown>;
    if (typeof ws !== "object") {
      return { ok: false, error: '"web_search_options" must be an object' };
    }
    if (
      ws.search_context_size != null &&
      !["low", "medium", "high"].includes(ws.search_context_size as string)
    ) {
      return {
        ok: false,
        error: '"web_search_options.search_context_size" must be "low", "medium", or "high"',
      };
    }
    if (ws.user_location != null) {
      const loc = ws.user_location as Record<string, unknown>;
      if (typeof loc !== "object" || loc.type !== "approximate") {
        return {
          ok: false,
          error: '"web_search_options.user_location.type" must be "approximate"',
        };
      }
    }
  }

  return { ok: true, request: b as unknown as ChatCompletionRequest };
}

// ─── Conversion to AI SDK parameters ────────────────────────

export interface AISdkParams {
  allowSystemInMessages: true;
  messages: Array<Record<string, unknown>>;
  tools?: Record<string, ReturnType<typeof tool>>;
  toolChoice?: "auto" | "none" | "required" | { type: "tool"; toolName: string };
  output?: ReturnType<typeof Output.object> | ReturnType<typeof Output.json>;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  seed?: number;
}

export function convertToAISdkParams(request: ChatCompletionRequest): AISdkParams {
  const params: AISdkParams = {
    // Wallet callers supply their own instructions through the OpenAI messages API.
    allowSystemInMessages: true,
    messages: convertMessages(request.messages),
  };

  // Scalar settings
  if (request.temperature != null) params.temperature = request.temperature;
  if (request.top_p != null) params.topP = request.top_p;
  if (request.frequency_penalty != null)
    params.frequencyPenalty = request.frequency_penalty;
  if (request.presence_penalty != null)
    params.presencePenalty = request.presence_penalty;
  if (request.seed != null) params.seed = request.seed;

  // Max tokens — prefer max_completion_tokens over deprecated max_tokens
  const maxTokens = request.max_completion_tokens ?? request.max_tokens;
  if (maxTokens != null) params.maxOutputTokens = maxTokens;

  // Stop sequences
  if (request.stop != null) {
    params.stopSequences = Array.isArray(request.stop)
      ? request.stop
      : [request.stop];
  }

  // Tools
  if (request.tools && request.tools.length > 0) {
    params.tools = convertTools(request.tools);
  }

  // Tool choice
  if (request.tool_choice != null) {
    params.toolChoice = convertToolChoice(request.tool_choice);
  }

  // Response format → output
  if (request.response_format) {
    const output = convertResponseFormat(request.response_format);
    if (output) params.output = output;
  }

  return params;
}

// ─── Message conversion ─────────────────────────────────────

function convertMessages(
  messages: ChatMessage[],
): Array<Record<string, unknown>> {
  return messages.map((msg) => {
    switch (msg.role) {
      case "system":
        return { role: "system" as const, content: msg.content };

      case "user":
        return {
          role: "user" as const,
          content: convertUserContent(msg.content),
        };

      case "assistant":
        return buildAssistantMessage(msg.content, msg.tool_calls);

      case "tool":
        return {
          role: "tool" as const,
          content: [{ type: "text" as const, text: msg.content }],
          toolCallId: msg.tool_call_id,
        };
    }
  });
}

function convertUserContent(
  content: string | ContentPart[],
): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content;

  return content.map((part) => {
    if (part.type === "text") {
      return { type: "text" as const, text: part.text };
    }
    // image_url
    return {
      type: "image" as const,
      image: part.image_url.url,
    };
  });
}

function buildAssistantMessage(
  content: string | null | undefined,
  toolCalls: OpenAIToolCall[] | undefined,
): Record<string, unknown> {
  const msg: Record<string, unknown> = {
    role: "assistant" as const,
    content: content ?? "",
  };

  if (toolCalls && toolCalls.length > 0) {
    msg.toolCalls = toolCalls.map((tc) => ({
      toolCallId: tc.id,
      toolName: tc.function.name,
      args: safeJsonParse(tc.function.arguments),
    }));
  }

  return msg;
}

function safeJsonParse(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

// ─── Tool conversion ────────────────────────────────────────

function convertTools(
  tools: OpenAIToolDefinition[],
): Record<string, ReturnType<typeof tool>> {
  const result: Record<string, ReturnType<typeof tool>> = {};

  for (const t of tools) {
    const fn = t.function;
    // Tools without execute — AI SDK returns tool calls to the consumer
    result[fn.name] = tool({
      description: fn.description ?? "",
      inputSchema: jsonSchema(
        (fn.parameters as Record<string, unknown>) ?? {
          type: "object",
          properties: {},
        },
      ),
    });
  }

  return result;
}

// ─── Tool choice conversion ─────────────────────────────────

function convertToolChoice(
  choice: OpenAIToolChoice,
): "auto" | "none" | "required" | { type: "tool"; toolName: string } {
  if (typeof choice === "string") return choice;
  return { type: "tool", toolName: choice.function.name };
}

// ─── Response format conversion ─────────────────────────────

function convertResponseFormat(
  format: OpenAIResponseFormat,
): ReturnType<typeof Output.object> | ReturnType<typeof Output.json> | undefined {
  switch (format.type) {
    case "json_schema": {
      const rawSchema =
        (format.json_schema.schema as Record<string, unknown>) ?? {
          type: "object",
          properties: {},
        };
      return Output.object({
        schema: jsonSchema(normalizeSchemaForStrictMode(rawSchema)),
        name: format.json_schema.name,
        description: format.json_schema.description,
      });
    }

    case "json_object":
      return Output.json();

    case "text":
    default:
      return undefined;
  }
}

// ─── Strict-mode schema normalization ──────────────────────
//
// OpenAI's Structured Outputs (strict: true) requires:
//   1. All properties listed in `required`
//   2. `additionalProperties: false` on every object
//
// Properties that were originally optional get their type
// widened to include "null" so the model can still omit values.

export function normalizeSchemaForStrictMode(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  return normalizeNode(structuredClone(schema));
}

function normalizeNode(node: Record<string, unknown>): Record<string, unknown> {
  // Recurse into composition keywords
  for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(node[keyword])) {
      node[keyword] = (node[keyword] as Record<string, unknown>[]).map(normalizeNode);
    }
  }

  // Recurse into array items
  if (node.items && typeof node.items === "object" && !Array.isArray(node.items)) {
    node.items = normalizeNode(node.items as Record<string, unknown>);
  }

  // Only object nodes with properties need normalization
  if (node.type !== "object" || !node.properties) return node;

  const properties = node.properties as Record<string, Record<string, unknown>>;
  const originalRequired = new Set(
    Array.isArray(node.required) ? (node.required as string[]) : [],
  );
  const allKeys = Object.keys(properties);

  // Widen originally-optional properties to accept null
  for (const key of allKeys) {
    if (!originalRequired.has(key)) {
      properties[key] = widenToNullable(properties[key]);
    }
  }

  // Recurse into each property
  for (const key of allKeys) {
    properties[key] = normalizeNode(properties[key]);
  }

  node.required = allKeys;
  node.additionalProperties = false;

  return node;
}

function widenToNullable(
  prop: Record<string, unknown>,
): Record<string, unknown> {
  // Already nullable via anyOf/oneOf containing { type: "null" }
  for (const keyword of ["anyOf", "oneOf"] as const) {
    if (Array.isArray(prop[keyword])) {
      const variants = prop[keyword] as Record<string, unknown>[];
      const hasNull = variants.some(
        (v) => v.type === "null" || (Array.isArray(v.type) && (v.type as string[]).includes("null")),
      );
      if (!hasNull) {
        variants.push({ type: "null" });
      }
      return prop;
    }
  }

  // Type is an array — add "null" if not present
  if (Array.isArray(prop.type)) {
    if (!(prop.type as string[]).includes("null")) {
      (prop.type as string[]).push("null");
    }
    return prop;
  }

  // Type is a string — widen to [type, "null"]
  if (typeof prop.type === "string") {
    if (prop.type === "null") return prop;
    prop.type = [prop.type, "null"];
    return prop;
  }

  // No type info (e.g. $ref, const) — wrap in anyOf with null
  return { anyOf: [prop, { type: "null" }] };
}
