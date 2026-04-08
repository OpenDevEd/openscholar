/** Maps AI SDK finish reasons to OpenAI Chat Completions finish reasons. */
export const FINISH_REASON_MAP: Record<string, string> = {
  stop: "stop",
  length: "length",
  "tool-calls": "tool_calls",
  "content-filter": "content_filter",
  error: "stop",
  other: "stop",
};

export function mapFinishReason(aiSdkReason: string): string {
  return FINISH_REASON_MAP[aiSdkReason] ?? "stop";
}

export const RESPONSE_ID_PREFIX = "gen_";
export const CHAT_COMPLETION_OBJECT = "chat.completion" as const;
export const CHAT_COMPLETION_CHUNK_OBJECT = "chat.completion.chunk" as const;
