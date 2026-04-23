import { describe, expect, it } from "vitest";

import { resolveLatestAssistantTurn } from "./latest-assistant-turn";

describe("resolveLatestAssistantTurn", () => {
  it("resolves the latest persisted assistant turn and its prior user prompt", () => {
    expect(
      resolveLatestAssistantTurn({
        messages: [
          {
            _id: "assistant-4-step-1",
            order: 4,
            message: { role: "assistant" },
          },
          {
            _id: "user-3",
            order: 3,
            message: { role: "user" },
          },
          {
            _id: "assistant-2",
            order: 2,
            message: { role: "assistant" },
          },
        ],
        streams: [],
      }),
    ).toEqual({
      assistantOrder: 4,
      promptMessageId: "user-3",
      assistantMessageIds: ["assistant-4-step-1"],
      streamIds: [],
    });
  });

  it("includes same-order stream artifacts for a stopped assistant turn", () => {
    expect(
      resolveLatestAssistantTurn({
        messages: [
          {
            _id: "assistant-6-step-1",
            order: 6,
            message: { role: "assistant" },
          },
          {
            _id: "user-5",
            order: 5,
            message: { role: "user" },
          },
        ],
        streams: [
          { streamId: "stream-6-a", order: 6 },
          { streamId: "stream-6-b", order: 6 },
        ],
      }),
    ).toEqual({
      assistantOrder: 6,
      promptMessageId: "user-5",
      assistantMessageIds: ["assistant-6-step-1"],
      streamIds: ["stream-6-a", "stream-6-b"],
    });
  });

  it("can resolve a stopped turn from stream artifacts even when no assistant message row remains", () => {
    expect(
      resolveLatestAssistantTurn({
        messages: [
          {
            _id: "user-8",
            order: 8,
            message: { role: "user" },
          },
          {
            _id: "assistant-7",
            order: 7,
            message: { role: "assistant" },
          },
          {
            _id: "user-5",
            order: 5,
            message: { role: "user" },
          },
        ],
        streams: [{ streamId: "stream-6", order: 6 }],
      }),
    ).toBeNull();

    expect(
      resolveLatestAssistantTurn({
        messages: [
          {
            _id: "user-5",
            order: 5,
            message: { role: "user" },
          },
          {
            _id: "assistant-4",
            order: 4,
            message: { role: "assistant" },
          },
        ],
        streams: [{ streamId: "stream-6", order: 6 }],
      }),
    ).toEqual({
      assistantOrder: 6,
      promptMessageId: "user-5",
      assistantMessageIds: [],
      streamIds: ["stream-6"],
    });
  });

  it("returns null when the newest turn is not an assistant turn", () => {
    expect(
      resolveLatestAssistantTurn({
        messages: [
          {
            _id: "user-4",
            order: 4,
            message: { role: "user" },
          },
          {
            _id: "assistant-3",
            order: 3,
            message: { role: "assistant" },
          },
        ],
        streams: [],
      }),
    ).toBeNull();
  });

  it("returns null when no prior user prompt exists", () => {
    expect(
      resolveLatestAssistantTurn({
        messages: [
          {
            _id: "assistant-1",
            order: 1,
            message: { role: "assistant" },
          },
        ],
        streams: [],
      }),
    ).toBeNull();
  });
});
