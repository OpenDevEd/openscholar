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

/**
 * Backend, **stream-aware** "latest assistant turn" resolver.
 *
 * Used by `regenerateLastAssistant` to gate the regenerate mutation:
 * walks order classes from the highest down and returns the bundle of
 * `{user prompt, assistant message rows, stream rows}` belonging to the
 * latest turn that has BOTH a same-order user prompt AND at least one
 * assistant artifact (message row or stream row). Returns `null` when
 * the latest turn lacks an assistant artifact — that intentionally
 * refuses to regenerate "user-only" tails.
 *
 * **Orphan stream:** a `streams` row whose `order` has no same-order
 * user prompt in `messages`. Happens when an aborted stream artifact
 * survives but its parent user prompt was never persisted (or was
 * cleared). The walk skips orphan-only orders entirely so they cannot
 * trick regenerate into running with no real user prompt.
 *
 * NOT to be confused with `getLatestAssistantForRegenerate` in
 * lib/chat/regenerate-ui-state.ts — that one is a UI-side tail-scan
 * over render order, has no stream awareness, and happily walks past
 * trailing user-only messages. The two answer different questions on
 * different inputs and must remain distinct.
 */
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
