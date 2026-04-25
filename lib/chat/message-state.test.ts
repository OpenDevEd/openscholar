import { describe, expect, it } from "vitest";
import { ABORT_ERROR_STRING } from "./abort-signal";
import { normalizeChatUIMessage } from "./message-state";

describe("chat message render-state normalization", () => {
  it("converts the direct abort sentinel into an aborted message and drops the raw error", () => {
    const message = normalizeChatUIMessage({
      id: "m_abort",
      role: "assistant",
      status: "failed",
      error: ABORT_ERROR_STRING,
    });

    expect(message).toMatchObject({
      id: "m_abort",
      status: "failed",
      aborted: true,
    });
    expect(message.error).toBeUndefined();
  });

  it("converts the agent failed-message update wrapper into an aborted message", () => {
    const message = normalizeChatUIMessage({
      id: "m_abort_update",
      role: "assistant",
      status: "failed",
      error: `Trying to update a message that failed: ks7fm4y0axy6ad5g8pfdmtq00x85f2m5, error: ${ABORT_ERROR_STRING}`,
    });

    expect(message.aborted).toBe(true);
    expect(message.error).toBeUndefined();
  });

  it("treats stream-backed failed assistant rows as aborted", () => {
    const message = normalizeChatUIMessage({
      id: "stream:stream_1",
      role: "assistant",
      status: "failed",
    });

    expect(message.aborted).toBe(true);
    expect(message.error).toBeUndefined();
  });

  it("keeps real provider failures as errors", () => {
    const message = normalizeChatUIMessage({
      id: "m_rate_limit",
      role: "assistant",
      status: "failed",
      error: '{"kind":"rate_limit","message":"busy"}',
    });

    expect(message.aborted).toBeUndefined();
    expect(message.error).toBe('{"kind":"rate_limit","message":"busy"}');
  });

  it("does not invent aborted state for non-stream failed messages without an abort signal", () => {
    const message = normalizeChatUIMessage({
      id: "m_failed_without_error",
      role: "assistant",
      status: "failed",
    });

    expect(message.aborted).toBeUndefined();
    expect(message.error).toBeUndefined();
  });
});
