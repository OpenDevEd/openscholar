import { describe, expect, it } from "vitest";
import { inApp } from "./view";

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
