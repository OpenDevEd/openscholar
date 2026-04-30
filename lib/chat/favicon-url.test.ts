import { describe, expect, it } from "vitest";
import { faviconUrl } from "./favicon-url";

describe("faviconUrl", () => {
  it("returns the DuckDuckGo ip3 endpoint URL for a plain host", () => {
    expect(faviconUrl("arxiv.org")).toBe(
      "https://icons.duckduckgo.com/ip3/arxiv.org.ico",
    );
  });

  it("URL-encodes hosts that include a port", () => {
    expect(faviconUrl("example.com:8443")).toBe(
      "https://icons.duckduckgo.com/ip3/example.com%3A8443.ico",
    );
  });

  it("URL-encodes hosts with non-ASCII characters", () => {
    expect(faviconUrl("xn--n3h.example")).toBe(
      "https://icons.duckduckgo.com/ip3/xn--n3h.example.ico",
    );
  });
});
