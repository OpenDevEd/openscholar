import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture what gets passed to Blob constructor
let capturedBlobContent: string[] = [];

const mockLink = {
  href: "",
  download: "",
  click: vi.fn(),
};

// Mock DOM globals before importing modules that use them
vi.stubGlobal("URL", {
  createObjectURL: vi.fn(() => "blob:mock-url"),
  revokeObjectURL: vi.fn(),
});

vi.stubGlobal("document", {
  createElement: vi.fn(() => mockLink),
  body: {
    appendChild: vi.fn(),
    removeChild: vi.fn(),
  },
});

vi.stubGlobal(
  "Blob",
  class MockBlob {
    constructor(parts: string[]) {
      capturedBlobContent = parts;
    }
  }
);

import { exportToCSV, exportToJSON } from "../lib/extraction/export";

beforeEach(() => {
  capturedBlobContent = [];
  mockLink.href = "";
  mockLink.download = "";
  mockLink.click.mockClear();
});

const mockQuestions = [
  {
    key: "q1",
    question: "Is this relevant?",
    type: "boolean" as const,
    description: "Relevance",
  },
  {
    key: "q2",
    question: "Sample size",
    type: "number" as const,
    description: "N",
  },
];

const mockPapers = [
  {
    _id: "paper_1" as any,
    _creationTime: 0,
    title: "Test Paper One",
    doi: "10.1234/test1",
    publicationYear: 2024,
    authors: ["Author A", "Author B"],
    isOpenAccess: true,
    pdfContentUsed: false,
    results: [
      {
        questionKey: "q1",
        answer: true,
        confidence: 0.95,
        reasoning: "High relevance",
        citations: [{ id: "c1" }],
        citationStatus: "grounded",
        reviewState: "approved",
      },
      {
        questionKey: "q2",
        answer: 42,
        confidence: 0.8,
        reasoning: "Found in abstract",
      },
    ],
  } as any,
];

describe("exportToCSV", () => {
  it("default options include metadata and confidence columns", () => {
    exportToCSV(mockPapers, mockQuestions);
    const csv = capturedBlobContent[0];
    const headers = csv.split("\n")[0];
    expect(headers).toContain("Authors");
    expect(headers).toContain("Open Access");
    expect(headers).toContain("PDF Used");
    expect(headers).toContain("Is this relevant? (Confidence)");
    expect(headers).toContain("Sample size (Confidence)");
  });

  it("includeMetadata: false excludes metadata columns", () => {
    exportToCSV(mockPapers, mockQuestions, { includeMetadata: false });
    const csv = capturedBlobContent[0];
    expect(csv).not.toContain("Authors");
    expect(csv).not.toContain("Open Access");
    expect(csv).not.toContain("PDF Used");
    expect(csv).toContain("Paper Title");
    expect(csv).toContain("DOI");
  });

  it("includeConfidence: false excludes confidence columns", () => {
    exportToCSV(mockPapers, mockQuestions, { includeConfidence: false });
    const csv = capturedBlobContent[0];
    expect(csv).not.toContain("(Confidence)");
    expect(csv).toContain("Is this relevant?");
  });

  it("both flags false produces minimal columns", () => {
    exportToCSV(mockPapers, mockQuestions, {
      includeMetadata: false,
      includeConfidence: false,
    });
    const csv = capturedBlobContent[0];
    const headers = csv.split("\n")[0];
    expect(headers).not.toContain("Authors");
    expect(headers).not.toContain("(Confidence)");
  });

  it("formats boolean answer as Yes in CSV output", () => {
    exportToCSV(mockPapers, mockQuestions);
    const csv = capturedBlobContent[0];
    const dataRow = csv.split("\n")[1];
    expect(dataRow).toContain("Yes");
  });

  it("formats confidence as percentage", () => {
    exportToCSV(mockPapers, mockQuestions);
    const csv = capturedBlobContent[0];
    expect(csv).toContain("95%");
    expect(csv).toContain("80%");
  });

  it("uses correctedAnswer over answer when available", () => {
    const papersWithCorrection = [
      {
        ...mockPapers[0],
        results: [
          {
            questionKey: "q1",
            answer: true,
            correctedAnswer: false,
            confidence: 0.9,
          },
          { questionKey: "q2", answer: 42, confidence: 0.8 },
        ],
      },
    ] as any;
    exportToCSV(papersWithCorrection, mockQuestions);
    const csv = capturedBlobContent[0];
    expect(csv).toContain("No");
  });
});

describe("exportToJSON", () => {
  it("default options include reasoning and citations", () => {
    exportToJSON(mockPapers, mockQuestions);
    const json = JSON.parse(capturedBlobContent[0]);
    const firstResult = json.papers[0].results[0];
    expect(firstResult.reasoning).toBe("High relevance");
    expect(firstResult.citations).toBeDefined();
    expect(firstResult.citationStatus).toBe("grounded");
    expect(firstResult.reviewState).toBe("approved");
  });

  it("includeReasoning: false excludes reasoning", () => {
    exportToJSON(mockPapers, mockQuestions, { includeReasoning: false });
    const json = JSON.parse(capturedBlobContent[0]);
    const firstResult = json.papers[0].results[0];
    expect(firstResult).not.toHaveProperty("reasoning");
  });

  it("includeCitations: false excludes citation fields", () => {
    exportToJSON(mockPapers, mockQuestions, { includeCitations: false });
    const json = JSON.parse(capturedBlobContent[0]);
    const firstResult = json.papers[0].results[0];
    expect(firstResult).not.toHaveProperty("citations");
    expect(firstResult).not.toHaveProperty("citationStatus");
    expect(firstResult).not.toHaveProperty("reviewState");
  });

  it("both false produces minimal result fields", () => {
    exportToJSON(mockPapers, mockQuestions, {
      includeReasoning: false,
      includeCitations: false,
    });
    const json = JSON.parse(capturedBlobContent[0]);
    const firstResult = json.papers[0].results[0];
    expect(firstResult.questionKey).toBe("q1");
    expect(firstResult.answer).toBeDefined();
    expect(firstResult.confidence).toBeDefined();
    expect(firstResult).not.toHaveProperty("reasoning");
    expect(firstResult).not.toHaveProperty("citations");
  });

  it("includes paper metadata", () => {
    exportToJSON(mockPapers, mockQuestions);
    const json = JSON.parse(capturedBlobContent[0]);
    expect(json.exportedAt).toBeDefined();
    expect(json.totalPapers).toBe(1);
    expect(json.questions).toHaveLength(2);
    expect(json.papers[0].title).toBe("Test Paper One");
    expect(json.papers[0].doi).toBe("10.1234/test1");
    expect(json.papers[0].year).toBe(2024);
    expect(json.papers[0].openAccess).toBe(true);
    expect(json.papers[0].pdfUsed).toBe(false);
  });

  it("uses correctedAnswer over answer when available", () => {
    const papersWithCorrection = [
      {
        ...mockPapers[0],
        results: [
          {
            questionKey: "q1",
            answer: true,
            correctedAnswer: false,
            confidence: 0.9,
          },
        ],
      },
    ] as any;
    exportToJSON(papersWithCorrection, mockQuestions);
    const json = JSON.parse(capturedBlobContent[0]);
    expect(json.papers[0].results[0].answer).toBe(false);
  });
});
