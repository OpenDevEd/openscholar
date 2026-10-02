import { describe, expect, it, vi, afterEach } from "vitest";
import { paperToCitationData } from "@/lib/citations/paper-data";
import { getPaperCitationMetadata } from "@/lib/citations/server";
import { loadPaperCitations } from "@/lib/citations/client";

const paper = { id: "https://openalex.org/W12345", title: "Schools in Kenya", publication_year: 2025,
  authorships: [{ author: { id: "https://openalex.org/A1", display_name: "Jane Smith" } }],
  biblio: { first_page: "12", last_page: "20", volume: "4", issue: "2" },
  primary_location: { source: { id: "https://openalex.org/S1", display_name: "Education", type: "journal" } },
};
afterEach(() => vi.unstubAllGlobals());

describe("paper citations", () => {
  it("formats a loaded DOI record without waiting for any network request", async () => {
    const fetch = vi.fn(() => { throw new Error("Network unavailable"); }); vi.stubGlobal("fetch", fetch);
    const result = await loadPaperCitations(["paper-citations", paperToCitationData({ ...paper, doi: "10.1234/education" })!, "en-GB"]);
    expect(result.citations.apa.text).toBe("Jane Smith. (2025). Schools in Kenya. Education, 4(2), 12–20. https://doi.org/10.1234/education");
    expect(result.citations.bibtex.text).toMatch(/^@article\{os_W12345,/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses structured publisher author names when the DOI supplies them", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      DOI: "10.1234/education", type: "journal-article", title: "Schools in Kenya",
      ISSN: ["0002-8282"],
      author: [{ family: "Smith", given: "Jane" }], issued: { "date-parts": [[2025]] },
    })));
    const data = await getPaperCitationMetadata(paperToCitationData({ ...paper, doi: "https://doi.org/10.1234/education" })!);
    const result = await loadPaperCitations(["paper-citations", data, "en-GB"]);
    expect(result.citations.apa.text).toContain("Smith, J. (2025).");
    expect(result.citations.apa.text).toContain("Education, 4(2), 12–20.");
    expect(result.citations.bibtex.text).toMatch(/^@article\{os_W12345,/);
  });
  it("still provides a citation when DOI metadata is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
    const data = await getPaperCitationMetadata(paperToCitationData({ ...paper, doi: "10.1234/education" })!);
    const result = await loadPaperCitations(["paper-citations", data, "en-GB"]);
    expect(result.citations.apa.text).toContain("Schools in Kenya.");
  });
  it("cites an OpenAlex paper whose id is written with http", () => {
    expect(paperToCitationData({ ...paper, id: "http://openalex.org/W12345" })?.id).toBe("W12345");
  });
  it("cites a paper from the OpenScholar API by its OS id", async () => {
    const data = paperToCitationData({ ...paper, id: "https://openscholar.ai/OS150911088" })!;
    expect([data.id, data["citation-key"]]).toEqual(["OS150911088", "os_OS150911088"]);
    const record = await getPaperCitationMetadata(data);
    expect([record.id, record["citation-key"]]).toEqual(["OS150911088", "os_OS150911088"]);
  });
  it("does not fabricate missing names or display a citation action without a title", () => {
    expect(paperToCitationData({ ...paper, title: undefined })).toBeNull();
    expect(paperToCitationData(paper)?.author).toEqual([{ literal: "Jane Smith" }]);
  });
});

it("exports Unicode names and TeX characters as reusable BibTeX", async () => {
  const { Cite } = await import("@citation-js/core");
  const name = "研究 & Development 50% $5 #1_A";
  const result = await loadPaperCitations(["paper-citations", paperToCitationData({
    ...paper, title: "Éducation au Sénégal et 教育", language: "fr",
    authorships: [{ author: { id: "https://openalex.org/A1", display_name: name } }],
  })!, "en-GB"]);
  const [parsed] = new Cite(result.citations.bibtex.text).data;
  expect(parsed).toMatchObject({ title: "Éducation au Sénégal et 教育", language: "fr", author: [{ family: name }] });
});


it("preserves styled bibliography text and clickable DOI links alongside plain text", async () => {
  const { formatCitations } = await import("@/lib/citations/formatter");
  const { apa } = await formatCitations({
    id: "rich", "citation-key": "rich", type: "article-journal", title: "Evidence & education",
    author: [{ family: "Smith", given: "Jane" }], issued: { "date-parts": [[2026]] },
    "container-title": "Journal of Education", volume: "42", DOI: "10.1234/evidence",
  }, "en-GB");
  expect(apa.html).toContain("<i>Journal of Education</i>");
  expect(apa.html).toContain('href="https://doi.org/10.1234/evidence"');
  expect(apa.text).toContain("Evidence & education");
  expect(apa.text).not.toMatch(/<[^>]+>/);
});


it("omits reference numbering from a standalone numeric citation without stripping title numbers", async () => {
 const { formatCitations } = await import("@/lib/citations/formatter");
 const { vancouver } = await formatCitations({
  id: "standalone", "citation-key": "standalone", type: "report", title: "2026 education outcomes",
  author: [{ family: "Smith", given: "Jane" }], issued: { "date-parts": [[2026]] },
 }, "en-GB");
 expect(vancouver.text).toMatch(/^Smith J\./);
 expect(vancouver.text).toContain("2026 education outcomes");
 expect(vancouver.html?.replace(/<[^>]+>/g, "").trim()).toMatch(/^Smith J\./);
});
