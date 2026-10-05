import { describe, expect, it } from "vitest";
import { recordOf } from "@/lib/assistant/view";

describe("the record a reply's link points at", () => {
  it("knows each record by the address the assistant is told to write", () => {
    expect(recordOf("/results/abc-123")?.kind).toBe("search");
    expect(recordOf("/library?col=k1")?.kind).toBe("collection");
    expect(recordOf("https://openalex.org/W2084286260")).toEqual({ kind: "paper", paperId: "W2084286260" });
    expect(recordOf("/screening?job=j1")?.kind).toBe("screening");
    expect(recordOf("/extraction/x1")?.kind).toBe("extraction");
    expect(recordOf("/evidence-libraries/l1/configuration?section=sources")?.kind).toBe("library");
    expect(recordOf("/topics/T13305")?.kind).toBe("topic");
    expect(recordOf("/?chat=c1")?.kind).toBe("chat");
  });

  it("opens a topic linked on OpenAlex at its page here", () => {
    expect(recordOf("https://openalex.org/T13305")).toEqual({ kind: "topic", page: "/topics/T13305" });
  });

  it("leaves pages that aren't one record, and other sites, as plain links", () => {
    for (const address of ["/library", "/extraction/new", "/screening", "/history", "https://example.org/W1", "//evil.example/results/1"]) {
      expect(recordOf(address)).toBeNull();
    }
  });
});
