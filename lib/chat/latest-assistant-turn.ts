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

  const orders = new Set<number>();
  for (const message of messages) {
    orders.add(message.order);
  }
  for (const stream of streams) {
    orders.add(stream.order);
  }

  const ordered = [...orders].sort((a, b) => b - a);
  for (const order of ordered) {
    const turnMessages = messages.filter((message) => message.order === order);
    const promptMessage = turnMessages.find(
      (message) => message.message?.role === "user",
    );
    const assistantMessageIds = turnMessages
      .filter((message) => message.message?.role === "assistant")
      .map((message) => message._id);
    const streamIds = streams
      .filter((stream) => stream.order === order)
      .map((stream) => stream.streamId);
    const hasAssistantArtifact =
      assistantMessageIds.length > 0 || streamIds.length > 0;

    if (promptMessage && hasAssistantArtifact) {
      return {
        assistantOrder: order,
        promptMessageId: promptMessage._id,
        assistantMessageIds,
        streamIds,
      };
    }

    if (promptMessage && !hasAssistantArtifact) return null;
  }

  return null;
}
