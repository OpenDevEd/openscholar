import { paperPath } from "../papers/page-address";
import { normalDoi, openalexWork } from "../papers/paper-ref";

/** Papers one request to a community looks up or adds at most, as its endpoint allows. */
export const ADDED_PAPERS_MAX = 100;

/** The most of one status Your submissions counts; past it, the count says "at least". */
export const SUBMISSIONS_COUNTED = 500;

/** A paper a paste names: by its OpenAlex work, or by its DOI. `key` tells two apart. */
export type PastedPaper = { key: string; doi: string | null; openalexId: string | null; raw: string };

/** A DOI without the punctuation a sentence or list put after it: a list's comma, a full stop, an unopened bracket. */
function trimDoi(doi: string): string {
  let trimmed = doi.replace(/[,;.]+$/, "");
  while (trimmed.endsWith(")") && (trimmed.match(/\(/g)?.length ?? 0) < (trimmed.match(/\)/g)?.length ?? 0)) trimmed = trimmed.slice(0, -1);
  return trimmed;
}

/** The papers a paste names, each once: DOIs, OpenAlex IDs and their links, split on spaces and lines. */
export function parsePaste(text: string): { papers: PastedPaper[]; invalid: string[] } {
  const papers: PastedPaper[] = [];
  const invalid: string[] = [];
  // Split on spaces and lines only: a DOI's suffix may hold commas, semicolons and brackets.
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const openalexId = openalexWork(raw.replace(/[,;]$/, ""));
    const doiMatch = raw.match(/10\.\d{4,9}\/\S+/i)?.[0];
    const doi = openalexId ? null : doiMatch ? normalDoi(trimDoi(doiMatch)) : null;
    const key = openalexId ?? (doi ? `doi:${doi}` : null);
    if (!key) invalid.push(raw);
    else if (!papers.some((paper) => paper.key === key)) papers.push({ key, doi, openalexId, raw });
  }
  return { papers, invalid };
}

/** The paper's page here, or its DOI's address for one OpenAlex doesn't have yet, which has no page here. */
export const paperHref = (paper: { openalexId: string | null; doi: string | null; title: string }) =>
  paper.openalexId ? paperPath(paper.openalexId, paper.title) : `https://doi.org/${paper.doi}`;

/** The record's page on the community. */
export const recordHref = (address: string, itemKey: string) => new URL(`/lib/${encodeURIComponent(itemKey)}`, address).toString();
