import { paperPath } from "../papers/page-address";
import { paperLinkKey, paperLinkOf } from "../papers/paper-links";

/** Papers one request to a community looks up or adds at most, as its endpoint allows. */
export const ADDED_PAPERS_MAX = 100;

/** The most of one status Your submissions counts; past it, the count says "at least". */
export const SUBMISSIONS_COUNTED = 500;

/**
 * A paper a paste names: by its OpenAlex work, its DOI, or a `link` only Openscholar can follow (a paper only our
 * index has, or a community's record), which the server turns into one of those. `key` tells two apart.
 */
export type PastedPaper = { key: string; doi: string | null; openalexId: string | null; link: string | null; raw: string };

/** The papers a paste names, each once: DOIs, OpenAlex IDs and every address of a paper that names one, split on spaces and lines. */
export function parsePaste(text: string): { papers: PastedPaper[]; invalid: string[] } {
  const papers: PastedPaper[] = [];
  const invalid: string[] = [];
  // Split on spaces and lines only: a DOI's suffix may hold commas, semicolons and brackets.
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const link = paperLinkOf(raw);
    if (!link) {
      invalid.push(raw);
      continue;
    }
    const key = paperLinkKey(link);
    if (papers.some((paper) => paper.key === key)) continue;
    papers.push({
      key,
      openalexId: link.kind === "work" ? link.openalexId : null,
      doi: link.kind === "doi" ? link.doi : null,
      link: link.kind === "own" || link.kind === "record" ? raw : null,
      raw,
    });
  }
  return { papers, invalid };
}

/** The paper's page here, or its DOI's address for one OpenAlex doesn't have yet, which has no page here. */
export const paperHref = (paper: { openalexId: string | null; doi: string | null; title: string }) =>
  paper.openalexId ? paperPath(paper.openalexId, paper.title) : `https://doi.org/${paper.doi}`;

/** The record's page on the community. */
export const recordHref = (address: string, itemKey: string) => new URL(`/lib/${encodeURIComponent(itemKey)}`, address).toString();
