import { describe, expect, it } from "vitest";
import { placeFrom, threadIn, withThread, workspaceKey } from "./place";

const kept = (place: object) => JSON.stringify(place);

describe("where a page's assistant panel starts", () => {
  it("is what the tab kept, so a reload comes back to the chat", () => {
    expect(placeFrom("", kept({ open: true, threads: { "": "chat-1" } }), "")).toEqual({ open: true, threads: { "": "chat-1" } });
    expect(placeFrom("?page=2", kept({ open: false, threads: {} }), "")).toEqual({ open: false, threads: {} });
  });

  it("is the chat the address links to, opened in the page's workspace, the first time the tab sees that link", () => {
    expect(placeFrom("?chat=chat-2", kept({ open: false, threads: { "": "chat-1" } }), "")).toEqual({ open: true, threads: { "": "chat-2" }, link: "chat-2" });
    expect(placeFrom("?chat=chat-2", null, "lab")).toEqual({ open: true, threads: { lab: "chat-2" }, link: "chat-2" });
  });

  it("is where the person went since, when the link is still in the address on a reload", () => {
    // Opened by the link, then on to another chat, or folded away: the link doesn't take the place back.
    expect(placeFrom("?chat=chat-2", kept({ open: true, threads: { "": "chat-3" }, link: "chat-2" }), "")).toEqual({ open: true, threads: { "": "chat-3" }, link: "chat-2" });
    expect(placeFrom("?chat=chat-2", kept({ open: false, threads: {}, link: "chat-2" }), "")).toEqual({ open: false, threads: {}, link: "chat-2" });
    // Another link is new to the tab, and opens its chat.
    expect(placeFrom("?chat=chat-4", kept({ open: true, threads: { "": "chat-3" }, link: "chat-2" }), "")).toEqual({ open: true, threads: { "": "chat-4" }, link: "chat-4" });
  });

  it("is folded on a new chat when the tab kept nothing it can read", () => {
    for (const stored of [null, "", "not json", "7", kept({ open: "yes", threads: {} }), kept({ open: true, threads: { "": 7 } }), kept({ open: true, threadId: "chat-1" }), JSON.stringify([true, "chat-1"])]) {
      expect(placeFrom("", stored, "")).toEqual({ open: false, threads: {} });
    }
  });
});

describe("each workspace's chat (#651)", () => {
  it("is kept apart, so switching back to a workspace reopens the chat last open in it", () => {
    const here = withThread(withThread({ open: true, threads: {} }, "", "mine"), "lab", "ours");
    expect(threadIn(here, "")).toBe("mine");
    expect(threadIn(here, "lab")).toBe("ours");
    expect(threadIn(here, "other")).toBeNull();
    // A new chat in one leaves the other's.
    const fresh = withThread(here, "lab", null);
    expect(threadIn(fresh, "lab")).toBeNull();
    expect(threadIn(fresh, "")).toBe("mine");
  });

  it("is told apart by the address's organization", () => {
    expect(workspaceKey("/o/lab/library")).toBe("lab");
    expect(workspaceKey("/o/lab")).toBe("lab");
    expect(workspaceKey("/library")).toBe("");
  });
});
