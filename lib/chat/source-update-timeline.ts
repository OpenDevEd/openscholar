export type SourceUpdateTimelineMessage = {
  role?: string;
  order?: number;
};

export type SourceUpdateBoundary = {
  boundaryOrder: number;
} | null | undefined;

function messageOrder(message: SourceUpdateTimelineMessage | null | undefined) {
  return typeof message?.order === "number" ? message.order : null;
}

export function isAssistantCitationDeprecated(
  message: SourceUpdateTimelineMessage,
  boundary: SourceUpdateBoundary,
): boolean {
  const order = messageOrder(message);
  return (
    boundary != null &&
    message.role === "assistant" &&
    order != null &&
    order < boundary.boundaryOrder
  );
}

export function shouldRenderSourceUpdateDividerBeforeMessage({
  previous,
  message,
  boundary,
}: {
  previous?: SourceUpdateTimelineMessage | null;
  message: SourceUpdateTimelineMessage;
  boundary: SourceUpdateBoundary;
}): boolean {
  if (!boundary) return false;
  const currentOrder = messageOrder(message);
  if (currentOrder == null || currentOrder < boundary.boundaryOrder) {
    return false;
  }

  const previousOrder = messageOrder(previous);
  return previousOrder == null || previousOrder < boundary.boundaryOrder;
}

export function shouldRenderSourceUpdateDividerAfterMessages(
  messages: readonly SourceUpdateTimelineMessage[],
  boundary: SourceUpdateBoundary,
): boolean {
  if (!boundary || messages.length === 0) return false;
  return messages.every((message) => {
    const order = messageOrder(message);
    return order == null || order < boundary.boundaryOrder;
  });
}
