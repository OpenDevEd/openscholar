import { describe, expect, it } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import { stabilizeRowsById } from "@/lib/chat/stabilize-rows";

const cp = (n: number) => `cp${n}` as unknown as Id<"chatPapers">;
const src = (n: number) => `src${n}` as unknown as Id<"extractionJobSources">;
const job = "job1" as unknown as Id<"extractionJobs">;

function row(overrides: Partial<ChatSourceRow> = {}): ChatSourceRow {
  return {
    chatPaperId: cp(1),
    sourceId: src(1),
    jobId: job,
    position: 1,
    included: true,
    title: "Row one",
    authors: ["Smith, J"],
    year: 2024,
    abstract: null,
    doi: null,
    pdfUrl: null,
    openalexId: null,
    bucketKey: "openalex:W1",
    sourceType: "openalex",
    ...overrides,
  };
}

describe("stabilizeRowsById", () => {
  it("returns an empty array when both prev and next are empty", () => {
    expect(stabilizeRowsById([], [])).toEqual([]);
  });
});
