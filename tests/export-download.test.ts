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

import { downloadAll, downloadItem } from "../lib/search-actions";
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
