import { describe, expect, it } from "vitest";
import { inApp, recordOf } from "./view";

describe("an address in a reply", () => {
  it("is a page of the app when it is a path on this site", () => {
    for (const address of ["/library", "/results/abc?page=2", "/library?col=x#top", "/"]) expect(inApp(address)).toBe(true);
  });

  it("isn't one when a browser would read it as another site's, whatever it starts with", () => {
    for (const address of ["//evil.example", "/\\evil.example", "/\\/evil.example", "/\t/evil.example", "/\n/evil.example", "https://evil.example/library", "javascript:alert(1)", "library", "#top", "", "mailto:a@b.c"]) {
      expect(inApp(address)).toBe(false);
    }
  });
});

describe("a reply's paper link", () => {
  it("reads a paper page's address as that paper, as the assistant writes it and with its title", () => {
    expect(recordOf("/papers/W12")).toEqual({ kind: "paper", paperId: "W12" });
    expect(recordOf("/papers/os234347060/efficacy-of-a-low-dose")).toEqual({ kind: "paper", paperId: "OS234347060" });
    // Replies written before paper pages still open their papers.
    expect(recordOf("https://openalex.org/W12")).toEqual({ kind: "paper", paperId: "W12" });
  });
});
