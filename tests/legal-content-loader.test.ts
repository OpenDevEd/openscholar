import path from "node:path";
import { describe, expect, it } from "vitest";
import { getLegalMarkdown } from "../lib/legal-content";

describe("legal content loader", () => {
  it("loads exact locale markdown when present", async () => {
    const content = await getLegalMarkdown({
      docType: "privacy",
      locale: "fr",
    });

    expect(content.length).toBeGreaterThan(0);
    expect(content.startsWith("#")).toBe(true);
  });

  it("falls back to en-US markdown when locale-specific file is missing", async () => {
    const [fallbackContent, englishContent] = await Promise.all([
      getLegalMarkdown({
        docType: "cookie",
        locale: "es",
      }),
      getLegalMarkdown({
        docType: "cookie",
        locale: "en-US",
      }),
    ]);

    expect(fallbackContent).toBe(englishContent);
  });

  it("throws a clear error when the required source file is missing", async () => {
    const missingRoot = path.join(
      process.cwd(),
      ".tmp",
      "missing-legal-source",
      Date.now().toString()
    );

    await expect(
      getLegalMarkdown({
        docType: "privacy",
        locale: "es",
        contentRoot: missingRoot,
      })
    ).rejects.toThrow(/Missing legal markdown source:/);
  });
});
