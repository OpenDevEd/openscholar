import {
  CHAT_COMPLETION_OBJECT,
  CHAT_COMPLETION_CHUNK_OBJECT,
  RESPONSE_ID_PREFIX,
  mapFinishReason,
} from "./constants";
import type {
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatCompletionUsage,
  OpenAIToolCall,
  ChunkToolCall,
  MessageAnnotation,
} from "./types";
import type { EnhancedUsage } from "./cost";

// ─── ID generation ──────────────────────────────────────────

export function generateResponseId(): string {
  return `${RESPONSE_ID_PREFIX}${crypto.randomUUID()}`;
}

// ─── Usage formatting ───────────────────────────────────────

export function formatUsage(usage: EnhancedUsage): ChatCompletionUsage {
  return {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.inputTokens + usage.outputTokens,
    prompt_tokens_details:
      usage.cacheReadTokens > 0
        ? { cached_tokens: usage.cacheReadTokens }
        : undefined,
    completion_tokens_details:
      usage.reasoningTokens > 0
        ? { reasoning_tokens: usage.reasoningTokens }
        : undefined,
  };
}

// ─── Non-streaming response ─────────────────────────────────

export function formatNonStreamingResponse(params: {
  id: string;
  model: string;
  text: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; args: unknown }>;
  finishReason: string;
  usage: EnhancedUsage;
  sources?: Array<{ url: string; title?: string }>;
}): ChatCompletionResponse {
  const { id, model, text, toolCalls, finishReason, usage, sources } = params;

  const message: ChatCompletionResponse["choices"][0]["message"] = {
    role: "assistant",
    content: toolCalls.length > 0 ? null : text,
  };

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls.map<OpenAIToolCall>((tc) => ({
      id: tc.toolCallId,
      type: "function",
      function: {
        name: tc.toolName,
        arguments: typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args),
      },
    }));
  }

  if (sources && sources.length > 0) {
    message.annotations = sources.map<MessageAnnotation>((s) => ({
      type: "url_citation",
      url_citation: { url: s.url, title: s.title },
    }));
  }

  return {
    id,
    object: CHAT_COMPLETION_OBJECT,
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: mapFinishReason(finishReason),
      },
    ],
    usage: formatUsage(usage),
  };
}

// ─── SSE helpers ────────────────────────────────────────────

function sseEvent(data: string): string {
  return `data: ${data}\n\n`;
}

function sseChunk(chunk: ChatCompletionChunk): string {
  return sseEvent(JSON.stringify(chunk));
}

function sseDone(): string {
  return "data: [DONE]\n\n";
}

// ─── Streaming response builder ─────────────────────────────

/**
 * Creates a ReadableStream that converts AI SDK `fullStream` events
 * into OpenAI-compatible SSE chunks.
 */
export function createStreamingResponse(params: {
  id: string;
  model: string;
  fullStream: AsyncIterable<Record<string, unknown>>;
  includeUsage: boolean;
  onFinishReason?: (reason: string) => void;
  /**
   * Runs after the last upstream part and before the response closes, so
   * work awaited here (billing) finishes inside the request. Gets the
   * number of web sources the model cited.
   */
  onDone?: (sourceCount: number) => Promise<void>;
}): ReadableStream<Uint8Array> {
  const { id, model, fullStream, includeUsage, onFinishReason, onDone } = params;
  const encoder = new TextEncoder();
  let sentRoleChunk = false;
  let lastFinishReason = "stop";
  let lastUsage: ChatCompletionUsage | undefined;
  let sourceCount = 0;
  let toolCallCounter = 0;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      // A client that disconnects closes the stream; keep reading the
      // upstream anyway so the whole generation is counted and billed.
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // Client gone.
        }
      };
      try {
        for await (const part of fullStream) {
          const type = part.type as string;

          switch (type) {
            case "text-delta": {
              // AI SDK v6 uses `text`; older versions used `textDelta`
              const textContent =
                (part.text as string | undefined) ??
                (part.textDelta as string | undefined) ??
                "";
              if (!textContent) break;

              // Send role chunk on first content
              if (!sentRoleChunk) {
                send(sseChunk(makeChunk(id, model, { role: "assistant", content: "" }, null)));
                sentRoleChunk = true;
              }
              send(sseChunk(makeChunk(id, model, { content: textContent }, null)));
              break;
            }

            // AI SDK v6: tool-input-start (v5: tool-call-streaming-start)
            case "tool-input-start":
            case "tool-call-streaming-start": {
              if (!sentRoleChunk) {
                send(sseChunk(makeChunk(id, model, { role: "assistant" }, null)));
                sentRoleChunk = true;
              }
              // v6 uses `id` for the tool call ID; v5 used `toolCallId`
              const tcId =
                (part.id as string | undefined) ??
                (part.toolCallId as string | undefined) ??
                `call_${crypto.randomUUID()}`;
              const toolCallChunk: ChunkToolCall = {
                index: (part.toolCallIndex as number) ?? toolCallCounter++,
                id: tcId,
                type: "function",
                function: { name: part.toolName as string, arguments: "" },
              };
              send(sseChunk(makeChunk(id, model, { tool_calls: [toolCallChunk] }, null)));
              break;
            }

            // AI SDK v6: tool-input-delta (v5: tool-call-delta)
            // v6 uses `delta`; v5 used `argsTextDelta`
            case "tool-input-delta":
            case "tool-call-delta": {
              const argsDelta =
                (part.delta as string | undefined) ??
                (part.argsTextDelta as string | undefined) ??
                "";
              const deltaChunk: ChunkToolCall = {
                index: (part.toolCallIndex as number) ?? Math.max(0, toolCallCounter - 1),
                function: { arguments: argsDelta },
              };
              send(sseChunk(makeChunk(id, model, { tool_calls: [deltaChunk] }, null)));
              break;
            }

            case "finish-step": {
              const reason = (part.finishReason as string) ?? "stop";
              lastFinishReason = reason;
              const stepUsage = part.usage as {
                inputTokens?: number;
                outputTokens?: number;
                inputTokenDetails?: {
                  cacheReadTokens?: number;
                  cacheWriteTokens?: number;
                };
                outputTokenDetails?: { reasoningTokens?: number };
              } | undefined;
              if (stepUsage) {
                lastUsage = {
                  prompt_tokens: stepUsage.inputTokens ?? 0,
                  completion_tokens: stepUsage.outputTokens ?? 0,
                  total_tokens:
                    (stepUsage.inputTokens ?? 0) +
                    (stepUsage.outputTokens ?? 0),
                  prompt_tokens_details:
                    (stepUsage.inputTokenDetails?.cacheReadTokens ?? 0) > 0
                      ? {
                          cached_tokens:
                            stepUsage.inputTokenDetails?.cacheReadTokens ?? 0,
                        }
                      : undefined,
                  completion_tokens_details:
                    (stepUsage.outputTokenDetails?.reasoningTokens ?? 0) > 0
                      ? {
                          reasoning_tokens:
                            stepUsage.outputTokenDetails?.reasoningTokens ?? 0,
                        }
                      : undefined,
                };
              }
              break;
            }

            case "finish": {
              const finalReason =
                (part.finishReason as string) ?? lastFinishReason;
              onFinishReason?.(finalReason);

              // Finish reason chunk
              send(sseChunk(makeChunk(id, model, {}, mapFinishReason(finalReason))));

              // Usage chunk (if requested)
              if (includeUsage && lastUsage) {
                const usageChunk: ChatCompletionChunk = {
                  id,
                  object: CHAT_COMPLETION_CHUNK_OBJECT,
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [],
                  usage: lastUsage,
                };
                send(sseChunk(usageChunk));
              }

              // [DONE] sentinel
              send(sseDone());
              break;
            }

            case "error": {
              const errMsg =
                part.error instanceof Error
                  ? (part.error as Error).message
                  : String(part.error);
              const errorChunk: ChatCompletionChunk = {
                id,
                object: CHAT_COMPLETION_CHUNK_OBJECT,
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                  {
                    index: 0,
                    delta: { content: `\n\n[ERROR] ${errMsg}` },
                    finish_reason: null,
                  },
                ],
              };
              send(sseChunk(errorChunk));
              break;
            }

            case "source": {
              sourceCount++;
              break;
            }

            case "abort": {
              const reason = (part.reason as string | undefined) ?? "Stream aborted";
              const abortChunk: ChatCompletionChunk = {
                id,
                object: CHAT_COMPLETION_CHUNK_OBJECT,
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                  {
                    index: 0,
                    delta: { content: `\n\n[ABORTED] ${reason}` },
                    finish_reason: "stop",
                  },
                ],
              };
              send(sseChunk(abortChunk));
              send(sseDone());
              break;
            }

            // Silently skip text-start, text-end, reasoning, file,
            // tool-input-end, start, start-step, raw, etc.
            default:
              break;
          }
        }
      } catch (err) {
        // Stream-level error — emit error event and close
        const errMsg =
          err instanceof Error ? err.message : "Stream processing failed";
        send(sseEvent(JSON.stringify({ error: { message: errMsg, type: "server_error" } })));
        send(sseDone());
      } finally {
        await onDone?.(sourceCount);
        try {
          controller.close();
        } catch {
          // Client gone.
        }
      }
    },
  });
}

// ─── Chunk builder ──────────────────────────────────────────

function makeChunk(
  id: string,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null,
): ChatCompletionChunk {
  return {
    id,
    object: CHAT_COMPLETION_CHUNK_OBJECT,
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}
