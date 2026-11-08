"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { openalexWork, normalDoi } from "@/lib/papers/paper-ref";

// MOCK (mock/added-papers): no server keeps added papers yet. They live in this tab's session storage, so a paper
// added from Discover shows on the community's Sources tab. The real list lives in new-el, linked to an
// "Added papers" source.

/** How the paper was found: on OpenAlex (by its ID or DOI), or only by the DOI lookup the admin import uses. */
export type FoundBy = "openalex" | "doi";
/** `synced`: on the community and kept up to date from OpenAlex. `retrying`: on the community from its DOI, and looked
 * for on OpenAlex at each sync until it's there. `queued`: waiting in the community's review queue. */
export type AddedState = "synced" | "retrying" | "queued";

export type FoundPaper = {
  key: string;
  title: string;
  authors: string;
  year: number | null;
  doi: string | null;
  openalexId: string | null;
  foundBy: FoundBy;
};

export type AddedPaper = FoundPaper & { state: AddedState; addedAt: number; by: string };

const DAY = 86_400_000;
const seedAt = Date.parse("2026-11-08T09:00:00Z");

/** Real papers, as OpenAlex lists them, that every community starts with in the mock. */
const SEED: AddedPaper[] = [
  { key: "W2126314681", openalexId: "W2126314681", doi: "10.1080/1475939x.2015.1092466", title: "Challenges and opportunities for teacher professional development in interactive use of technology in African schools", authors: "Sara Hennessy, Bjoern Haßler, Riikka Hofmann", year: 2015, foundBy: "openalex", state: "synced", addedAt: seedAt - 6 * DAY, by: "You" },
  { key: "W3120613417", openalexId: "W3120613417", doi: "10.4324/9780429341212-3", title: "Teacher professional development in sub-Saharan Africa", authors: "Björn Haßler, Gemma Bennett, Kalifa Damani", year: 2021, foundBy: "openalex", state: "synced", addedAt: seedAt - 5 * DAY, by: "You" },
  { key: "W2079517805", openalexId: "W2079517805", doi: "10.1080/09585176.2012.747725", title: "Rethinking teacher preparation and professional development in Africa: an analysis of the curriculum of teacher education in the teaching of early reading and mathematics", authors: "John Pryor, Kwame Akyeampong, Jo Westbrook", year: 2012, foundBy: "openalex", state: "synced", addedAt: seedAt - 4 * DAY, by: "Amina Yusuf" },
  // On Crossref, not yet on OpenAlex (checked 2026-11-08).
  { key: "doi:10.68354/743355", openalexId: null, doi: "10.68354/743355", title: "School Leadership Support, Teacher Professional Development, and Professional Growth: An Explanatory Sequential Mixed-Methods Study in Public Elementary Schools", authors: "Mary Loryne Ladigohon, Darlene Flores, John Khristone Erolpan", year: 2026, foundBy: "doi", state: "retrying", addedAt: seedAt - 3 * DAY, by: "You" },
  { key: "W2202062786", openalexId: "W2202062786", doi: "10.1016/j.tate.2015.06.010", title: "Challenges influencing teachers' involvement in continuous professional development: A South African perspective", authors: "Johanna L. Geldenhuys, Lizette Clarise Oosthuizen", year: 2015, foundBy: "openalex", state: "synced", addedAt: seedAt - 2 * DAY, by: "Amina Yusuf" },
  { key: "W2147455089", openalexId: "W2147455089", doi: "10.15700/201412071132", title: "When teacher clusters work: selected experiences of South African teachers with the cluster approach to professional development", authors: "Loyiso C. Jita, Matseliso L. Mokhele", year: 2014, foundBy: "openalex", state: "synced", addedAt: seedAt - 2 * DAY, by: "You" },
  { key: "W4238098666", openalexId: "W4238098666", doi: "10.15700/saje.v30n1a320", title: "A case study of continuing teacher professional development through lesson study in South Africa", authors: "Yumiko Ono, Johanna G. Ferreira", year: 2010, foundBy: "openalex", state: "queued", addedAt: seedAt - DAY, by: "Daniel Mensah" },
  { key: "W2737893103", openalexId: "W2737893103", doi: "10.17159/sajs.2017/20160364", title: "Teacher participation in science fairs as professional development in South Africa", authors: "Clement Kapase Mbowane, J.J.R. De Villiers, Max W. H. Braun", year: 2017, foundBy: "openalex", state: "queued", addedAt: seedAt - DAY / 2, by: "Lerato Dube" },
];

const NEWEST_FIRST = [...SEED].sort((a, b) => b.addedAt - a.addedAt);

type Store = {
  /** Each community's added papers, newest first. A community not in here has the seed. */
  byCommunity: Record<string, AddedPaper[]>;
  add: (communityId: string, papers: FoundPaper[], publish: boolean) => void;
  remove: (communityId: string, key: string) => void;
};

export const useAddedPapers = create<Store>()(
  persist(
    (set) => ({
      byCommunity: {},
      add: (communityId, papers, publish) =>
        set((state) => {
          const current = state.byCommunity[communityId] ?? NEWEST_FIRST;
          const fresh = distinctPapers(papers)
            .filter((paper) => !current.some((row) => row.key === paper.key || (paper.doi !== null && row.doi === paper.doi)))
            .map((paper): AddedPaper => ({ ...paper, addedAt: Date.now(), by: "You", state: !publish ? "queued" : paper.foundBy === "doi" ? "retrying" : "synced" }));
          return { byCommunity: { ...state.byCommunity, [communityId]: [...fresh, ...current] } };
        }),
      remove: (communityId, key) =>
        set((state) => ({
          byCommunity: { ...state.byCommunity, [communityId]: (state.byCommunity[communityId] ?? NEWEST_FIRST).filter((row) => row.key !== key) },
        })),
    }),
    { name: "mock-added-papers", storage: createJSONStorage(() => sessionStorage) },
  ),
);

/** Each paper once, when a paste named it twice, such as by its DOI and by its OpenAlex ID. */
export function distinctPapers<T extends FoundPaper>(papers: T[]): T[] {
  return papers.filter((paper, index) => papers.findIndex((other) => other.key === paper.key || (paper.doi !== null && other.doi === paper.doi)) === index);
}

export const communityPapers = (byCommunity: Store["byCommunity"], communityId: string) => byCommunity[communityId] ?? NEWEST_FIRST;

/** A DOI without the punctuation a sentence or list put after it: a list's comma, a full stop, an unopened bracket. */
function trimDoi(doi: string): string {
  let trimmed = doi.replace(/[,;.]+$/, "");
  while (trimmed.endsWith(")") && (trimmed.match(/\(/g)?.length ?? 0) < (trimmed.match(/\)/g)?.length ?? 0)) trimmed = trimmed.slice(0, -1);
  return trimmed;
}

/** The papers a paste names, each once: DOIs, OpenAlex IDs and their links, split on spaces, commas and lines. */
export function parsePaste(text: string): { refs: { key: string; doi: string | null; openalexId: string | null; raw: string }[]; invalid: string[] } {
  const refs: { key: string; doi: string | null; openalexId: string | null; raw: string }[] = [];
  const invalid: string[] = [];
  // Split on spaces and lines only: a DOI's suffix may hold commas, semicolons and brackets.
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const openalexId = openalexWork(raw.replace(/[,;]$/, ""));
    const doiMatch = raw.match(/10\.\d{4,9}\/\S+/i)?.[0];
    const doi = openalexId ? null : doiMatch ? normalDoi(trimDoi(doiMatch)) : null;
    const key = openalexId ?? (doi ? `doi:${doi}` : null);
    if (!key) invalid.push(raw);
    else if (!refs.some((ref) => ref.key === key)) refs.push({ key, doi, openalexId, raw });
  }
  return { refs, invalid };
}

type Work = { id: string; doi: string | null; title: string | null; publication_year: number | null; authorships: { author: { display_name: string } }[] };
const authorsOf = (names: string[]) => (names.length > 3 ? `${names.slice(0, 3).join(", ")} et al.` : names.join(", "));
const agent = { headers: { "User-Agent": "openscholar-mock (added papers)" } };

/**
 * One reference looked up as the real flow will: the OpenAlex ID, then OpenAlex by DOI, then the DOI on its own
 * (Crossref here, standing in for the admin import's lookup). Null when none has it.
 */
export async function lookUp(ref: { key: string; doi: string | null; openalexId: string | null }): Promise<FoundPaper | null> {
  const fromWork = (work: Work): FoundPaper => {
    const id = work.id.replace("https://openalex.org/", "");
    return { key: id, openalexId: id, doi: normalDoi(work.doi), title: work.title ?? "Untitled", authors: authorsOf(work.authorships.map((a) => a.author.display_name)), year: work.publication_year, foundBy: "openalex" };
  };
  const path = ref.openalexId ? ref.openalexId : `doi:${ref.doi}`;
  const openalex = await fetch(`https://api.openalex.org/works/${path}?select=id,doi,title,publication_year,authorships`, agent).catch(() => null);
  if (openalex?.ok) return fromWork((await openalex.json()) as Work);
  if (!ref.doi) return null;
  const crossref = await fetch(`https://api.crossref.org/works/${encodeURIComponent(ref.doi)}`).catch(() => null);
  if (!crossref?.ok) return null;
  const item = ((await crossref.json()) as { message: { title?: string[]; author?: { given?: string; family?: string; name?: string }[]; issued?: { "date-parts"?: number[][] } } }).message;
  return {
    key: ref.key,
    openalexId: null,
    doi: ref.doi,
    title: item.title?.[0] ?? "Untitled",
    authors: authorsOf((item.author ?? []).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" "))),
    year: item.issued?.["date-parts"]?.[0]?.[0] ?? null,
    foundBy: "doi",
  };
}
