import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  loadCitationStyles,
  searchCitationStyles,
} from "@/lib/citations/styles";

const record = {
  id: "style-test",
  "citation-key": "style-test",
  type: "article-journal",
  title: "Evidence and education",
  author: [{ family: "Smith", given: "Jane" }],
  issued: { "date-parts": [[2026]] },
  "container-title": "Journal of Education",
  volume: "42",
  page: "101-109",
};
const bytesFor = async (url: string) =>
  new Response(await readFile(resolve("public", url.slice(1))));
afterEach(() => vi.unstubAllGlobals());

describe("additional citation styles", () => {
  it("shows the complete catalog without a query and searches all styles", async () => {
    const styles = await loadCitationStyles();
    expect(searchCitationStyles(styles, "")).toEqual(styles);
    expect(searchCitationStyles(styles, "  ")).toEqual(styles);
    expect(styles.slice(0, 6).map((style) => style.id)).toContain("apa");
    expect(styles.slice(6).map((style) => style.id)).toContain("nature");
    expect(
      searchCitationStyles(styles, "  IEEE ").some(
        (style) => style.id === "ieee",
      ),
    ).toBe(true);
    expect(
      searchCitationStyles(styles, "nature").some(
        (style) => style.id === "nature",
      ),
    ).toBe(true);
    expect(searchCitationStyles(styles, "no such journal xqz")).toEqual([]);
  });
  it("downloads a selected style once, shares concurrent loads, and formats each record separately", async () => {
    vi.resetModules();
    const { formatAdditionalCitation } = await import(
      "@/lib/citations/formatter"
    );
    const style = (await loadCitationStyles()).find(
      (style) => style.id === "ieee",
    )!;
    const fetch = vi.fn(bytesFor);
    vi.stubGlobal("fetch", fetch);
    const [first, second] = await Promise.all([
      formatAdditionalCitation(record, "en-GB", style),
      formatAdditionalCitation(
        { ...record, title: "Changed evidence" },
        "en-GB",
        style,
      ),
    ]);
    expect(first.text).toMatch(/^J\. Smith/);
    expect(first.text).toContain("J. Smith");
    expect(first.text).toContain("Evidence and education");
    expect(second.text).toContain("Changed evidence");
    expect(second.text).not.toContain("Evidence and education");
    await formatAdditionalCitation(record, "en-GB", style);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("renders a full note for a style without a bibliography", async () => {
    vi.resetModules();
    const { formatAdditionalCitation } = await import(
      "@/lib/citations/formatter"
    );
    const style = (await loadCitationStyles()).find(
      (style) => style.id === "chicago-notes-no-url",
    )!;
    vi.stubGlobal("fetch", bytesFor);
    const text = await formatAdditionalCitation(record, "en-GB", style);
    expect(text.text).toContain("Jane Smith");
    expect(text.text).toContain("Evidence and Education");
    expect(text.text).toContain("2026");
  });
  it("retries a failed style download instead of caching the rejection", async () => {
    vi.resetModules();
    const { formatAdditionalCitation } = await import(
      "@/lib/citations/formatter"
    );
    const style = (await loadCitationStyles()).find(
      (style) => style.id === "nature",
    )!;
    const fetch = vi.fn(bytesFor).mockRejectedValueOnce(new Error("Offline"));
    vi.stubGlobal("fetch", fetch);
    await expect(
      formatAdditionalCitation(record, "en-GB", style),
    ).rejects.toThrow("Offline");
    expect((await formatAdditionalCitation(record, "en-GB", style)).text).toContain(
      "Evidence and education",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
