// DOIs the index has no record of are asked of Crossref, then DataCite (./doiRecords.ts).
import { afterEach, expect, it, vi } from "vitest";
import { registered } from "./doiRecords";

afterEach(() => vi.unstubAllGlobals());

it("takes Crossref's record, then DataCite's, with the abstract as plain text, and leaves out a DOI neither holds", async () => {
  const answers: Record<string, unknown> = {
    "https://api.crossref.org/works/10.1000%2Fa": { message: { title: ["Tutoring at scale"], abstract: "<jats:title>Abstract</jats:title><jats:p>Tutors help &amp; pupils gain.</jats:p>", author: [{ given: "Ada", family: "Okafor" }, { name: "A Ministry" }], issued: { "date-parts": [[2021, 3]] }, "container-title": ["A journal"] } },
    "https://api.datacite.org/dois/10.5000%2Fb": { data: { attributes: { titles: [{ title: "A report on meals" }], descriptions: [{ description: "What the report found.", descriptionType: "Abstract" }], creators: [{ givenName: "Ben", familyName: "Mensah" }], publicationYear: 2019, publisher: { name: "An institute" } } } },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (answers[url] ? Response.json(answers[url]) : new Response("", { status: 404 }))));
  const found = await registered(["10.1000/a", "10.5000/b", "10.9999/nothing"]);
  expect([...found.keys()]).toEqual(["10.1000/a", "10.5000/b"]);
  expect(found.get("10.1000/a")).toEqual({ title: "Tutoring at scale", doi: "10.1000/a", abstract: "Tutors help & pupils gain.", authors: ["Ada Okafor", "A Ministry"], publicationYear: 2021, venue: "A journal" });
  expect(found.get("10.5000/b")).toEqual({ title: "A report on meals", doi: "10.5000/b", abstract: "What the report found.", authors: ["Ben Mensah"], publicationYear: 2019, venue: "An institute" });
});
