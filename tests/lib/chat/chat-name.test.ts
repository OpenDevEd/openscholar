import { describe, expect, it } from "vitest";
import { deriveChatName } from "@/lib/chat/chat-name";

describe("deriveChatName", () => {
  const fallback = "Untitled chat";

  it("uses the research question when present", () => {
    expect(
      deriveChatName({
        currentQuestion: "Does mindfulness reduce anxiety?",
        query: "mindfulness AND anxiety",
        fallback,
      }),
    ).toBe("Does mindfulness reduce anxiety?");
  });

  it("trims whitespace from the research question", () => {
    expect(
      deriveChatName({
        currentQuestion: "   Does sleep affect memory?   ",
        query: "sleep memory",
        fallback,
      }),
    ).toBe("Does sleep affect memory?");
  });

  it("falls back to the query when the research question is empty", () => {
    expect(
      deriveChatName({
        currentQuestion: "",
        query: "mindfulness AND anxiety",
        fallback,
      }),
    ).toBe("mindfulness AND anxiety");
  });

  it("falls back to the query when the research question is whitespace-only", () => {
    expect(
      deriveChatName({
        currentQuestion: "   \t\n  ",
        query: "mindfulness AND anxiety",
        fallback,
      }),
    ).toBe("mindfulness AND anxiety");
  });

  it("trims whitespace from the query when used", () => {
    expect(
      deriveChatName({
        currentQuestion: undefined,
        query: "  sleep memory  ",
        fallback,
      }),
    ).toBe("sleep memory");
  });

  it("falls back to the fallback when both inputs are empty", () => {
    expect(
      deriveChatName({
        currentQuestion: "",
        query: "",
        fallback,
      }),
    ).toBe(fallback);
  });

  it("falls back to the fallback when both inputs are undefined", () => {
    expect(
      deriveChatName({
        currentQuestion: undefined,
        query: undefined,
        fallback,
      }),
    ).toBe(fallback);
  });

  it("falls back to the fallback when both inputs are whitespace-only", () => {
    expect(
      deriveChatName({
        currentQuestion: "   ",
        query: "\t\n",
        fallback,
      }),
    ).toBe(fallback);
  });
});
