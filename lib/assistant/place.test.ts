import { describe, expect, it } from "vitest";
import { placeFrom } from "./place";

describe("where a page's assistant panel starts", () => {
  it("is what the tab kept, so a reload comes back to the chat", () => {
    expect(placeFrom("", JSON.stringify({ open: true, threadId: "chat-1" }))).toEqual({ open: true, threadId: "chat-1" });
    expect(placeFrom("?page=2", JSON.stringify({ open: false, threadId: null }))).toEqual({ open: false, threadId: null });
  });

  it("is the chat the address links to, opened, whatever the tab kept", () => {
    expect(placeFrom("?chat=chat-2", JSON.stringify({ open: false, threadId: "chat-1" }))).toEqual({ open: true, threadId: "chat-2" });
  });

  it("is folded on a new chat when the tab kept nothing it can read", () => {
    for (const stored of [null, "", "not json", "7", JSON.stringify({ open: "yes", threadId: "chat-1" }), JSON.stringify({ open: true, threadId: 7 }), JSON.stringify([true, "chat-1"])]) {
      expect(placeFrom("", stored)).toEqual({ open: false, threadId: null });
    }
  });
});
