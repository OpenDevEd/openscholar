import { describe, expect, it } from "vitest";
import { faviconUrl } from "./favicon-url";

describe("faviconUrl", () => {
  it("returns a Google s2 endpoint URL with default size 32 for a plain host", () => {
    expect(faviconUrl("arxiv.org")).toBe(
      "https://www.google.com/s2/favicons?domain=arxiv.org&sz=32",
    );
  });

  it("respects the size override argument", () => {
    expect(faviconUrl("foo.bar.com", 64)).toBe(
      "https://www.google.com/s2/favicons?domain=foo.bar.com&sz=64",
    );
  });

  it("URL-encodes hosts that include a port", () => {
    expect(faviconUrl("example.com:8443")).toBe(
      "https://www.google.com/s2/favicons?domain=example.com%3A8443&sz=32",
    );
  });
});
