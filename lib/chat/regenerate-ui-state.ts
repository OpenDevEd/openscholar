export type ChatRegenerateMessage = {
  id: string;
  key?: string;
  role?: string;
  status?: string;
  order: number;
  stepOrder: number;
  _creationTime?: number;
  parts?: Array<{ type: string; text?: string }>;
  text?: string;
  error?: string;
};

type LocalRegenerateStatus = "streaming" | "failed";

export type LocalRegenerateState = {
  replacedAssistantId: string;
  replacedAssistantIds?: string[];
  order: number;
  stepOrder: number;
  requestId: string;
  startedAt: number;
  backendStarted?: boolean;
  generationAttemptId?: string;
  status?: LocalRegenerateStatus;
  error?: string;
};

export function getLatestAssistantForRegenerate<
  T extends ChatRegenerateMessage,
>(messages: readonly T[]): T | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return messages[i];
  }
  return null;
}

export function localRegenerateMessageId(state: LocalRegenerateState): string {
  return `local-regenerate:${state.replacedAssistantId}`;
}

function buildLocalRegenerateMessage(
  state: LocalRegenerateState,
): ChatRegenerateMessage {
  const id = localRegenerateMessageId(state);
  return {
    id,
    key: id,
    role: "assistant",
    status: state.status ?? "streaming",
    order: state.order,
    stepOrder: state.stepOrder,
    _creationTime: state.startedAt,
    parts: [{ type: "text", text: "" }],
    text: "",
    error: state.error,
  };
}

export function hasServerRegenerateReplacement<T extends ChatRegenerateMessage>(
  messages: readonly T[],
  state: LocalRegenerateState,
): boolean {
  const localId = localRegenerateMessageId(state);
  const replacedIds = new Set([
    state.replacedAssistantId,
    ...(state.replacedAssistantIds ?? []),
  ]);
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      !replacedIds.has(message.id) &&
      message.id !== localId &&
      message.order === state.order,
  );
}

export function mergeLocalRegenerateMessage<T extends ChatRegenerateMessage>(
  messages: readonly T[],
  state: LocalRegenerateState | null,
): Array<T | ChatRegenerateMessage> {
  if (!state || hasServerRegenerateReplacement(messages, state)) {
    return [...messages];
  }

  const replacedIds = new Set([
    state.replacedAssistantId,
    ...(state.replacedAssistantIds ?? []),
  ]);
  const withoutOldAssistant = messages.filter(
    (message) => !replacedIds.has(message.id),
  );
  return [...withoutOldAssistant, buildLocalRegenerateMessage(state)].sort(
    (a, b) => a.order - b.order || a.stepOrder - b.stepOrder,
  );
}

export function isChatGenerationActive(
  messages: readonly ChatRegenerateMessage[],
  state: LocalRegenerateState | null = null,
  options: { isJobGenerating?: boolean } = {},
): boolean {
  if (state && state.status !== "failed") return true;
  if (options.isJobGenerating === false) return false;
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      (message.status === "pending" || message.status === "streaming"),
  );
}
