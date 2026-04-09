# OpenScholar Wallet API Specification

> **Base URL**: `https://api.openscholar.ai`
>
> **Version**: v1
>
> **Protocol**: OpenAI Chat Completions-compatible REST API

The Wallet API is an OpenAI-compatible AI gateway that lets third-party applications and direct users call AI models using their OpenScholar credit balance. All models route through OpenRouter, with automatic credit deduction per request.

---

## Authentication

All endpoints (except `GET /api/wallet/v1/models`) require a Wallet API key passed as a Bearer token.

```
Authorization: Bearer wk_...
```

Keys are prefixed with `wk_`, followed by 32 cryptographically random bytes encoded as base64url. The raw key is shown **once** at creation and cannot be retrieved again -- only its SHA-256 hash is stored.

### Origin Enforcement

Keys created through the browser-based OAuth flow are bound to a specific `redirectOrigin`. Requests from these keys **must** include an `Origin` header matching the registered origin. Keys created manually (via the settings UI) have `redirectOrigin: "manual"` and accept requests from any origin.

---

## Rate Limits

Requests are rate-limited per user via the `wallet-generate` limiter. When exceeded, the API returns `429 Too Many Requests`.

---

## Endpoints

### POST /api/wallet/v1/chat/completions

Generate a chat completion. Supports streaming (default) and non-streaming modes.

#### Request Body

```jsonc
{
  // REQUIRED
  "model": "string",             // Model ID (e.g. "openai/gpt-4o", "anthropic/claude-sonnet-4-20250514")
  "messages": [],                // Non-empty array of message objects

  // OPTIONAL -- Generation Parameters
  "temperature": 0.7,            // number | null -- Sampling temperature (0-2)
  "top_p": 1.0,                  // number | null -- Nucleus sampling threshold
  "frequency_penalty": 0.0,      // number | null -- Penalize repeated tokens
  "presence_penalty": 0.0,       // number | null -- Penalize tokens already present
  "max_completion_tokens": 4096, // number | null -- Max output tokens (preferred)
  "max_tokens": 4096,            // number | null -- Deprecated alias for max_completion_tokens
  "stop": ["END"],               // string | string[] | null -- Stop sequences
  "seed": 42,                    // number | null -- Deterministic sampling seed

  // OPTIONAL -- Streaming
  "stream": true,                // boolean | null -- Enable SSE streaming (default: true)
  "stream_options": {            // StreamOptions | null
    "include_usage": false       // Include a final usage chunk in the stream
  },

  // OPTIONAL -- Tool Use
  "tools": [],                   // Array of tool definitions
  "tool_choice": "auto",         // "auto" | "none" | "required" | { type: "function", function: { name: "..." } }

  // OPTIONAL -- Output Format
  "response_format": {},         // ResponseFormat object

  // OPTIONAL -- Reasoning
  "reasoning_effort": "medium",  // "none" | "low" | "medium" | "high"

  // OPTIONAL -- Web Search
  "web_search_options": {},      // WebSearchOptions object

  // OPTIONAL -- Provider Pass-through
  "provider_options": {}         // Record<string, Record<string, unknown>>
}
```

#### Message Types

**System message**

```json
{ "role": "system", "content": "You are a helpful assistant.", "name": "optional" }
```

**User message** -- text or multimodal

```jsonc
// Text
{ "role": "user", "content": "Hello!" }

// Multimodal (text + image)
{
  "role": "user",
  "content": [
    { "type": "text", "text": "What is in this image?" },
    { "type": "image_url", "image_url": { "url": "https://example.com/img.png", "detail": "auto" } }
  ]
}
```

**Assistant message** -- text or tool calls

```jsonc
// Text
{ "role": "assistant", "content": "The answer is 42." }

// Tool calls
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": { "name": "get_weather", "arguments": "{\"city\":\"Paris\"}" }
    }
  ]
}
```

**Tool result message**

```json
{ "role": "tool", "content": "{\"temp\": 22}", "tool_call_id": "call_abc123" }
```

#### Tool Definitions

```json
{
  "type": "function",
  "function": {
    "name": "get_weather",
    "description": "Get the current weather for a city",
    "parameters": {
      "type": "object",
      "properties": {
        "city": { "type": "string" }
      },
      "required": ["city"]
    },
    "strict": null
  }
}
```

#### Response Format

Three modes are supported:

```jsonc
// Plain text (default)
{ "type": "text" }

// Unstructured JSON
{ "type": "json_object" }

// Structured JSON with schema enforcement
{
  "type": "json_schema",
  "json_schema": {
    "name": "PaperMetadata",          // required
    "description": "Extracted paper metadata",
    "schema": {
      "type": "object",
      "properties": {
        "title": { "type": "string" },
        "year": { "type": "number" }
      },
      "required": ["title", "year"]
    },
    "strict": null
  }
}
```

**Strict-mode normalization**: The gateway automatically normalizes `json_schema` schemas for OpenAI strict-mode compatibility. This means:
- All properties are added to `required` (even if omitted in your request)
- `additionalProperties: false` is set on every object node
- Properties that were **not** originally in `required` have their type widened to accept `null` (e.g. `"type": "string"` becomes `"type": ["string", "null"]`)

This lets you send schemas with optional fields without worrying about strict-mode constraints -- the model will return `null` for fields it has no value for.

#### Web Search Options

When provided, the model is given real-time web search access via OpenRouter's `:online` suffix.

```jsonc
{
  "search_context_size": "medium", // "low" | "medium" | "high"
  "user_location": {               // Approximate location for localized results
    "type": "approximate",         // Must be "approximate"
    "city": "San Francisco",
    "country": "US",
    "region": "California",
    "timezone": "America/Los_Angeles"
  },
  "allowed_domains": ["arxiv.org", "pubmed.ncbi.nlm.nih.gov"],
  "blocked_domains": ["spam.com"],
  "max_uses": 5
}
```

#### Reasoning Effort

The `reasoning_effort` field provides a unified interface across providers. The API maps it to provider-specific configurations automatically:

| Provider | `low` | `medium` | `high` |
|----------|-------|----------|--------|
| Anthropic | `thinking.budgetTokens: 1024` | `thinking.budgetTokens: 8192` | `thinking.budgetTokens: 32768` |
| OpenAI | `reasoningEffort: "low"` | `reasoningEffort: "medium"` | `reasoningEffort: "high"` |
| Google | `thinkingBudget: 1024` | `thinkingBudget: 8192` | `thinkingBudget: 32768` |
| DeepSeek | `thinking: enabled` | `thinking: enabled` | `thinking: enabled` |

Setting `"none"` or omitting the field disables reasoning. Only applies to models with `"reasoning"` in their `capabilities`.

#### Non-Streaming Response (`stream: false`)

```jsonc
{
  "id": "gen_550e8400-e29b-41d4-a716-446655440000",
  "object": "chat.completion",
  "created": 1712000000,
  "model": "openai/gpt-4o",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "The answer is 42.",
        "tool_calls": [],          // Present only when the model calls tools
        "annotations": []          // Present only when web search returns sources
      },
      "finish_reason": "stop"      // "stop" | "length" | "tool_calls" | "content_filter"
    }
  ],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 10,
    "total_tokens": 35,
    "prompt_tokens_details": {         // Present only when cache tokens > 0
      "cached_tokens": 20
    },
    "completion_tokens_details": {     // Present only when reasoning tokens > 0
      "reasoning_tokens": 5
    }
  }
}
```

**Tool call response** -- when the model invokes tools, `content` is `null` and `finish_reason` is `"tool_calls"`:

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [
        {
          "id": "call_abc123",
          "type": "function",
          "function": {
            "name": "get_weather",
            "arguments": "{\"city\":\"Paris\"}"
          }
        }
      ]
    },
    "finish_reason": "tool_calls"
  }]
}
```

**Web search annotations** -- when sources are found:

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "According to recent research...",
      "annotations": [
        {
          "type": "url_citation",
          "url_citation": {
            "url": "https://arxiv.org/abs/2401.12345",
            "title": "AI Advances 2024"
          }
        }
      ]
    }
  }]
}
```

#### Streaming Response (default)

The response is an SSE stream of `chat.completion.chunk` objects, terminated by `data: [DONE]`.

**Role chunk** (first):

```
data: {"id":"gen_...","object":"chat.completion.chunk","created":1712000000,"model":"openai/gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}
```

**Content delta chunks**:

```
data: {"id":"gen_...","object":"chat.completion.chunk","created":1712000000,"model":"openai/gpt-4o","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"gen_...","object":"chat.completion.chunk","created":1712000000,"model":"openai/gpt-4o","choices":[{"index":0,"delta":{"content":", world!"},"finish_reason":null}]}
```

**Tool call streaming chunks**:

```
data: {"id":"gen_...","object":"chat.completion.chunk","created":1712000000,"model":"openai/gpt-4o","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}

data: {"id":"gen_...","object":"chat.completion.chunk","created":1712000000,"model":"openai/gpt-4o","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"city\":"}}]},"finish_reason":null}]}

data: {"id":"gen_...","object":"chat.completion.chunk","created":1712000000,"model":"openai/gpt-4o","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"Paris\"}"}}]},"finish_reason":null}]}
```

**Finish chunk**:

```
data: {"id":"gen_...","object":"chat.completion.chunk","created":1712000000,"model":"openai/gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}
```

**Usage chunk** (only when `stream_options.include_usage: true`):

```
data: {"id":"gen_...","object":"chat.completion.chunk","created":1712000000,"model":"openai/gpt-4o","choices":[],"usage":{"prompt_tokens":25,"completion_tokens":10,"total_tokens":35}}
```

**Terminator**:

```
data: [DONE]
```

---

### GET /api/wallet/v1/models

List all available models with capabilities, pricing, and metadata. **No authentication required.**

#### Response

```jsonc
{
  "object": "list",
  "data": [
    {
      "id": "openai/gpt-4o",                    // Model ID to use in requests
      "object": "model",
      "created": 1712000000,
      "owned_by": "openai",                      // Provider name
      "name": "GPT-4o",                          // Human-readable name
      "description": "Most capable GPT-4 model", // Optional description
      "context_window": 128000,                  // Max context length in tokens
      "max_completion_tokens": 16384,            // Max output tokens

      "capabilities": [                          // Array of supported features
        "tools",
        "reasoning",
        "structured_outputs",
        "temperature",
        "web_search"                             // All models support web search via :online suffix
      ],

      "category": "flagship",                   // Optional grouping

      // Architecture
      "modality": "text+image->text",
      "input_modalities": ["text", "image"],
      "output_modalities": ["text"],
      "tokenizer": "o200k_base",

      // Lifecycle
      "knowledge_cutoff": "2024-06",
      "is_moderated": true,

      // Pricing (in credits, after markup)
      "pricing": {
        "input_per_million_tokens": 3.25,
        "output_per_million_tokens": 13.0,
        "reasoning_per_million_tokens": 19.5,    // Only for reasoning-capable models
        "cache_read_per_million_tokens": 0.325,  // Only if cache pricing exists
        "cache_write_per_million_tokens": 4.875, // Only if cache pricing exists
        "web_search_per_request": 0.0325,        // Only if web search pricing exists
        "currency": "credits"
      },

      // Defaults
      "default_temperature": 1.0
    }
  ]
}
```

---

### GET /api/wallet/balance

Check the authenticated user's credit balance.

#### Headers

```
Authorization: Bearer wk_...
```

#### Response

```json
{
  "free": 450,
  "paid": 200,
  "total": 650
}
```

All values are integers representing credits. Returns `{ "free": 0, "paid": 0, "total": 0 }` if no balance record exists.

---

## Error Handling

All errors follow the OpenAI error format:

```json
{
  "error": {
    "message": "Human-readable error description",
    "type": "error_type",
    "param": null,
    "code": null
  }
}
```

### Error Codes

| HTTP Status | Type | When |
|-------------|------|------|
| `400` | `invalid_request_error` | Malformed JSON, missing required fields, invalid parameter values, unknown model |
| `401` | `invalid_request_error` | Missing or invalid API key |
| `402` | `insufficient_quota` | Credit balance is zero or negative |
| `403` | `invalid_request_error` | Origin mismatch (key bound to a different origin) or missing `Origin` header for origin-bound keys |
| `429` | `rate_limit_error` | Per-user rate limit exceeded |
| `502` | `server_error` | Upstream provider failure or model initialization error |

### Streaming Errors

If an error occurs mid-stream, it is emitted as a content delta with an `[ERROR]` prefix:

```
data: {"choices":[{"delta":{"content":"\n\n[ERROR] Provider rate limited"},"finish_reason":null}]}
```

If a stream is aborted, an `[ABORTED]` content delta is emitted with `finish_reason: "stop"`, followed by `data: [DONE]`.

---

## CORS

All endpoints support cross-origin requests. Preflight (`OPTIONS`) handlers return:

```
Access-Control-Allow-Origin: <request origin or *>
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

For origin-bound keys, the `Access-Control-Allow-Origin` header reflects the registered origin. For manual keys, it mirrors the request's `Origin` header, or defaults to `*`.

---

## Credit Billing

Credits are deducted **after** each generation completes (or after the stream finishes).

### Cost Formula

```
cost_usd = (input_tokens / 1M * input_price)
          + (output_tokens / 1M * output_price)
          + (reasoning_tokens / 1M * reasoning_price)
          + (cache_read_tokens / 1M * cache_read_price)
          + (cache_write_tokens / 1M * cache_write_price)
          + (web_search_requests * web_search_price)

credits = ceil(cost_usd * cost_markup * 10000)
credits = max(1, credits)  // minimum 1 credit for any non-zero usage
```

- `cost_markup` is per-model (visible as the ratio between raw provider prices and the `/models` endpoint prices)
- Conversion rate: **10,000 credits = $1.00 USD**
- Reasoning tokens fall back to the output token price when no dedicated reasoning price exists
- Missing optional prices (cache, web search) are treated as $0

### Transaction Metadata

Each deduction is recorded with:

```json
{
  "source": "wallet_api",
  "appName": "MyApp",
  "model": "openai/gpt-4o",
  "provider": "openai",
  "inputTokens": "1500",
  "outputTokens": "500",
  "reasoningTokens": "0",
  "cacheReadTokens": "0",
  "webSearchRequests": "0",
  "finishReason": "stop"
}
```

---

## Examples

### Simple completion

```bash
curl https://api.openscholar.ai/api/wallet/v1/chat/completions \
  -H "Authorization: Bearer wk_abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [
      { "role": "user", "content": "What is a systematic review?" }
    ],
    "stream": false
  }'
```

### Streaming with usage

```bash
curl -N https://api.openscholar.ai/api/wallet/v1/chat/completions \
  -H "Authorization: Bearer wk_abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-sonnet-4-20250514",
    "messages": [
      { "role": "system", "content": "You are a research assistant." },
      { "role": "user", "content": "Compare PRISMA 2020 and PRISMA 2009." }
    ],
    "stream_options": { "include_usage": true }
  }'
```

### Tool calling loop

```bash
# Step 1: Initial request with tools
curl https://api.openscholar.ai/api/wallet/v1/chat/completions \
  -H "Authorization: Bearer wk_abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "stream": false,
    "messages": [
      { "role": "user", "content": "What is the weather in London?" }
    ],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather for a city",
        "parameters": {
          "type": "object",
          "properties": { "city": { "type": "string" } },
          "required": ["city"]
        }
      }
    }],
    "tool_choice": "auto"
  }'

# Response has finish_reason: "tool_calls" with tool_calls array
# Step 2: Send tool result back
curl https://api.openscholar.ai/api/wallet/v1/chat/completions \
  -H "Authorization: Bearer wk_abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "stream": false,
    "messages": [
      { "role": "user", "content": "What is the weather in London?" },
      { "role": "assistant", "content": null, "tool_calls": [{ "id": "call_abc", "type": "function", "function": { "name": "get_weather", "arguments": "{\"city\":\"London\"}" } }] },
      { "role": "tool", "content": "{\"temp\": 14, \"condition\": \"Cloudy\"}", "tool_call_id": "call_abc" }
    ],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather for a city",
        "parameters": {
          "type": "object",
          "properties": { "city": { "type": "string" } },
          "required": ["city"]
        }
      }
    }]
  }'
```

### Structured output

```bash
curl https://api.openscholar.ai/api/wallet/v1/chat/completions \
  -H "Authorization: Bearer wk_abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "stream": false,
    "messages": [
      { "role": "user", "content": "Extract metadata: \"Deep Learning for NLP by Smith & Jones, NeurIPS 2023\"" }
    ],
    "response_format": {
      "type": "json_schema",
      "json_schema": {
        "name": "PaperMetadata",
        "schema": {
          "type": "object",
          "properties": {
            "title": { "type": "string" },
            "authors": { "type": "array", "items": { "type": "string" } },
            "venue": { "type": "string" },
            "year": { "type": "number" }
          },
          "required": ["title", "authors", "year"]
        }
      }
    }
  }'
```

### Web search with reasoning

```bash
curl -N https://api.openscholar.ai/api/wallet/v1/chat/completions \
  -H "Authorization: Bearer wk_abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [
      { "role": "user", "content": "What are the latest developments in CRISPR-Cas9 therapy trials?" }
    ],
    "reasoning_effort": "high",
    "web_search_options": {
      "search_context_size": "high",
      "allowed_domains": ["clinicaltrials.gov", "pubmed.ncbi.nlm.nih.gov", "nature.com"]
    }
  }'
```

### Vision (image input)

```bash
curl https://api.openscholar.ai/api/wallet/v1/chat/completions \
  -H "Authorization: Bearer wk_abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "stream": false,
    "messages": [{
      "role": "user",
      "content": [
        { "type": "text", "text": "What does this figure show?" },
        { "type": "image_url", "image_url": { "url": "https://example.com/figure1.png" } }
      ]
    }]
  }'
```

### OpenAI SDK drop-in

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "wk_abc123...",
  baseURL: "https://api.openscholar.ai/api/wallet/v1",
});

// Works identically to the OpenAI SDK
const completion = await client.chat.completions.create({
  model: "anthropic/claude-sonnet-4-20250514",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(completion.choices[0].message.content);
```

### Check balance

```bash
curl https://api.openscholar.ai/api/wallet/balance \
  -H "Authorization: Bearer wk_abc123..."
```

### List models

```bash
curl https://api.openscholar.ai/api/wallet/v1/models
```
