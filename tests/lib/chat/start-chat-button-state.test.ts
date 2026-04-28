import { describe, expect, it } from "vitest";
import { deriveStartChatButtonState } from "@/lib/chat/start-chat-button-state";

describe("deriveStartChatButtonState", () => {
  it("returns start when chatJobId is undefined", () => {
    expect(deriveStartChatButtonState({ chatJobId: undefined })).toEqual({
      mode: "start",
    });
  });

  it("returns start when chatJobId is null", () => {
    expect(
      deriveStartChatButtonState({
        chatJobId: null as unknown as string | undefined,
      }),
    ).toEqual({ mode: "start" });
  });

  it("returns start when chatJobId is an empty string", () => {
    expect(deriveStartChatButtonState({ chatJobId: "" })).toEqual({
      mode: "start",
    });
  });

  it("returns start when chatJobId is whitespace-only", () => {
    expect(deriveStartChatButtonState({ chatJobId: "   \t\n" })).toEqual({
      mode: "start",
    });
  });

  it("returns continue with the jobId when chatJobId is populated", () => {
    expect(
      deriveStartChatButtonState({ chatJobId: "j5x9z7q2k3p1m6n4r8t2y0w" }),
    ).toEqual({ mode: "continue", jobId: "j5x9z7q2k3p1m6n4r8t2y0w" });
  });

  it("trims surrounding whitespace from a populated jobId", () => {
    expect(
      deriveStartChatButtonState({ chatJobId: "  j5x9z7q2k3p1m6n4r8t2y0w  " }),
    ).toEqual({ mode: "continue", jobId: "j5x9z7q2k3p1m6n4r8t2y0w" });
  });
});
