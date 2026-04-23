import { describe, expect, it } from "vitest";
import {
  decorateStreamingMessage,
  shouldRebuildStreamingState,
} from "./use-chat-ui-messages";

describe("use-chat-ui-messages helpers", () => {
  it("marks stream-backed aborted rows with aborted:true", () => {
    const message = decorateStreamingMessage(
      {
        id: "stream:s_1",
        key: "thread-1-0",
        order: 1,
        stepOrder: 0,
        status: "failed",
        role: "assistant",
        text: "",
        parts: [],
        _creationTime: 0,
      },
      {
        streamId: "s_1",
        order: 1,
        stepOrder: 0,
        status: "aborted",
        format: "UIMessageChunk",
      },
    );

    expect(message.aborted).toBe(true);
    expect(message.status).toBe("failed");
  });

  it("rebuilds when stream status changes without any new deltas", () => {
    const rebuild = shouldRebuildStreamingState(
      [
        {
          streamMessage: {
            streamId: "s_1",
            order: 1,
            stepOrder: 0,
            status: "aborted",
            format: "UIMessageChunk",
          },
          deltas: [],
        },
      ],
      {
        s_1: {
          cursor: 2,
          uiMessage: {
            id: "stream:s_1",
            key: "thread-1-0",
            order: 1,
            stepOrder: 0,
            status: "streaming",
            role: "assistant",
            text: "",
            parts: [],
            _creationTime: 0,
          },
        },
      },
    );

    expect(rebuild).toBe(true);
  });

  it("does not rebuild when cursor and status are unchanged", () => {
    const rebuild = shouldRebuildStreamingState(
      [
        {
          streamMessage: {
            streamId: "s_1",
            order: 1,
            stepOrder: 0,
            status: "streaming",
            format: "UIMessageChunk",
          },
          deltas: [{ streamId: "s_1", start: 0, end: 2, parts: [] }],
        },
      ],
      {
        s_1: {
          cursor: 2,
          uiMessage: {
            id: "stream:s_1",
            key: "thread-1-0",
            order: 1,
            stepOrder: 0,
            status: "streaming",
            role: "assistant",
            text: "",
            parts: [],
            _creationTime: 0,
          },
        },
      },
    );

    expect(rebuild).toBe(false);
  });
});
