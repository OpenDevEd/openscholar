// An abstract OpenAlex holds is taken for a paper that came without one, and only from the work that is that paper (./held.ts `withAbstracts`).
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withAbstracts } from "./held";

beforeEach(() => {
  vi.stubEnv("OPENALEX_API_KEY", "platform-key");
  vi.stubEnv("OPENALEX_CONTACT_EMAIL", "contact@example.test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("takes OpenAlex's abstract for the same paper, and never another paper's that an index named by mistake", async () => {
  // OpenAlex holds the first under its own title. Under the second paper's ID it holds a different work: the index that gave the ID was wrong.
  const works = [
    { id: "https://openalex.org/W1", title: "Tutoring at scale: a randomised trial", abstract_inverted_index: { Tutors: [0], help: [1] } },
    { id: "https://openalex.org/W2", title: "Grade retention and school completion", abstract_inverted_index: { Dropouts: [0], repeat: [1] } },
  ];
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ meta: { count: works.length }, results: works })));
  const papers = await withAbstracts(
    [
      { paper: "openalex:W1", title: "Tutoring at Scale: A Randomised Trial" },
      { paper: "openalex:W2", title: "Effect of a cash transfer programme for schooling on prevalence of HIV in Malawi" },
      { paper: "openalex:W3", title: "A paper with its abstract", abstract: "Its own." },
    ],
    async () => true,
  );
  expect(papers.map((paper) => paper.abstract)).toEqual(["Tutors help", undefined, "Its own."]);
});
