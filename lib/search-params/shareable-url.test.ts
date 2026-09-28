import { describe, it, expect } from "vitest";
import { buildShareableUrl, readSharedOql } from "./index";

describe("buildShareableUrl", () => {
  it("omits the searchId so a shared link isn't tied to a local history entry", () => {
    const url = buildShareableUrl("https://app.test", { q: "ai" });
    expect(url).toContain("https://app.test/results");
    expect(url).toContain("q=ai");
    // no /results/<id> segment
    expect(url).not.toMatch(/\/results\/[^?]/);
  });

  it("produces a bare /results for an empty (all-default) search", () => {
    const url = buildShareableUrl("https://app.test", {});
    expect(url).toBe("https://app.test/results");
  });

  it("carries non-default filters", () => {
    const url = buildShareableUrl("https://app.test", {
      q: "ml",
      yf: 2020,
      yt: 2024,
    });
    expect(url).toContain("q=ml");
    expect(url).toContain("yf=2020");
    expect(url).toContain("yt=2024");
    expect(url).not.toMatch(/\/results\/[^?]/);
  });
});

describe("buildShareableUrl — OQL searches", () => {
  const oql = 'title has ("artificial intelligence" or chatgpt) and title has (education or student)';

  it("carries the OQL query in the fragment, which never reaches the server", () => {
    const url = new URL(buildShareableUrl("https://example.org", { field: "oql", q: oql }));
    expect(url.searchParams.get("field")).toBe("oql");
    expect(url.searchParams.has("q")).toBe(false);
    expect(readSharedOql(url.hash)).toBe(oql);
  });
});
