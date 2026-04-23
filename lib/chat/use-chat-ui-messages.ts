"use client";

import { readUIMessageStream, type UIMessageChunk } from "ai";
import { usePaginatedQuery } from "convex-helpers/react";
import { useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useEffect, useMemo, useState } from "react";
import { sorted } from "@convex-dev/agent";
import type { UIMessage } from "@convex-dev/agent/react";
import { api } from "@/convex/_generated/api";

type ChatUIMessage = UIMessage & { error?: string; aborted?: boolean };

type ListThreadMessagesQuery = typeof api.chat.messages.listThreadMessages;
type StreamMessage = {
  streamId: string;
  order: number;
  stepOrder: number;
  status: "streaming" | "finished" | "aborted";
  agentName?: string;
  format?: "UIMessageChunk" | "TextStreamPart";
};
type StreamDelta = {
  streamId: string;
  start: number;
  end: number;
  parts: unknown[];
};

type StreamState = {
  uiMessage: ChatUIMessage;
  cursor: number;
};

function joinText(parts: UIMessage["parts"]) {
  return parts
    .filter((part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
      part.type === "text",
    )
    .map((part) => part.text)
    .filter(Boolean)
    .join(" ");
}

function getToolCallId(
  part: UIMessage["parts"][number] & { toolCallId?: string },
) {
  return part.toolCallId;
}

function mergeParts(
  previousPart: UIMessage["parts"][number],
  nextPart: UIMessage["parts"][number],
): UIMessage["parts"][number] {
  const merged: Record<string, unknown> = { ...previousPart };
  for (const [key, value] of Object.entries(nextPart)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as UIMessage["parts"][number];
}

function combineChatMessages(messages: ChatUIMessage[]): ChatUIMessage[] {
  return messages.reduce((acc, message) => {
    if (!acc.length) return [message];
    const previous = acc.at(-1)!;
    if (
      message.order !== previous.order ||
      previous.role !== message.role ||
      message.role !== "assistant"
    ) {
      acc.push(message);
      return acc;
    }

    acc.pop();
    const newParts = [...previous.parts];
    for (const part of message.parts) {
      const toolCallId = getToolCallId(part);
      if (!toolCallId) {
        newParts.push(part);
        continue;
      }
      const previousPartIndex = newParts.findIndex(
        (existing) => getToolCallId(existing) === toolCallId,
      );
      if (previousPartIndex === -1) {
        newParts.push(part);
        continue;
      }
      const previousPart = newParts.splice(previousPartIndex, 1)[0];
      newParts.push(mergeParts(previousPart, part));
    }
    acc.push({
      ...previous,
      status: message.status,
      agentName: message.agentName,
      ...(message.metadata ? { metadata: message.metadata } : {}),
      ...(message.error ? { error: message.error } : {}),
      ...(message.aborted ? { aborted: true } : {}),
      parts: newParts,
      text: joinText(newParts),
    });
    return acc;
  }, [] as ChatUIMessage[]);
}

function dedupeChatMessages(
  messages: ChatUIMessage[],
  streamMessages: ChatUIMessage[],
): ChatUIMessage[] {
  return sorted(messages.concat(streamMessages)).reduce((acc, message) => {
    const last = acc.at(-1);
    if (!last) return [message];
    if (last.order !== message.order || last.stepOrder !== message.stepOrder) {
      return [...acc, message];
    }
    if (
      (last.status === "pending" || last.status === "streaming") &&
      message.status !== "pending"
    ) {
      return [...acc.slice(0, -1), message];
    }
    return acc;
  }, [] as ChatUIMessage[]);
}

function statusFromStreamStatus(
  status: StreamMessage["status"],
): ChatUIMessage["status"] {
  switch (status) {
    case "streaming":
      return "streaming";
    case "finished":
      return "success";
    case "aborted":
      return "failed";
    default:
      return "pending";
  }
}

function blankChatUIMessage(
  streamMessage: StreamMessage,
  threadId: string,
): ChatUIMessage {
  return {
    id: `stream:${streamMessage.streamId}`,
    key: `${threadId}-${streamMessage.order}-${streamMessage.stepOrder}`,
    order: streamMessage.order,
    stepOrder: streamMessage.stepOrder,
    status: statusFromStreamStatus(streamMessage.status),
    agentName: streamMessage.agentName,
    text: "",
    _creationTime: Date.now(),
    role: "assistant",
    parts: [],
  };
}

export function decorateStreamingMessage(
  uiMessage: ChatUIMessage,
  streamMessage: StreamMessage,
): ChatUIMessage {
  if (streamMessage.status !== "aborted") return uiMessage;
  return { ...uiMessage, aborted: true };
}

export function shouldRebuildStreamingState(
  streams: Array<{ streamMessage: StreamMessage; deltas: StreamDelta[] }>,
  messageState: Record<string, StreamState>,
): boolean {
  for (const stream of streams) {
    const lastDelta = stream.deltas.at(-1);
    const existing = messageState[stream.streamMessage.streamId];
    if (!existing) return true;
    if (lastDelta && lastDelta.start >= existing.cursor) return true;
    const expectedStatus = statusFromStreamStatus(stream.streamMessage.status);
    const expectedAborted = stream.streamMessage.status === "aborted";
    if (
      existing.uiMessage.status !== expectedStatus ||
      (existing.uiMessage.aborted === true) !== expectedAborted
    ) {
      return true;
    }
  }
  return false;
}

function getParts(deltas: StreamDelta[], fromCursor = 0) {
  const parts: UIMessageChunk[] = [];
  let cursor = fromCursor;
  for (const delta of deltas.sort((a, b) => a.start - b.start)) {
    if (delta.parts.length === 0) continue;
    if (cursor !== delta.start) {
      if (cursor >= delta.end) continue;
      if (cursor < delta.start) break;
      throw new Error(
        `Unexpected delta range for ${delta.streamId}: ${delta.start} -> ${delta.end} at cursor ${cursor}`,
      );
    }
    parts.push(...(delta.parts as UIMessageChunk[]));
    cursor = delta.end;
  }
  return { parts, cursor };
}

async function updateFromUIMessageChunks(
  uiMessage: ChatUIMessage,
  parts: UIMessageChunk[],
) {
  const partsStream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });

  let failed = false;
  let suppressError = false;
  const messageStream = readUIMessageStream({
    message: uiMessage,
    stream: partsStream,
    onError: (error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.toLowerCase().includes("no tool invocation found")) {
        suppressError = true;
        return;
      }
      failed = true;
      console.error("Error in stream", error);
    },
    terminateOnError: true,
  });

  let message = uiMessage;
  try {
    for await (const messagePart of messageStream) {
      if (messagePart.id !== message.id) {
        throw new Error("Expected one UI message per stream");
      }
      message = messagePart as ChatUIMessage;
    }
  } catch (error) {
    if (!suppressError) throw error;
  }

  if (failed) message.status = "failed";
  message.text = joinText(message.parts);
  return message;
}

function useStreamingChatMessages(
  threadId: string,
  startOrder: number,
): ChatUIMessage[] | undefined {
  const [state] = useState<{
    startOrder: number;
    threadId: string;
    deltaStreams:
      | Array<{
          streamMessage: StreamMessage;
          deltas: StreamDelta[];
        }>
      | undefined;
  }>({
    startOrder,
    deltaStreams: undefined,
    threadId,
  });
  const [cursors, setCursors] = useState<Record<string, number>>({});
  const [messageState, setMessageState] = useState<Record<string, StreamState>>(
    {},
  );

  if (state.threadId !== threadId) {
    state.threadId = threadId;
    state.deltaStreams = undefined;
    state.startOrder = startOrder;
    setCursors({});
    setMessageState({});
  }

  if (
    state.deltaStreams?.length ||
    (startOrder && startOrder < state.startOrder)
  ) {
    const cacheFriendlyStartOrder = startOrder - (startOrder % 10);
    if (cacheFriendlyStartOrder !== state.startOrder) {
      state.startOrder = cacheFriendlyStartOrder;
    }
  }

  const streamList = useQuery(api.chat.messages.listThreadMessages, {
    threadId,
    paginationOpts: { cursor: null, numItems: 0 },
    streamArgs: { kind: "list", startOrder: state.startOrder },
  });

  const streamMessages = streamList?.streams?.kind === "list"
    ? sorted(streamList.streams.messages.filter((stream) => stream.order >= startOrder))
    : state.deltaStreams?.map(({ streamMessage }) => streamMessage);

  if (streamMessages !== undefined && streamMessages.length === 0) {
    state.deltaStreams = undefined;
  }

  const cursorQuery = useQuery(
    api.chat.messages.listThreadMessages,
    !streamMessages?.length
      ? "skip"
      : {
          threadId,
          paginationOpts: { cursor: null, numItems: 0 },
          streamArgs: {
            kind: "deltas",
            cursors: streamMessages.map(({ streamId }) => ({
              streamId,
              cursor: cursors[streamId] ?? 0,
            })),
          },
        },
  );

  const newDeltas =
    cursorQuery?.streams?.kind === "deltas" ? cursorQuery.streams.deltas : undefined;

  if (newDeltas?.length && streamMessages) {
    const newDeltasByStreamId = new Map<string, StreamDelta[]>();
    for (const delta of newDeltas) {
      const oldCursor = cursors[delta.streamId];
      if (oldCursor && delta.start < oldCursor) continue;
      const existing = newDeltasByStreamId.get(delta.streamId);
      if (existing) {
        const previousEnd = existing.at(-1)?.end;
        if (previousEnd !== delta.start) {
          throw new Error(
            `Gap found in deltas for ${delta.streamId} jumping to ${delta.start} from ${previousEnd}`,
          );
        }
        existing.push(delta);
      } else {
        if (oldCursor && oldCursor !== delta.start) {
          throw new Error(
            `Gap found - first delta after ${oldCursor} is ${delta.start} for stream ${delta.streamId}`,
          );
        }
        newDeltasByStreamId.set(delta.streamId, [delta]);
      }
    }

    const newCursors: Record<string, number> = {};
    for (const { streamId } of streamMessages) {
      const cursor =
        newDeltasByStreamId.get(streamId)?.at(-1)?.end ?? cursors[streamId];
      if (cursor !== undefined) newCursors[streamId] = cursor;
    }
    setCursors(newCursors);

    state.deltaStreams = streamMessages.map((streamMessage) => {
      const streamId = streamMessage.streamId;
      const old = state.deltaStreams?.find(
        (deltaStream) => deltaStream.streamMessage.streamId === streamId,
      );
      const nextDeltas = newDeltasByStreamId.get(streamId);
      if (!nextDeltas && streamMessage === old?.streamMessage) {
        return old;
      }
      return {
        streamMessage,
        deltas: [...(old?.deltas ?? []), ...(nextDeltas ?? [])],
      };
    });
  } else if (streamMessages && state.deltaStreams) {
    state.deltaStreams = streamMessages.map((streamMessage) => {
      const old = state.deltaStreams?.find(
        (deltaStream) =>
          deltaStream.streamMessage.streamId === streamMessage.streamId,
      );
      return old ?? { streamMessage, deltas: [] };
    });
  }

  const streams = state.deltaStreams;

  useEffect(() => {
    if (!streams || !shouldRebuildStreamingState(streams, messageState)) return;
    const abortController = new AbortController();
    void (async () => {
      const nextState = Object.fromEntries(
        await Promise.all(
          streams.map(async ({ deltas, streamMessage }) => {
            const { parts, cursor } = getParts(deltas, 0);
            const uiMessage =
              streamMessage.format === "UIMessageChunk"
                ? await updateFromUIMessageChunks(
                    blankChatUIMessage(streamMessage, threadId),
                    parts,
                  )
                : blankChatUIMessage(streamMessage, threadId);
            return [
              streamMessage.streamId,
              {
                uiMessage: decorateStreamingMessage(uiMessage, streamMessage),
                cursor,
              },
            ] as const;
          }),
        ),
      );
      if (abortController.signal.aborted) return;
      setMessageState(nextState);
    })();
    return () => abortController.abort();
  }, [messageState, streams, threadId]);

  return useMemo(() => {
    if (!streams) return undefined;
    return streams
      .map(({ streamMessage }) => messageState[streamMessage.streamId]?.uiMessage)
      .filter((uiMessage): uiMessage is ChatUIMessage => uiMessage !== undefined);
  }, [messageState, streams]);
}

export function useChatUIMessages(threadId: string) {
  const paginated = usePaginatedQuery(
    api.chat.messages.listThreadMessages,
    { threadId } as FunctionArgs<ListThreadMessagesQuery>,
    { initialNumItems: 20 },
  );

  const startOrder = paginated.results.length
    ? Math.min(...paginated.results.map((message) => message.order))
    : 0;
  const streamMessages = useStreamingChatMessages(threadId, startOrder);

  return useMemo(() => {
    const combined = combineChatMessages(sorted(paginated.results as ChatUIMessage[]));
    return {
      ...paginated,
      results: dedupeChatMessages(combined, streamMessages ?? []),
    };
  }, [paginated, streamMessages]);
}
