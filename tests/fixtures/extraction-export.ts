import type { Doc } from "../../convex/_generated/dataModel";
import type { PaperWithResults, Question } from "../../lib/extraction/filtering";
import { mockId } from "../factories";

export const exportJob: Doc<"extractionJobs"> = {
  _id: mockId("extractionJobs", "export"), _creationTime: 1, userId: mockId("users", "export"),
  name: "Research QA", mode: "extraction", sourceType: "manual", status: "completed", usePdfs: false, runEpoch: 2, createdAt: 1, updatedAt: 2,
};
export const exportQuestions: Question[] = [
  { key: "zero", type: "number", question: "Reported outcome", description: "Adverse events" },
  { key: "false", type: "boolean", question: "Reported outcome", description: "Was harm reported?" },
  { key: "names", type: "array", question: "Languages" },
  { key: "null", type: "string", question: "Not reported" },
  { key: "failed", type: "string", question: "Failed request" },
  { key: "pending", type: "string", question: "Pending question" },
];
const paperId = mockId("extractionPapers", "export");
const quote = "No adverse events were reported.";
const common = { _creationTime: 1, jobId: exportJob._id, paperId, citations: [], citationStatus: "best_effort" as const, status: "completed" as const, processedAt: 123, model: "openai/gpt-6-luna", provider: "openrouter" };
export const exportPapers: PaperWithResults[] = [{
  _id: paperId, _creationTime: 1, jobId: exportJob._id, openalexId: "https://openalex.org/W123", title: 'Trial, "تعليم"\nSecond line', doi: "10.1234/qa", publicationYear: 2024,
  authors: ["García, Ana", "المكتبة الوطنية", "王明"], status: "completed",
  sourceType: "screening", sourceId: "screening-origin", screeningRevision: "2:completed:3",
  results: [
    { ...common, _id: mockId("extractionResults", "zero"), questionKey: "zero", answer: 0, confidence: 0, modelConfidence: 0.95, reasoning: 'The text says "No adverse events".\nZero is reported.', citationStatus: "grounded", citations: [{ source: "abstract", paperId, sourceHash: "a".repeat(64), evidenceId: "abstract-fixture", quote, charRange: [0, quote.length], retrieval: {}, validated: true }] },
    { ...common, _id: mockId("extractionResults", "false"), questionKey: "false", answer: false, confidence: 1, model: "typesafe/jev-1.13" },
    { ...common, _id: mockId("extractionResults", "names"), questionKey: "names", answer: ["العربية", "中文", "Français; créole", "English, UK"], confidence: 0.8 },
    { ...common, _id: mockId("extractionResults", "null"), questionKey: "null", answer: null, citationStatus: "insufficient_evidence" },
    { ...common, _id: mockId("extractionResults", "failed"), questionKey: "failed", answer: null, confidence: 0, citationStatus: "extraction_error", status: "failed" },
  ],
}];
