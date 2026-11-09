import { describe, expect, it } from "vitest";
import { paperLinkOf } from "./paper-links";
import { parsePaste } from "../evidence-libraries/added-papers";

describe("a paper someone pastes", () => {
  it("is found on every address that names one, Openscholar's and its communities' included", () => {
    expect(paperLinkOf("W2126314681")).toEqual({ kind: "work", openalexId: "W2126314681" });
    expect(paperLinkOf("https://openalex.org/works/W2126314681")).toEqual({ kind: "work", openalexId: "W2126314681" });
    expect(paperLinkOf("https://dev.openscholar.ai/papers/W2565346880/relationships-between-teachers")).toEqual({ kind: "work", openalexId: "W2565346880" });
    expect(paperLinkOf("https://openscholar.ai/o/lab/papers/OS79563844?from=search")).toEqual({ kind: "own", work: "OS79563844" });
    expect(paperLinkOf("https://discover.openscholar.ai/papers/os79563844")).toEqual({ kind: "own", work: "OS79563844" });
    expect(paperLinkOf("OS79563844")).toEqual({ kind: "own", work: "OS79563844" });
    expect(paperLinkOf("https://wealth-inequality.openscholar.ai/lib/ABCD2345")).toEqual({ kind: "record", origin: "https://wealth-inequality.openscholar.ai", itemKey: "ABCD2345" });
    expect(paperLinkOf("https://aievidencehub.org/lib/WMYN7Q2X/")).toEqual({ kind: "record", origin: "https://aievidencehub.org", itemKey: "WMYN7Q2X" });
    expect(paperLinkOf("https://doi.org/10.1016/j.tate.2015.06.010.")).toEqual({ kind: "doi", doi: "10.1016/j.tate.2015.06.010" });
    expect(paperLinkOf("(10.1000/xyz(1)),")).toEqual({ kind: "doi", doi: "10.1000/xyz(1)" });
    // As a sentence or a list writes them: after a word, in brackets, with a full stop.
    expect(paperLinkOf("https://dev.openscholar.ai/papers/OS79563844.")).toEqual({ kind: "own", work: "OS79563844" });
    expect(paperLinkOf("(https://dev.openscholar.ai/papers/OS79563844)")).toEqual({ kind: "own", work: "OS79563844" });
    expect(paperLinkOf("<https://aievidencehub.org/lib/WMYN7Q2X>.")).toEqual({ kind: "record", origin: "https://aievidencehub.org", itemKey: "WMYN7Q2X" });
  });

  it("isn't found where nothing names one: another site's /papers/ path, a page that isn't a record, or a word", () => {
    expect(paperLinkOf("https://example.org/papers/W2126314681/a-title")).toBeNull();
    expect(paperLinkOf("https://openscholar.ai/library")).toBeNull();
    expect(paperLinkOf("https://aievidencehub.org/lib")).toBeNull();
    expect(paperLinkOf("teachers")).toBeNull();
  });

  it("is looked up once however it's named, and a link only Openscholar follows goes to the server as given", () => {
    const { papers, invalid } = parsePaste("W2565346880 https://dev.openscholar.ai/papers/W2565346880/a https://openscholar.ai/papers/OS1/b OS1 nonsense");
    expect(papers.map(({ key, openalexId, link }) => ({ key, openalexId, link }))).toEqual([
      { key: "W2565346880", openalexId: "W2565346880", link: null },
      { key: "own:OS1", openalexId: null, link: "https://openscholar.ai/papers/OS1/b" },
    ]);
    expect(invalid).toEqual(["nonsense"]);
  });
});
