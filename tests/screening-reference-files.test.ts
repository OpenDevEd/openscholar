// A reference manager files each record by its kind: a book or a thesis exported as a journal article lands in the wrong place.
import { describe, expect, it, vi } from "vitest";
// The export module reaches the app's Convex client as it loads; an address is all it needs here, nothing is fetched.
vi.hoisted(() => { process.env.NEXT_PUBLIC_CONVEX_URL ??= "https://example.convex.cloud"; });
import { bibOf, risOf } from "../components/screening/export";
import type { Paper } from "../components/screening/data";

const paper = (workType: string | undefined, venue: string) => ({ id: `p-${workType ?? "none"}`, key: "k", title: "A title", authors: ["Ana Silva"], year: 2024, venue, abstract: "An abstract.", cast: [], ...(workType ? { workType } : {}) }) as unknown as Paper;

describe("reference files", () => {
  it("file a book, a thesis and a report as such, and anything unnamed as a journal article", () => {
    const papers = [paper("book", "Oxford University Press"), paper("dissertation", "University of Cape Town"), paper("report", "World Bank"), paper(undefined, "The Lancet")];
    const ris = risOf(papers);
    expect(ris.match(/^TY {2}- \w+/gm)).toEqual(["TY  - BOOK", "TY  - THES", "TY  - RPRT", "TY  - JOUR"]);
    expect(ris).toContain("JO  - The Lancet");
    expect(ris).toContain("T2  - World Bank");
    const bib = bibOf(papers);
    expect(bib.match(/^@\w+/gm)).toEqual(["@book", "@phdthesis", "@techreport", "@article"]);
    expect(bib).toContain("school = {University of Cape Town}");
    expect(bib).toContain("journal = {The Lancet}");
  });
});
