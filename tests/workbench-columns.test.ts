import { describe, it, expect, vi } from "vitest";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  CheckCircle2: () => null,
  AlertCircle: () => null,
  MinusCircle: () => null,
}));

// Mock Badge component
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock cn utility
vi.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

import {
  createWorkbenchColumns,
  type WorkbenchPaper,
  type ExtractionQuestion,
} from "../lib/extraction/workbench-columns";

const mockPaper: WorkbenchPaper = {
  _id: "paper1",
  title: "Test Paper",
  openalexId: "W123",
  doi: "10.1234/test",
  status: "completed",
  parsingSource: "pmc",
  results: [
    {
      questionId: "q1",
      answer: "Yes, it does",
      confidence: "high",
    },
    {
      questionId: "q2",
      answer: "No evidence",
      confidence: "low",
    },
  ],
};

describe("createWorkbenchColumns", () => {
  it("returns exactly 5 static columns when no questions provided", () => {
    const columns = createWorkbenchColumns([]);
    expect(columns).toHaveLength(5);
  });

  it("returns 6 columns with 1 question (5 static + 1 dynamic)", () => {
    const questions: ExtractionQuestion[] = [
      { key: "q1", question: "What is X?" },
    ];
    const columns = createWorkbenchColumns(questions);
    expect(columns).toHaveLength(6);
  });

  it("returns 8 columns with 3 questions (5 static + 3 dynamic)", () => {
    const questions: ExtractionQuestion[] = [
      { key: "q1", question: "What is X?" },
      { key: "q2", question: "What is Y?" },
      { key: "q3", question: "What is Z?" },
    ];
    const columns = createWorkbenchColumns(questions);
    expect(columns).toHaveLength(8);
  });

  it("title column has accessorKey 'title' and enableHiding: false", () => {
    const columns = createWorkbenchColumns([]);
    const titleCol = columns.find(
      (c) => "accessorKey" in c && c.accessorKey === "title",
    );
    expect(titleCol).toBeDefined();
    expect(titleCol!.enableHiding).toBe(false);
  });

  it("status column has filterFn 'equals'", () => {
    const columns = createWorkbenchColumns([]);
    const statusCol = columns.find(
      (c) => "accessorKey" in c && c.accessorKey === "status",
    );
    expect(statusCol).toBeDefined();
    expect(statusCol!.filterFn).toBe("equals");
  });

  it("confidence column has filterFn 'equals'", () => {
    const columns = createWorkbenchColumns([]);
    const confCol = columns.find((c) => c.id === "confidence");
    expect(confCol).toBeDefined();
    expect(confCol!.filterFn).toBe("equals");
  });

  it("dynamic question columns have id 'question-{key}' and filterFn 'includesString'", () => {
    const questions: ExtractionQuestion[] = [
      { key: "q1", question: "What is X?" },
    ];
    const columns = createWorkbenchColumns(questions);
    const qCol = columns.find((c) => c.id === "question-q1");
    expect(qCol).toBeDefined();
    expect(qCol!.filterFn).toBe("includesString");
  });

  it("dynamic question accessorFn extracts the correct answer from results", () => {
    const questions: ExtractionQuestion[] = [
      { key: "q1", question: "What is X?" },
    ];
    const columns = createWorkbenchColumns(questions);
    const qCol = columns.find((c) => c.id === "question-q1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accessorFn = (qCol as any).accessorFn;
    expect(accessorFn).toBeDefined();
    const result = accessorFn(mockPaper);
    expect(result).toBe("Yes, it does");
  });

  it("dynamic question accessorFn returns null when no matching result", () => {
    const questions: ExtractionQuestion[] = [
      { key: "nonexistent", question: "Unknown?" },
    ];
    const columns = createWorkbenchColumns(questions);
    const qCol = columns.find((c) => c.id === "question-nonexistent");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accessorFn = (qCol as any).accessorFn;
    const result = accessorFn(mockPaper);
    expect(result).toBeNull();
  });
});
