import { normalDoi, openalexWork, ownWork } from "./paper-ref";

/**
 * A paper as someone names it by pasting where they found it: an OpenAlex work, a DOI, a paper only our index has
 * (`own`, an OS ID), or a record on an Evidence Community's site. Openscholar's own paper pages, on any of its
 * addresses, name the work in their path; a community's record page is `/lib/<record key>` on its address.
 */
export type PaperLink =
  | { kind: "work"; openalexId: string }
  | { kind: "doi"; doi: string }
  | { kind: "own"; work: string }
  | { kind: "record"; origin: string; itemKey: string };

/** Openscholar's addresses: openscholar.ai and every name under it (dev., discover.). */
const OURS = /(^|\.)openscholar\.ai$/i;
/** A paper page's path, in a workspace's address or not: /papers/W123/its-title or /o/team/papers/OS456. */
const PAPER_PATH = /^(?:\/o\/[^/]+)?\/papers\/((?:W|OS)\d+)(?:\/|$)/i;
/** A community's record page: /lib/ABCD2345, as new-el keys its records. */
const RECORD_PATH = /^\/lib\/([A-Z0-9]{8})(?:\/|$)/;

/** A DOI without what a sentence or list put after it: a comma, a full stop, an unopened bracket. */
function trimDoi(doi: string): string {
  let trimmed = doi.replace(/[,;.]+$/, "");
  while (trimmed.endsWith(")") && (trimmed.match(/\(/g)?.length ?? 0) < (trimmed.match(/\)/g)?.length ?? 0)) trimmed = trimmed.slice(0, -1);
  return trimmed;
}

function urlOf(given: string) {
  try {
    return new URL(given);
  } catch {
    return null;
  }
}

/** The paper a web address names: one of Openscholar's paper pages, or a community's record page. */
function paperAt(given: string): PaperLink | null {
  const url = urlOf(given);
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
  const page = OURS.test(url.hostname) ? url.pathname.match(PAPER_PATH)?.[1]?.toUpperCase() : undefined;
  if (page) return page.startsWith("W") ? { kind: "work", openalexId: page } : { kind: "own", work: page };
  const record = url.pathname.match(RECORD_PATH)?.[1];
  return record ? { kind: "record", origin: url.origin, itemKey: record } : null;
}

/** The paper one pasted word names, or null for anything else. */
export function paperLinkOf(raw: string): PaperLink | null {
  // What a sentence or list wraps an address in: brackets, quotes, and punctuation after it. A DOI keeps its own brackets (trimDoi).
  const given = raw.trim().replace(/^[<(["']+/, "").replace(/[>)\]"'.,;:!?]+$/, "");
  const work = openalexWork(given);
  if (work) return { kind: "work", openalexId: work };
  const own = ownWork(given.replace(/^openscholar:/i, ""));
  if (own) return { kind: "own", work: own };
  const address = paperAt(given);
  if (address) return address;
  // Angle brackets and quotes never belong to a DOI; its own round brackets stay for trimDoi to weigh.
  const doi = raw.trim().replace(/^[<"']+/, "").replace(/[>"']+[.,;:!?]*$/, "").match(/10\.\d{4,9}\/\S+/i)?.[0];
  return doi ? { kind: "doi", doi: normalDoi(trimDoi(doi))! } : null;
}

/** One key per paper a link names, so the same one pasted twice is looked up once. */
export function paperLinkKey(link: PaperLink): string {
  switch (link.kind) {
    case "work":
      return link.openalexId;
    case "doi":
      return `doi:${link.doi}`;
    case "own":
      return `own:${link.work}`;
    case "record":
      return `record:${link.origin}/${link.itemKey}`;
  }
}
