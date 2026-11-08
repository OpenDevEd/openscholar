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
export type AddedState = "synced" | "retrying" | "queued" | "returned";

export type FoundPaper = {
  key: string;
  title: string;
  authors: string;
  year: number | null;
  doi: string | null;
  openalexId: string | null;
  foundBy: FoundBy;
};

export type AddedPaper = FoundPaper & { state: AddedState; addedAt: number; by: string; /** Why a reviewer returned it. */ note?: string };

/** A community as the submissions list shows it, kept when a paper is sent to it. */
export type CommunityRef = { id: string; name: string; faviconUrl?: string | null; address: string; owner: { name: string; imageUrl: string | null; kind: "person" | "organization"; workspaceId?: string } };

/** One paper you sent to a community, and where it got to. */
export type Submission = { paper: AddedPaper; community: CommunityRef };

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
  /** The communities papers were sent to from Discover, for the submissions list and Recent. */
  communities: Record<string, CommunityRef>;
  add: (communityId: string, papers: FoundPaper[], publish: boolean, community?: CommunityRef) => void;
  remove: (communityId: string, key: string) => void;
  /** Submissions you took back, as `communityId:paperKey`: the samples aren't in `byCommunity` to remove. */
  withdrawn: string[];
  withdraw: (communityId: string, key: string) => void;
};

export const useAddedPapers = create<Store>()(
  persist(
    (set) => ({
      byCommunity: {},
      communities: {},
      withdrawn: [],
      withdraw: (communityId, key) =>
        set((state) => ({
          withdrawn: [...state.withdrawn, `${communityId}:${key}`],
          byCommunity: state.byCommunity[communityId]
            ? { ...state.byCommunity, [communityId]: state.byCommunity[communityId].filter((row) => row.key !== key) }
            : state.byCommunity,
        })),
      add: (communityId, papers, publish, community) =>
        set((state) => {
          const current = state.byCommunity[communityId] ?? NEWEST_FIRST;
          const fresh = distinctPapers(papers)
            .filter((paper) => !current.some((row) => row.key === paper.key || (paper.doi !== null && row.doi === paper.doi)))
            .map((paper): AddedPaper => ({ ...paper, addedAt: Date.now(), by: "You", state: !publish ? "queued" : paper.foundBy === "doi" ? "retrying" : "synced" }));
          return {
            byCommunity: { ...state.byCommunity, [communityId]: [...fresh, ...current] },
            communities: community ? { ...state.communities, [communityId]: community } : state.communities,
          };
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

/** Sample papers sent by you to other people's public communities, so the list shows every state before you send any. */
const SAMPLE_SUBMISSIONS: { at: number; card: number; paper: AddedPaper }[] = [
  { card: 0, at: 1, paper: { key: "W2146928503", openalexId: "W2146928503", doi: "10.38140/aa.v41i2.1212", title: "Effective implementation of continuing professional development for South African teachers", authors: "Trudie Steyn", year: 2009, foundBy: "openalex", state: "queued", addedAt: seedAt - DAY, by: "You" } },
  { card: 1, at: 3, paper: { key: "W4389554609", openalexId: "W4389554609", doi: "10.20525/ijrbs.v12i8.2898", title: "Teacher professional development activities in Africa", authors: "Oluwatoyin Ayodele Ajani", year: 2023, foundBy: "openalex", state: "synced", addedAt: seedAt - 3 * DAY, by: "You" } },
  { card: 2, at: 5, paper: { key: "W2737893103", openalexId: "W2737893103", doi: "10.17159/sajs.2017/20160364", title: "Teacher participation in science fairs as professional development in South Africa", authors: "Clement Kapase Mbowane, J.J.R. De Villiers, Max W. H. Braun", year: 2017, foundBy: "openalex", state: "returned", note: "Outside this community's focus", addedAt: seedAt - 5 * DAY, by: "You" } },
  { card: 0, at: 9, paper: { key: "W2079517805", openalexId: "W2079517805", doi: "10.1080/09585176.2012.747725", title: "Rethinking teacher preparation and professional development in Africa: an analysis of the curriculum of teacher education in the teaching of early reading and mathematics", authors: "John Pryor, Kwame Akyeampong, Jo Westbrook", year: 2012, foundBy: "openalex", state: "synced", addedAt: seedAt - 9 * DAY, by: "You" } },
];

/**
 * Every paper you sent, newest first: the ones sent in this tab, then the samples, which go to the first public
 * communities `samples` names, so their links open real communities.
 */
export function mySubmissions(store: Pick<Store, "byCommunity" | "communities" | "withdrawn">, samples: CommunityRef[]): Submission[] {
  const sent = Object.entries(store.communities).flatMap(([id, community]) =>
    communityPapers(store.byCommunity, id).filter((paper) => paper.by === "You" && paper.addedAt > seedAt).map((paper) => ({ paper, community })),
  );
  const sampled = SAMPLE_SUBMISSIONS.flatMap(({ card, paper }) => (samples[card] ? [{ paper, community: samples[card] }] : []));
  return [...sent, ...sampled]
    .filter(({ paper, community }) => !store.withdrawn.includes(`${community.id}:${paper.key}`))
    .sort((a, b) => b.paper.addedAt - a.paper.addedAt);
}

/** The community's own address, from one written with or without its scheme. */
export const communityUrl = (address: string) => (/^https?:\/\//.test(address) ? address : `https://${address}`);

/**
 * The paper's own page in Openscholar. The paper-pages work (mock/paper-pages) serves `/papers/<id>` and sends an
 * OpenAlex ID on to the canonical address. A paper OpenAlex doesn't have yet opens at its DOI.
 */
export const paperHref = (paper: Pick<FoundPaper, "openalexId" | "doi">) =>
  paper.openalexId ? `/papers/${paper.openalexId}` : `https://doi.org/${paper.doi}`;

/**
 * The record on the community's site. MOCK: the community searched for the paper's DOI; once new-el approves a paper
 * it returns the record's key, and this becomes `/lib/<key>`.
 */
export const recordHref = (address: string, paper: Pick<FoundPaper, "doi" | "title">) =>
  `${communityUrl(address)}/lib?search=${encodeURIComponent(paper.doi ?? paper.title)}`;
