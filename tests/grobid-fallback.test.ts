import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("GROBID URL discovery fallback", () => {
  const originalGrobidUrl = process.env.GROBID_URL;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    // Clear GROBID_URL to test default fallback chain
    delete process.env.GROBID_URL;
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalGrobidUrl === undefined) {
      delete process.env.GROBID_URL;
    } else {
      process.env.GROBID_URL = originalGrobidUrl;
    }
    vi.resetModules();
  });

  it("throws descriptive error when all endpoints fail", async () => {
    // Re-import after env var reset to get fresh module-level constants
    const { processFulltextDocumentWithGrobid } = await import(
      "@/convex/extraction/grobid"
    );

    // All endpoints fail with connection refused
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    const pdfBuffer = new ArrayBuffer(8);

    await expect(
      processFulltextDocumentWithGrobid(pdfBuffer),
    ).rejects.toThrow("GROBID parsing failed across");

    // When GROBID_URL is unset, resolveCandidateBaseUrls produces:
    // Docker (http://grobid:8070), localhost (http://localhost:8070), host.docker.internal
    // Note: process.env.GROBID_URL is undefined, so DEFAULT_GROBID_URL = "http://localhost:8070"
    // which deduplicates with LOCAL_GROBID_URL. So we get 3 unique URLs.
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("succeeds when first endpoint fails but second succeeds", async () => {
    const { processFulltextDocumentWithGrobid } = await import(
      "@/convex/extraction/grobid"
    );

    // TEI XML with proper structure for collectBlocks to parse
    const validTeiXml = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>Test Paper</title></titleStmt>
    </fileDesc>
  </teiHeader>
  <text>
    <body>
      <div>
        <head>Introduction</head>
        <p>This is a test paragraph with some meaningful content for parsing.</p>
      </div>
    </body>
  </text>
</TEI>`;

    // First call fails, second call succeeds
    mockFetch
      .mockRejectedValueOnce(new Error("Connection refused"))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => validTeiXml,
      });

    const pdfBuffer = new ArrayBuffer(8);
    const result = await processFulltextDocumentWithGrobid(pdfBuffer);

    // Function should have tried 2 endpoints
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Should return a valid result from the second endpoint
    expect(result).toBeDefined();
    expect(result.teiXml).toContain("<TEI");
    expect(result.title).toBe("Test Paper");
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it("uses explicit baseUrl first in the fallback chain", async () => {
    const { processFulltextDocumentWithGrobid } = await import(
      "@/convex/extraction/grobid"
    );

    // All calls fail -- we just want to verify the order of URLs attempted
    mockFetch.mockRejectedValue(new Error("Connection refused"));

    const pdfBuffer = new ArrayBuffer(8);
    const explicitUrl = "http://custom-grobid:9999";

    await expect(
      processFulltextDocumentWithGrobid(pdfBuffer, { baseUrl: explicitUrl }),
    ).rejects.toThrow("GROBID parsing failed across");

    // First call should be to the explicit URL
    const firstCallUrl = mockFetch.mock.calls[0][0];
    expect(firstCallUrl).toContain("custom-grobid:9999");
  });
});
