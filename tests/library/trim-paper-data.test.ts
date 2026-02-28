import { describe, it, expect } from "vitest";
import { trimPaperData } from "@/lib/library/trim-paper-data";

describe("trimPaperData", () => {
  const fullWork = {
    id: "https://openalex.org/W1234567890",
    title: "Machine Learning for Climate Science",
    display_name: "Machine Learning for Climate Science",
    doi: "https://doi.org/10.1234/example.2024",
    abstract: "This paper explores the use of machine learning techniques in climate science modeling and prediction.",
    publication_year: 2024,
    authorships: [
      { author: { display_name: "John Doe" } },
      { author: { display_name: "Jane Smith" } },
      { author: { display_name: "Bob Johnson" } },
    ],
    primary_location: {
      source: {
        display_name: "Nature Climate Change",
      },
    },
    cited_by_count: 42,
    open_access: {
      is_oa: true,
      oa_status: "gold",
    },
  };

  it("extracts all 10 fields from a full Work object", () => {
    const result = trimPaperData(fullWork);

    expect(result.openalexId).toBe("https://openalex.org/W1234567890");
    expect(result.title).toBe("Machine Learning for Climate Science");
    expect(result.authors).toBe("John Doe, Jane Smith, Bob Johnson");
    expect(result.doi).toBe("https://doi.org/10.1234/example.2024");
    expect(result.abstract).toBe(
      "This paper explores the use of machine learning techniques in climate science modeling and prediction."
    );
    expect(result.publicationYear).toBe(2024);
    expect(result.journal).toBe("Nature Climate Change");
    expect(result.citedByCount).toBe(42);
    expect(result.isOpenAccess).toBe(true);
    expect(result.oaStatus).toBe("gold");
  });

  it("returns undefined for optional fields when only id and title are present", () => {
    const minimalWork = {
      id: "https://openalex.org/W9999999999",
      title: "A Minimal Paper",
    };

    const result = trimPaperData(minimalWork);

    expect(result.openalexId).toBe("https://openalex.org/W9999999999");
    expect(result.title).toBe("A Minimal Paper");
    expect(result.authors).toBeUndefined();
    expect(result.doi).toBeUndefined();
    expect(result.abstract).toBeUndefined();
    expect(result.publicationYear).toBeUndefined();
    expect(result.journal).toBeUndefined();
    expect(result.citedByCount).toBeUndefined();
    expect(result.isOpenAccess).toBeUndefined();
    expect(result.oaStatus).toBeUndefined();
  });

  it("falls back to display_name when title is not present", () => {
    const workWithDisplayName = {
      id: "https://openalex.org/W1111111111",
      display_name: "Fallback Title Via Display Name",
    };

    const result = trimPaperData(workWithDisplayName);

    expect(result.title).toBe("Fallback Title Via Display Name");
  });

  it("flattens multiple authorships into a comma-separated string", () => {
    const workWithAuthors = {
      id: "https://openalex.org/W2222222222",
      title: "Multi-Author Paper",
      authorships: [
        { author: { display_name: "Alice" } },
        { author: { display_name: "Bob" } },
        { author: { display_name: "Charlie" } },
        { author: { display_name: "Diana" } },
      ],
    };

    const result = trimPaperData(workWithAuthors);

    expect(result.authors).toBe("Alice, Bob, Charlie, Diana");
  });

  it("filters out authorships with missing display_name", () => {
    const workWithMissingNames = {
      id: "https://openalex.org/W3333333333",
      title: "Paper With Missing Author Names",
      authorships: [
        { author: { display_name: "Alice" } },
        { author: { display_name: undefined } },
        { author: {} },
        { author: { display_name: "Charlie" } },
      ],
    };

    const result = trimPaperData(workWithMissingNames);

    expect(result.authors).toBe("Alice, Charlie");
  });

  it("returns undefined for authors when authorships array is empty", () => {
    const workWithEmptyAuthorships = {
      id: "https://openalex.org/W4444444444",
      title: "No Authors Paper",
      authorships: [],
    };

    const result = trimPaperData(workWithEmptyAuthorships);

    expect(result.authors).toBeUndefined();
  });

  it("produces output under 1500 bytes for a full Work fixture", () => {
    const output = JSON.stringify(trimPaperData(fullWork));

    expect(output.length).toBeLessThan(1500);
  });
});
