import { describe, expect, it } from "vitest";
import {
  getLatestAssistantForRegenerate,
  isChatGenerationActive,
  mergeLocalRegenerateMessage,
  type ChatRegenerateMessage,
  type LocalRegenerateState,
} from "./regenerate-ui-state";

function message(
  overrides: Partial<ChatRegenerateMessage>,
): ChatRegenerateMessage {
  return {
    id: "m_default",
    key: "m_default",
    role: "assistant",
    status: "success",
    order: 0,
    stepOrder: 0,
    _creationTime: 0,
    parts: [{ type: "text", text: "done" }],
    text: "done",
    ...overrides,
  };
}

describe("regenerate UI state", () => {
  it("replaces the previous assistant with a local streaming placeholder", () => {
    const previousAssistant = message({
      id: "m_assistant_old",
      key: "m_assistant_old",
      order: 2,
      stepOrder: 1,
      text: "old answer",
    });
    const state: LocalRegenerateState = {
      replacedAssistantId: previousAssistant.id,
      order: previousAssistant.order,
      stepOrder: previousAssistant.stepOrder,
      requestId: "r1",
      startedAt: 123,
    };

    const merged = mergeLocalRegenerateMessage(
      [
        message({ id: "m_user", role: "user", order: 2, stepOrder: 0 }),
        previousAssistant,
      ],
      state,
    );

    expect(merged.map((item) => item.id)).toEqual([
      "m_user",
      "local-regenerate:m_assistant_old",
    ]);
    expect(merged[1]).toMatchObject({
      role: "assistant",
      status: "streaming",
      text: "",
      order: 2,
      stepOrder: 1,
    });
  });

  it("lets the server replacement win when a new assistant for the same turn arrives", () => {
    const state: LocalRegenerateState = {
      replacedAssistantId: "m_assistant_old",
      order: 2,
      stepOrder: 1,
      requestId: "r1",
      startedAt: 123,
    };
    const serverFailure = message({
      id: "m_assistant_failed",
      key: "m_assistant_failed",
      status: "failed",
      error: "provider error",
      order: 2,
      stepOrder: 1,
      text: "",
    });

    const merged = mergeLocalRegenerateMessage([serverFailure], state);

    expect(merged.map((item) => item.id)).toEqual(["m_assistant_failed"]);
    expect(merged[0]).toHaveProperty("error", "provider error");
  });

  it("lets server replacement win even when the replacement step order differs", () => {
    const state: LocalRegenerateState = {
      replacedAssistantId: "m_assistant_old",
      order: 2,
      stepOrder: 2,
      requestId: "r1",
      startedAt: 123,
    };
    const serverFailure = message({
      id: "m_assistant_failed",
      key: "m_assistant_failed",
      status: "failed",
      error: "provider error",
      order: 2,
      stepOrder: 1,
      text: "",
    });

    const merged = mergeLocalRegenerateMessage([serverFailure], state);

    expect(merged.map((item) => item.id)).toEqual(["m_assistant_failed"]);
  });

  it("keeps the local placeholder visible after the old assistant is purged but before the new row arrives", () => {
    const state: LocalRegenerateState = {
      replacedAssistantId: "m_assistant_old",
      order: 2,
      stepOrder: 1,
      requestId: "r1",
      startedAt: 123,
    };

    const merged = mergeLocalRegenerateMessage(
      [message({ id: "m_user", role: "user", order: 2, stepOrder: 0 })],
      state,
    );

    expect(merged.map((item) => item.id)).toEqual([
      "m_user",
      "local-regenerate:m_assistant_old",
    ]);
  });

  it("renders a local regenerate failure as a failed assistant message", () => {
    const state: LocalRegenerateState = {
      replacedAssistantId: "m_assistant_old",
      order: 2,
      stepOrder: 1,
      requestId: "r1",
      startedAt: 123,
      status: "failed",
      error: "regenerate failed",
    };

    const merged = mergeLocalRegenerateMessage(
      [
        message({ id: "m_user", role: "user", order: 2, stepOrder: 0 }),
        message({ id: "m_assistant_old", order: 2, stepOrder: 1 }),
      ],
      state,
    );

    expect(merged.map((item) => item.id)).toEqual([
      "m_user",
      "local-regenerate:m_assistant_old",
    ]);
    expect(merged[1]).toMatchObject({
      role: "assistant",
      status: "failed",
      error: "regenerate failed",
      text: "",
    });
  });

  it("reports generation active for local placeholders and server pending/streaming assistants", () => {
    expect(
      isChatGenerationActive([], {
        replacedAssistantId: "m_assistant_old",
        order: 2,
        stepOrder: 1,
        requestId: "r1",
        startedAt: 123,
      }),
    ).toBe(true);
    expect(
      isChatGenerationActive([], {
        replacedAssistantId: "m_assistant_old",
        order: 2,
        stepOrder: 1,
        requestId: "r1",
        startedAt: 123,
        status: "failed",
        error: "regenerate failed",
      }),
    ).toBe(false);
    expect(
      isChatGenerationActive([
        message({ id: "m_pending", status: "pending" }),
      ]),
    ).toBe(true);
    expect(
      isChatGenerationActive([
        message({ id: "m_streaming", status: "streaming" }),
      ]),
    ).toBe(true);
    expect(
      isChatGenerationActive([
        message({ id: "m_failed", status: "failed", error: "boom" }),
      ]),
    ).toBe(false);
  });

  it("does not treat stale server pending messages as active after the job lock is gone", () => {
    expect(
      isChatGenerationActive(
        [message({ id: "m_pending", status: "pending" })],
        null,
        { isJobGenerating: false },
      ),
    ).toBe(false);
    expect(
      isChatGenerationActive(
        [message({ id: "m_streaming", status: "streaming" })],
        null,
        { isJobGenerating: true },
      ),
    ).toBe(true);
  });

  it("selects the latest assistant as the regenerate target", () => {
    const latest = getLatestAssistantForRegenerate([
      message({ id: "m_user_1", role: "user", order: 1, stepOrder: 0 }),
      message({ id: "m_assistant_1", order: 1, stepOrder: 1 }),
      message({ id: "m_user_2", role: "user", order: 2, stepOrder: 0 }),
      message({ id: "m_assistant_2", order: 2, stepOrder: 1 }),
    ]);

    expect(latest?.id).toBe("m_assistant_2");
  });
});
