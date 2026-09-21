import { describe, expect, it, vi, afterEach } from "vitest";
import { paperToCitationData } from "@/lib/citations/paper-data";
import { getPaperCitations } from "@/lib/citations/server";

const paper = { id: "https://openalex.org/W12345", title: "Schools in Kenya", publication_year: 2025,
  authorships: [{ author: { id: "https://openalex.org/A1", display_name: "Jane Smith" } }],
  biblio: { first_page: "12", last_page: "20", volume: "4", issue: "2" },
  primary_location: { source: { id: "https://openalex.org/S1", display_name: "Education", type: "journal" } },
};
afterEach(() => vi.unstubAllGlobals());

describe("paper citations", () => {
  it("formats loaded metadata without making a request for a record with no DOI", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const result = await getPaperCitations(paperToCitationData(paper)!, "en-GB");
    expect(result.citations.apa).toBe("Jane Smith. (2025). Schools in Kenya. Education, 4(2), 12–20.");
    expect(result.citations.bibtex).toMatch(/^@article\{os_W12345,/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses structured publisher author names when the DOI supplies them", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      DOI: "10.1234/education", type: "journal-article", title: "Schools in Kenya",
      ISSN: ["0002-8282"],
      author: [{ family: "Smith", given: "Jane" }], issued: { "date-parts": [[2025]] },
    })));
    const result = await getPaperCitations(paperToCitationData({ ...paper, doi: "https://doi.org/10.1234/education" })!, "en-GB");
    expect(result.citations.apa).toContain("Smith, J. (2025).");
    expect(result.citations.apa).toContain("Education, 4(2), 12–20.");
    expect(result.citations.bibtex).toMatch(/^@article\{os_W12345,/);
  });
  it("still provides a citation when DOI metadata is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
    const result = await getPaperCitations(paperToCitationData({ ...paper, doi: "10.1234/education" })!, "en-GB");
    expect(result.citations.apa).toContain("Schools in Kenya.");
  });
  it("does not fabricate missing names or display a citation action without a title", () => {
    expect(paperToCitationData({ ...paper, title: undefined })).toBeNull();
    expect(paperToCitationData(paper)?.author).toEqual([{ literal: "Jane Smith" }]);
  });
});
