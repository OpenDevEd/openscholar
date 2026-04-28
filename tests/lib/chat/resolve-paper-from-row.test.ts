import { describe, expect, it } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import { resolvePaperFromRow } from "@/lib/chat/resolve-paper";

const cp = (n: number) => `cp${n}` as unknown as Id<"chatPapers">;
const src = (n: number) => `src${n}` as unknown as Id<"extractionJobSources">;
const job = "job1" as unknown as Id<"extractionJobs">;

function row(overrides: Partial<ChatSourceRow> = {}): ChatSourceRow {
  return {
    chatPaperId: cp(1),
    sourceId: src(1),
    jobId: job,
    position: 7,
    included: true,
    title: "Photosynthesis in kelp forests",
    authors: ["Smith, J", "Doe, A"],
    year: 2024,
    abstract: "We examine kelp.",
    doi: "10.1234/abc",
    pdfUrl: "https://example.org/pdf",
    openalexId: "W123",
    citedByCount: null,
    venueName: null,
    workType: null,
    bucketKey: "openalex:W123",
    sourceType: "openalex",
    ...overrides,
  };
}

describe("resolvePaperFromRow", () => {
  it("projects the ResolvablePaper fields verbatim from the row", () => {
    const input = row();
    const paper = resolvePaperFromRow(input);

    expect(paper.sourceId).toBe(input.sourceId);
    expect(paper.chatPaperId).toBe(input.chatPaperId);
    expect(paper.position).toBe(input.position);
    expect(paper.title).toBe(input.title);
    expect(paper.authors).toBe(input.authors);
    expect(paper.year).toBe(input.year);
    expect(paper.abstract).toBe(input.abstract);
    expect(paper.doi).toBe(input.doi);
    expect(paper.pdfUrl).toBe(input.pdfUrl);
    expect(paper.openalexId).toBe(input.openalexId);
    expect(paper.included).toBe(input.included);
  });

  it("does not expose Convex-only fields (jobId, bucketKey, sourceType)", () => {
    const paper = resolvePaperFromRow(row()) as unknown as Record<
      string,
      unknown
    >;
    expect(paper.jobId).toBeUndefined();
    expect(paper.bucketKey).toBeUndefined();
    expect(paper.sourceType).toBeUndefined();
  });

  it("preserves nulls", () => {
    const paper = resolvePaperFromRow(
      row({ year: null, abstract: null, doi: null, pdfUrl: null, openalexId: null }),
    );
    expect(paper.year).toBeNull();
    expect(paper.abstract).toBeNull();
    expect(paper.doi).toBeNull();
    expect(paper.pdfUrl).toBeNull();
    expect(paper.openalexId).toBeNull();
  });
});
