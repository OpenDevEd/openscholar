import { describe, it, expect } from "vitest";
import { buildShareableUrl } from "./index";

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
