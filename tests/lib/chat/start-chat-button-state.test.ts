import { describe, expect, it } from "vitest";
import { deriveStartChatButtonState } from "@/lib/chat/start-chat-button-state";

describe("deriveStartChatButtonState", () => {
  it("returns start when no account is active", () => {
    expect(
      deriveStartChatButtonState({
        chatJobIdsByAccountId: { acct_x: "job_x" },
        currentAccountId: undefined,
      }),
    ).toEqual({
      mode: "start",
    });
  });

  it("returns start when the current account has no linked chat", () => {
    expect(
      deriveStartChatButtonState({
        chatJobIdsByAccountId: { acct_x: "job_x" },
        currentAccountId: "acct_y",
      }),
    ).toEqual({ mode: "start" });
  });

  it("returns start when the current account's linked chat id is empty", () => {
    expect(
      deriveStartChatButtonState({
        chatJobIdsByAccountId: { acct_x: "" },
        currentAccountId: "acct_x",
      }),
    ).toEqual({ mode: "start" });
  });

  it("returns start when the current account's linked chat id is whitespace-only", () => {
    expect(
      deriveStartChatButtonState({
        chatJobIdsByAccountId: { acct_x: "   \t\n" },
        currentAccountId: "acct_x",
      }),
    ).toEqual({ mode: "start" });
  });

  it("returns continue with the current account's linked job id", () => {
    expect(
      deriveStartChatButtonState({
        chatJobIdsByAccountId: {
          acct_x: "j5x9z7q2k3p1m6n4r8t2y0w",
          acct_y: "j9b8n7m6k5h4g3f2d1s0a",
        },
        currentAccountId: "acct_x",
      }),
    ).toEqual({ mode: "continue", jobId: "j5x9z7q2k3p1m6n4r8t2y0w" });
  });

  it("trims surrounding whitespace from the current account's linked job id", () => {
    expect(
      deriveStartChatButtonState({
        chatJobIdsByAccountId: { acct_x: "  j5x9z7q2k3p1m6n4r8t2y0w  " },
        currentAccountId: "acct_x",
      }),
    ).toEqual({ mode: "continue", jobId: "j5x9z7q2k3p1m6n4r8t2y0w" });
  });
});
