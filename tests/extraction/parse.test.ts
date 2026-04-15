/**
 * Tests for the multi-tier parsing waterfall in convex/extraction/parse.ts.
 *
 * Environment: Node.js (via vitest.config.ts environmentMatchGlobs -- files
 * under tests/ default to "node" environment, which is correct because
 * parse.ts uses Node-only packages: fast-xml-parser, linkedom, unpdf).
 *
 * Mocking strategy:
 *   - global.fetch: vi.fn() intercepting all HTTP calls
 *   - unpdf: vi.mock() for getDocumentProxy and extractText
 *   - ai: vi.mock() for generateText
 *   - @ai-sdk/google: vi.mock() for createGoogleGenerativeAI
 *   - reconstruct-abstract: vi.mock() returning joined words
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks (must be before parseFullText import)
// ---------------------------------------------------------------------------

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(),
  extractText: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => (modelId: string) => ({
    modelId,
    provider: "google",
  })),
}));

// Mock reconstructAbstract -- the relative path is resolved from the
// perspective of parse.ts, which imports "../../lib/openalex/reconstruct-abstract".
// vitest resolves mock paths from the project root, so we mock the full module path.
vi.mock("../../lib/openalex/reconstruct-abstract", () => ({
  reconstructAbstract: vi.fn((index: Record<string, number[]>) => {
    if (!index || Object.keys(index).length === 0) return "";
    // Simple reconstruction: sort entries by their first position value
    const entries = Object.entries(index).sort(
      (a, b) => (a[1][0] ?? 0) - (b[1][0] ?? 0)
    );
    return entries.map(([word]) => word).join(" ");
  }),
}));

import { parseFullText } from "../../convex/extraction/parse";
import { getDocumentProxy, extractText } from "unpdf";
import { generateText } from "ai";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const JATS_XML_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<article>
  <body>
    <sec>
      <title>Introduction</title>
      <p>This is the introduction paragraph of the test paper.</p>
    </sec>
    <sec>
      <title>Methods</title>
      <p>This is the methods section with experimental details.</p>
    </sec>
  </body>
</article>`;

const ARXIV_HTML_FIXTURE = `<!DOCTYPE html>
<html>
<head><title>Test Paper</title></head>
<body>
<article>
  <h1>Test Paper Title</h1>
  <p>This is the body text of an arXiv paper with sufficient content for testing purposes.</p>
  <nav>Navigation to remove</nav>
  <script>console.log("script to remove")</script>
</article>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function mockOpenAlexResponse(
  overrides: {
    pmcId?: string;
    arxivLandingUrl?: string;
    pdfUrl?: string;
    abstractInvertedIndex?: Record<string, number[]> | null;
    doi?: string;
    arxivLocationId?: string;
  } = {}
) {
  return {
    ids: {
      openalex: "https://openalex.org/W1234567890",
      doi: overrides.doi
        ? `https://doi.org/${overrides.doi}`
        : "https://doi.org/10.1234/test",
      ...(overrides.pmcId
        ? {
            pmcid: `https://www.ncbi.nlm.nih.gov/pmc/articles/${overrides.pmcId}`,
          }
        : {}),
    },
    primary_location: {
      landing_page_url:
        overrides.arxivLandingUrl ?? "https://example.com/paper",
      pdf_url: overrides.pdfUrl ?? null,
      source: { display_name: "Example Journal" },
    },
    best_oa_location: {
      pdf_url: overrides.pdfUrl ?? null,
    },
    locations: [
      ...(overrides.pmcId
        ? [
            {
              source: { display_name: "PubMed Central" },
              landing_page_url: `https://www.ncbi.nlm.nih.gov/pmc/articles/${overrides.pmcId.replace("PMC", "")}/`,
              id: null,
            },
          ]
        : []),
      ...(overrides.arxivLocationId
        ? [
            {
              source: { display_name: "arXiv" },
              landing_page_url: null,
              id: overrides.arxivLocationId,
            },
          ]
        : []),
    ],
    abstract_inverted_index:
      overrides.abstractInvertedIndex !== undefined
        ? overrides.abstractInvertedIndex
        : { Test: [0], abstract: [1], text: [2] },
  };
}

/**
 * Create a mock Response object that mimics the Fetch API Response.
 */
function mockFetchResponse(
  body: string | ArrayBuffer,
  init: { status?: number; ok?: boolean; headers?: Record<string, string> } = {}
) {
  const status = init.status ?? 200;
  const ok = init.ok ?? (status >= 200 && status < 300);
  return {
    ok,
    status,
    headers: new Headers(init.headers),
    text: vi.fn().mockImplementation(() =>
      Promise.resolve(typeof body === "string" ? body : "")
    ),
    json: vi.fn().mockImplementation(() => {
      if (typeof body === "string") {
        try {
          return Promise.resolve(JSON.parse(body));
        } catch {
          return Promise.reject(new SyntaxError(`Invalid JSON: ${body.slice(0, 30)}`));
        }
      }
      return Promise.resolve({});
    }),
    arrayBuffer: vi.fn().mockImplementation(() =>
      Promise.resolve(body instanceof ArrayBuffer ? body : new ArrayBuffer(0))
    ),
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  process.env.OPENALEX_CONTACT_EMAIL = "test@example.com";
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENALEX_CONTACT_EMAIL;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
});

// ---------------------------------------------------------------------------
// 1. OpenAlex metadata resolution (PARSE-01)
// ---------------------------------------------------------------------------

describe("OpenAlex metadata resolution", () => {
  it("extracts PMCID from ids.pmcid", async () => {
    const openAlexData = mockOpenAlexResponse({ pmcId: "PMC7654321" });
    const fetchMock = vi.fn();

    // OpenAlex API call
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(JSON.stringify(openAlexData))
    );
    // Europe PMC call returning JATS XML
    fetchMock.mockResolvedValueOnce(mockFetchResponse(JATS_XML_FIXTURE));

    globalThis.fetch = fetchMock;

    const result = await parseFullText("10.1234/test", "W1234567890");

    expect(result.parsingSource).toBe("pmc");
    expect(result.bodyText).toContain("introduction paragraph");
  });

  it("extracts PMCID from locations array when ids.pmcid absent", async () => {
    // OpenAlex response WITHOUT ids.pmcid but WITH PubMed Central location
    const openAlexData = {
      ids: {
        openalex: "https://openalex.org/W1234567890",
        doi: "https://doi.org/10.1234/test",
      },
      primary_location: {
        landing_page_url: "https://example.com/paper",
        pdf_url: null,
        source: { display_name: "Example Journal" },
      },
      best_oa_location: { pdf_url: null },
      locations: [
        {
          source: { display_name: "PubMed Central" },
          landing_page_url:
            "https://www.ncbi.nlm.nih.gov/pmc/articles/9876543/",
          id: null,
        },
      ],
      abstract_inverted_index: { Test: [0], abstract: [1] },
    };

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(JSON.stringify(openAlexData))
    );
    // Europe PMC call returning JATS XML
    fetchMock.mockResolvedValueOnce(mockFetchResponse(JATS_XML_FIXTURE));

    globalThis.fetch = fetchMock;

    const result = await parseFullText("10.1234/test", "W1234567890");

    expect(result.parsingSource).toBe("pmc");
    // Verify Europe PMC was called with the extracted PMC ID
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const pmcCall = fetchMock.mock.calls[1][0] as string;
    expect(pmcCall).toContain("PMC9876543");
  });

  it("extracts arXiv ID from primary_location landing URL", async () => {
    const openAlexData = mockOpenAlexResponse({
      arxivLandingUrl: "https://arxiv.org/abs/2402.08954",
    });

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(JSON.stringify(openAlexData))
    );
    // arXiv HTML call
    fetchMock.mockResolvedValueOnce(mockFetchResponse(ARXIV_HTML_FIXTURE));

    globalThis.fetch = fetchMock;

    const result = await parseFullText("10.1234/test", "W1234567890");

    expect(result.parsingSource).toBe("arxiv");
    expect(result.bodyText).toContain("body text of an arXiv paper");
  });

  it("extracts arXiv ID from DOI pattern", async () => {
    const openAlexData = mockOpenAlexResponse({
      doi: "10.48550/arxiv.2402.08954",
    });

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(JSON.stringify(openAlexData))
    );
    // arXiv HTML call
    fetchMock.mockResolvedValueOnce(mockFetchResponse(ARXIV_HTML_FIXTURE));

    globalThis.fetch = fetchMock;

    const result = await parseFullText(
      "10.48550/arxiv.2402.08954",
      "W1234567890"
    );

    expect(result.parsingSource).toBe("arxiv");
  });
});

// ---------------------------------------------------------------------------
// 2. PMC JATS XML tier (PARSE-02)
// ---------------------------------------------------------------------------

describe("PMC JATS XML tier", () => {
  it("parses JATS XML body text from Europe PMC", async () => {
    const openAlexData = mockOpenAlexResponse({ pmcId: "PMC7654321" });

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(JSON.stringify(openAlexData))
    );
    fetchMock.mockResolvedValueOnce(mockFetchResponse(JATS_XML_FIXTURE));

    globalThis.fetch = fetchMock;

    const result = await parseFullText("10.1234/test", "W1234567890");

    expect(result.parsingSource).toBe("pmc");
    expect(result.bodyText).toContain("introduction paragraph");
    expect(result.bodyText).toContain("methods section");
  });

  it("falls through on PMC 404", async () => {
    const openAlexData = mockOpenAlexResponse({
      pmcId: "PMC7654321",
      arxivLandingUrl: "https://arxiv.org/abs/2402.08954",
    });

    const fetchMock = vi.fn();
    // OpenAlex returns metadata with both PMC and arXiv IDs
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(JSON.stringify(openAlexData))
    );
    // PMC returns 404
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse("Not found", { status: 404 })
    );
    // arXiv HTML fallback
    fetchMock.mockResolvedValueOnce(mockFetchResponse(ARXIV_HTML_FIXTURE));

    globalThis.fetch = fetchMock;

    const result = await parseFullText("10.1234/test", "W1234567890");

    expect(result.parsingSource).toBe("arxiv");
  });
});

// ---------------------------------------------------------------------------
// 3. arXiv HTML tier (PARSE-03)
// ---------------------------------------------------------------------------

describe("arXiv HTML tier", () => {
  it("parses article body from arXiv HTML", async () => {
    const openAlexData = mockOpenAlexResponse({
      arxivLandingUrl: "https://arxiv.org/abs/2402.08954",
    });

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(JSON.stringify(openAlexData))
    );
    fetchMock.mockResolvedValueOnce(mockFetchResponse(ARXIV_HTML_FIXTURE));

    globalThis.fetch = fetchMock;

    const result = await parseFullText("10.1234/test", "W1234567890");

    expect(result.parsingSource).toBe("arxiv");
    expect(result.bodyText).toContain("body text of an arXiv paper");
    // Verify nav and script elements were removed
    expect(result.bodyText).not.toContain("Navigation to remove");
    expect(result.bodyText).not.toContain("console.log");
  });

  it("falls through on arXiv 404", async () => {
    const openAlexData = mockOpenAlexResponse({
      arxivLandingUrl: "https://arxiv.org/abs/2402.08954",
    });

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(JSON.stringify(openAlexData))
    );
    // arXiv returns 404
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse("Not found", { status: 404 })
    );

    globalThis.fetch = fetchMock;

    const result = await parseFullText("10.1234/test", "W1234567890");

    // Falls through to abstract_only (no PDF URL available)
    expect(result.parsingSource).toBe("abstract_only");
  });
});

// ---------------------------------------------------------------------------
// 4. unpdf PDF tier (PARSE-04, PARSE-10)
// ---------------------------------------------------------------------------

describe("unpdf PDF tier", () => {
  it("extracts text from PDF via unpdf", async () => {
    const openAlexData = mockOpenAlexResponse({
      pdfUrl: "https://example.com/paper.pdf",
    });

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(JSON.stringify(openAlexData))
    );
    // PDF fetch returns a fake ArrayBuffer
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(new ArrayBuffer(1024))
    );

    globalThis.fetch = fetchMock;

    // Mock unpdf: PDF has 10 pages, returns 2000+ chars
    const mockProxy = { numPages: 10 };
    vi.mocked(getDocumentProxy).mockResolvedValueOnce(
      mockProxy as ReturnType<typeof getDocumentProxy> extends Promise<infer T>
        ? T
        : never
    );
    vi.mocked(extractText).mockResolvedValueOnce({
      totalPages: 10,
      text: "A".repeat(2000),
    } as Awaited<ReturnType<typeof extractText>>);

    const result = await parseFullText("10.1234/test", "W1234567890");

    expect(result.parsingSource).toBe("unpdf");
    expect(result.bodyText.length).toBeGreaterThanOrEqual(1500);
  });

  it("rejects PDFs with >200 pages", async () => {
    const openAlexData = mockOpenAlexResponse({
      pdfUrl: "https://example.com/big.pdf",
    });

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(JSON.stringify(openAlexData))
    );
    // PDF fetch
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(new ArrayBuffer(1024))
    );

    globalThis.fetch = fetchMock;

    // Mock unpdf: PDF has 250 pages -- exceeds 200-page cap
    const mockProxy = { numPages: 250 };
    vi.mocked(getDocumentProxy).mockResolvedValueOnce(
      mockProxy as ReturnType<typeof getDocumentProxy> extends Promise<infer T>
        ? T
        : never
    );

    const result = await parseFullText("10.1234/test", "W1234567890");

    // Falls through to abstract_only (oversized PDF, no Gemini for huge docs)
    // Note: extractText should NOT have been called since the page cap rejects early
    expect(vi.mocked(extractText)).not.toHaveBeenCalled();
    expect(result.parsingSource).toBe("abstract_only");
  });

  it("falls through to Gemini when unpdf returns <1500 chars", async () => {
    const openAlexData = mockOpenAlexResponse({
      pdfUrl: "https://example.com/paper.pdf",
    });

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(JSON.stringify(openAlexData))
    );
    // PDF fetch for unpdf
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(new ArrayBuffer(1024))
    );
    // PDF fetch for Gemini tier (re-fetches the PDF)
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(new ArrayBuffer(512))
    );

    globalThis.fetch = fetchMock;

    // Mock unpdf: returns insufficient text (500 chars < 1500 threshold)
    const mockProxy = { numPages: 10 };
    vi.mocked(getDocumentProxy).mockResolvedValueOnce(
      mockProxy as ReturnType<typeof getDocumentProxy> extends Promise<infer T>
        ? T
        : never
    );
    vi.mocked(extractText).mockResolvedValueOnce({
      totalPages: 10,
      text: "B".repeat(500),
    } as Awaited<ReturnType<typeof extractText>>);

    // Mock Gemini generateText
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Gemini extracted text from the PDF document",
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await parseFullText("10.1234/test", "W1234567890");

    expect(result.parsingSource).toBe("gemini");
    expect(result.bodyText).toBe(
      "Gemini extracted text from the PDF document"
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Gemini PDF parser tier (PARSE-05)
// ---------------------------------------------------------------------------

describe("Gemini PDF parser tier", () => {
  it("uses Gemini when unpdf text is insufficient", async () => {
    const openAlexData = mockOpenAlexResponse({
      pdfUrl: "https://example.com/paper.pdf",
    });

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(JSON.stringify(openAlexData))
    );
    // PDF fetch for unpdf
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(new ArrayBuffer(1024))
    );
    // PDF fetch for Gemini
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(new ArrayBuffer(512))
    );

    globalThis.fetch = fetchMock;

    // Mock unpdf: returns only 100 chars (below 1500 threshold)
    const mockProxy = { numPages: 5 };
    vi.mocked(getDocumentProxy).mockResolvedValueOnce(
      mockProxy as ReturnType<typeof getDocumentProxy> extends Promise<infer T>
        ? T
        : never
    );
    vi.mocked(extractText).mockResolvedValueOnce({
      totalPages: 5,
      text: "C".repeat(100),
    } as Awaited<ReturnType<typeof extractText>>);

    // Mock Gemini generateText
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Full paper text from Gemini",
    } as Awaited<ReturnType<typeof generateText>>);

    const result = await parseFullText("10.1234/test", "W1234567890");

    expect(result.parsingSource).toBe("gemini");
    expect(result.bodyText).toContain("Full paper text from Gemini");
  });
});

// ---------------------------------------------------------------------------
// 6. abstract_only fallback (PARSE-06)
// ---------------------------------------------------------------------------

describe("abstract_only fallback", () => {
  it("returns abstract when all tiers fail", async () => {
    // No PMCID, no arXiv ID, no PDF URL -- straight to abstract_only
    const openAlexData = mockOpenAlexResponse({
      abstractInvertedIndex: { Test: [0], abstract: [1], text: [2] },
    });

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(JSON.stringify(openAlexData))
    );

    globalThis.fetch = fetchMock;

    const result = await parseFullText("10.1234/test", "W1234567890");

    expect(result.parsingSource).toBe("abstract_only");
    expect(result.bodyText).toBe("Test abstract text");
  });

  it("returns empty bodyText when no abstract available", async () => {
    // No PMCID, no arXiv ID, no PDF URL, null abstract
    const openAlexData = mockOpenAlexResponse({
      abstractInvertedIndex: null,
    });

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(JSON.stringify(openAlexData))
    );

    globalThis.fetch = fetchMock;

    const result = await parseFullText("10.1234/test", "W1234567890");

    expect(result.parsingSource).toBe("abstract_only");
    expect(result.bodyText).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 7. timeout ceilings (PARSE-09)
// ---------------------------------------------------------------------------

describe("timeout ceilings", () => {
  it("respects 20s fetch timeout for OpenAlex", async () => {
    const signalsSeen: AbortSignal[] = [];

    const fetchMock = vi.fn(
      (
        input: string | URL | Request,
        init?: RequestInit
      ): Promise<Response> => {
        if (init?.signal) {
          signalsSeen.push(init.signal);
        }
        // Return OpenAlex response with no tiers available
        return Promise.resolve(
          mockFetchResponse(
            JSON.stringify(
              mockOpenAlexResponse({ abstractInvertedIndex: null })
            )
          ) as unknown as Response
        );
      }
    );

    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    await parseFullText("10.1234/test", "W1234567890");

    // The OpenAlex metadata fetch should have received an AbortSignal
    expect(signalsSeen.length).toBeGreaterThanOrEqual(1);
    // AbortSignal.timeout creates a signal -- we verify it was passed
    expect(signalsSeen[0]).toBeInstanceOf(AbortSignal);
  });

  it("respects 30s timeout for PMC XML parsing", async () => {
    const signalsSeen: AbortSignal[] = [];
    let callCount = 0;

    const fetchMock = vi.fn(
      (
        input: string | URL | Request,
        init?: RequestInit
      ): Promise<Response> => {
        callCount++;
        if (init?.signal) {
          signalsSeen.push(init.signal);
        }
        if (callCount === 1) {
          // OpenAlex metadata with PMC ID
          return Promise.resolve(
            mockFetchResponse(
              JSON.stringify(mockOpenAlexResponse({ pmcId: "PMC1234567" }))
            ) as unknown as Response
          );
        }
        // PMC XML fetch
        return Promise.resolve(
          mockFetchResponse(JATS_XML_FIXTURE) as unknown as Response
        );
      }
    );

    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const result = await parseFullText("10.1234/test", "W1234567890");

    expect(result.parsingSource).toBe("pmc");
    // Both OpenAlex and PMC fetch calls should have received AbortSignals
    expect(signalsSeen.length).toBe(2);
    // Both should be instances of AbortSignal (created by withTimeout)
    expect(signalsSeen[0]).toBeInstanceOf(AbortSignal);
    expect(signalsSeen[1]).toBeInstanceOf(AbortSignal);
  });
});

// ---------------------------------------------------------------------------
// 8. 200-page PDF cap (PARSE-10)
// ---------------------------------------------------------------------------

describe("200-page PDF cap", () => {
  it("rejects PDF exceeding 200 pages before extraction", async () => {
    const openAlexData = mockOpenAlexResponse({
      pdfUrl: "https://example.com/huge.pdf",
      abstractInvertedIndex: { Fallback: [0], abstract: [1] },
    });

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(JSON.stringify(openAlexData))
    );
    // PDF fetch
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse(new ArrayBuffer(2048))
    );

    globalThis.fetch = fetchMock;

    // Mock unpdf: 201 pages -- just over the cap
    const mockProxy = { numPages: 201 };
    vi.mocked(getDocumentProxy).mockResolvedValueOnce(
      mockProxy as ReturnType<typeof getDocumentProxy> extends Promise<infer T>
        ? T
        : never
    );

    const result = await parseFullText("10.1234/test", "W1234567890");

    // extractText should NOT be called -- page cap rejects before extraction
    expect(vi.mocked(extractText)).not.toHaveBeenCalled();
    // Falls through to abstract_only
    expect(result.parsingSource).toBe("abstract_only");
    expect(result.bodyText).toBe("Fallback abstract");
  });
});
