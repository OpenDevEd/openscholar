export type LatestAssistantTurnMessage = {
  _id: string;
  order: number;
  message?: {
    role?: string | null;
  } | null;
};

export type LatestAssistantTurnStream = {
  streamId: string;
  order: number;
};

export type LatestAssistantTurnResolution = {
  assistantOrder: number;
  promptMessageId: string;
  assistantMessageIds: string[];
  streamIds: string[];
};

export function resolveLatestAssistantTurn(args: {
  messages: LatestAssistantTurnMessage[];
  streams: LatestAssistantTurnStream[];
}): LatestAssistantTurnResolution | null {
  const { messages, streams } = args;

  let highestOrder = Number.NEGATIVE_INFINITY;
  for (const message of messages) {
    if (message.order > highestOrder) highestOrder = message.order;
  }
  for (const stream of streams) {
    if (stream.order > highestOrder) highestOrder = stream.order;
  }

  if (!Number.isFinite(highestOrder)) return null;

  const highestOrderMessages = messages.filter(
    (message) => message.order === highestOrder,
  );
  const assistantMessageIds = highestOrderMessages
    .filter((message) => message.message?.role === "assistant")
    .map((message) => message._id);
  const streamIds = streams
    .filter((stream) => stream.order === highestOrder)
    .map((stream) => stream.streamId);

  if (assistantMessageIds.length === 0 && streamIds.length === 0) {
    return null;
  }

  const promptMessage = highestOrderMessages.find(
    (message) => message.message?.role === "user",
  );
  if (!promptMessage) return null;

  return {
    assistantOrder: highestOrder,
    promptMessageId: promptMessage._id,
    assistantMessageIds,
    streamIds,
  };
}
