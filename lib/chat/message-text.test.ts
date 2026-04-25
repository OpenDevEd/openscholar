import { describe, expect, it } from "vitest";
import { getChatMessageText } from "./message-text";

describe("getChatMessageText", () => {
  it("prefers the flattened message text when present", () => {
    expect(
      getChatMessageText({
        text: "flattened",
        parts: [{ type: "text", text: "parts" }],
      }),
    ).toBe("flattened");
  });

  it("falls back to text parts without inventing separators", () => {
    expect(
      getChatMessageText({
        parts: [
          { type: "text", text: "hello " },
          { type: "source-url" },
          { type: "text", text: "world" },
        ],
      }),
    ).toBe("hello world");
  });

  it("returns an empty string for messages without text", () => {
    expect(getChatMessageText({ parts: [{ type: "source-url" }] })).toBe("");
  });
});
