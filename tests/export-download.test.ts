import { beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted to create mock before vi.mock factories are hoisted
const { mockDownloadWithMetadata } = vi.hoisted(() => ({
  mockDownloadWithMetadata: vi.fn(),
}));

// Mock stores
vi.mock("../lib/store", () => ({
  useKeywordExpansionStore: { getState: () => ({ ensureShortcuts: async () => {}, expandQuery: (query: string) => ({ expandedQuery: query, warnings: [] }) }) },
  useRatingsStore: {
    getState: vi.fn(() => ({ readRatings: async () => ({}) })),
  },
  useSearchHistoryStore: {
    getState: vi.fn(() => ({
      getSearchResult: vi.fn(() => null),
      // The search's answers for the papers a download holds: only W123 is answered.
      readScreeningResponses: async (_searchId: string, paperIds: string[]) =>
        Object.fromEntries(paperIds.filter((paperId) => paperId === "W123").map((paperId) => [paperId, { "Randomized?": true }])),
    })),
  },
  useUIStore: {
    getState: vi.fn(() => ({
      setIsDialogOpen: vi.fn(),
      setIsFocusModeOpen: vi.fn(),
      setFocusModeIndex: vi.fn(),
    })),
  },
}));

// Mock keyword validation
vi.mock("../lib/keyword-validation", () => ({
  validateAndExpandKeywordsSilently: vi.fn(() => ({
    expandedQuery: "test query",
    warnings: [],
  })),
}));

// Mock utils -- keep real functions but mock download-related ones
vi.mock("../lib/utils", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    downloadWithMetadata: mockDownloadWithMetadata,
    createSearchParameters: vi.fn(() => ({ filter: {}, perPage: 200 })),
  };
});

// Mock posthog
vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

// Mock date-fns format
vi.mock("date-fns", () => ({
  format: vi.fn((date: Date) => date.toISOString().split("T")[0]),
}));

import { downloadAll, downloadEssentialItem, downloadItem } from "../lib/search-actions";
import { createSearchParameters } from "../lib/utils";
import type { DownloadSearchState, ToastApi } from "../lib/search-actions";
import type { SearchField, PaperResult } from "../lib/types/search.types";

const mockToast: ToastApi = {
  io: { downloadFailed: vi.fn() },
};

const mockSearchState: DownloadSearchState = {
  query: "test query",
  field: "title_and_abstract" satisfies SearchField,
  dateRange: undefined,
  yearRange: [2020, 2024],
  searchId: "search_1",
};

// Partial test data -- only fields needed for download tests
const mockItem = {
  id: "W123",
  title: "Test Paper",
  publication_year: 2024,
  authorships: [{ author: { display_name: "Author A" } }],
  abstract: "Test abstract",
  doi: "https://doi.org/10.1234/test",
  open_access: { oa_url: "https://example.com/pdf" },
} as unknown as PaperResult;

const mockResults: PaperResult[] = [
  mockItem,
  { ...mockItem, id: "W456", title: "Second Paper" } as unknown as PaperResult,
];

beforeEach(() => {
  mockDownloadWithMetadata.mockClear();
  vi.mocked(mockToast.io.downloadFailed).mockClear();
});

describe("downloadAll", () => {
  it("calls downloadWithMetadata with JSON format", async () => {
    await downloadAll("json", mockToast, false, mockSearchState, mockResults);
    expect(mockDownloadWithMetadata).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringContaining(".json"),
      "json",
      expect.objectContaining({ search: expect.any(Object) })
    );
  });

  it("puts each paper's screening answers, read for the papers downloaded, in a JSON download", async () => {
    for (const essential of [false, true]) {
      mockDownloadWithMetadata.mockClear();
      await downloadAll("json", mockToast, essential, mockSearchState, mockResults);
      const [items] = mockDownloadWithMetadata.mock.calls[0] as [Array<{ screening_results?: unknown }>];
      expect(items.map((item) => item.screening_results)).toEqual([{ "Randomized?": true }, undefined]);
    }
  });

  it("calls downloadWithMetadata with CSV format", async () => {
    await downloadAll("csv", mockToast, false, mockSearchState, mockResults);
    expect(mockDownloadWithMetadata).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringContaining(".csv"),
      "csv",
      expect.objectContaining({ search: expect.any(Object) })
    );
  });

  it("calls toast.io.downloadFailed when searchState is undefined", async () => {
    await downloadAll("json", mockToast, false, undefined, mockResults);
    expect(mockToast.io.downloadFailed).toHaveBeenCalled();
    expect(mockDownloadWithMetadata).not.toHaveBeenCalled();
  });

  it("calls toast.io.downloadFailed when results is undefined", async () => {
    await downloadAll("json", mockToast, false, mockSearchState, undefined);
    expect(mockToast.io.downloadFailed).toHaveBeenCalled();
  });

  it("essential mode produces items with essential fields", async () => {
    await downloadAll("json", mockToast, true, mockSearchState, mockResults);
    expect(mockDownloadWithMetadata).toHaveBeenCalled();
    const [data] = mockDownloadWithMetadata.mock.calls[0];
    expect(data[0]).toHaveProperty("id");
    expect(data[0]).toHaveProperty("title");
    expect(data[0]).toHaveProperty("authors");
  });

  it("search metadata includes query, field, and timestamp", async () => {
    await downloadAll("json", mockToast, false, mockSearchState, mockResults);
    const metadata = mockDownloadWithMetadata.mock.calls[0][3];
    expect(metadata.search.query).toBe("test query");
    expect(metadata.search.field).toBe("title_and_abstract");
    expect(metadata.search.timestamp).toBeDefined();
  });
});

// A question asked by meaning is searched as it is written, never with its shortcuts expanded.
describe("exporting a search by meaning", () => {
  const byMeaning: DownloadSearchState = { query: "Does tutoring help pupils who fall behind in maths...?", field: "semantic", searchId: "search_2" };

  it("records the question as it was asked, in every kind of download", async () => {
    await downloadAll("json", mockToast, false, byMeaning, mockResults);
    await downloadItem(mockItem, "json", mockToast, byMeaning);
    await downloadEssentialItem(mockItem, "csv", mockToast, byMeaning);
    expect(mockDownloadWithMetadata).toHaveBeenCalledTimes(3);
    for (const [, , , metadata] of mockDownloadWithMetadata.mock.calls) {
      expect(metadata.search).toMatchObject({ query: byMeaning.query, field: "semantic" });
    }
  });
});

// A search for the works nearest given papers has no words: the papers say what it searched by.
describe("exporting a search for the works nearest given papers", () => {
  const like: DownloadSearchState = { query: "", field: "title_and_abstract", searchId: "search_3", similarTo: ["OS64233829", "OS14687712"] };

  // A CSV file holds the papers alone, as for any search, so only a JSON file keeps what each download is given.
  it("gives every kind of download the papers in its metadata, and builds its parameters with them", async () => {
    await downloadAll("json", mockToast, false, like, mockResults);
    await downloadItem(mockItem, "json", mockToast, like);
    await downloadEssentialItem(mockItem, "csv", mockToast, like);
    expect(mockDownloadWithMetadata).toHaveBeenCalledTimes(3);
    for (const [, , , metadata] of mockDownloadWithMetadata.mock.calls) {
      expect(metadata.search.similar_to).toEqual(["OS64233829", "OS14687712"]);
    }
    // Its parameters are built with them, as the results page's request was.
    expect(vi.mocked(createSearchParameters)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ similarTo: ["OS64233829", "OS14687712"] }),
    );
  });

  it("records none for a search without them", async () => {
    await downloadAll("json", mockToast, false, mockSearchState, mockResults);
    const [, , , metadata] = mockDownloadWithMetadata.mock.calls[0];
    expect(metadata.search.similar_to).toBeUndefined();
  });
});

describe("downloadItem", () => {
  it("calls downloadWithMetadata with JSON format for single item", async () => {
    await downloadItem(mockItem, "json", mockToast, mockSearchState);
    expect(mockDownloadWithMetadata).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining(".json"),
      "json",
      expect.objectContaining({ search: expect.any(Object) })
    );
  });

  it("calls downloadWithMetadata with CSV format for single item", async () => {
    await downloadItem(mockItem, "csv", mockToast, mockSearchState);
    expect(mockDownloadWithMetadata).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining(".csv"),
      "csv",
      expect.objectContaining({ search: expect.any(Object) })
    );
  });

  it("calls toast.io.downloadFailed when searchState is undefined", async () => {
    await downloadItem(mockItem, "json", mockToast, undefined);
    expect(mockToast.io.downloadFailed).toHaveBeenCalled();
  });

  it("derives filename from item title", async () => {
    await downloadItem(mockItem, "json", mockToast, mockSearchState);
    const filename = mockDownloadWithMetadata.mock.calls[0][1];
    expect(filename).toContain("test_paper");
  });
});
