import { CITATION_FILES, type CitationFile } from "@/lib/citations/formats";
import { legacyPaperRef } from "./paper-ref";

/** A paper page's ID: one of our index (OS…), an OpenAlex work (W…), which redirects to ours, or a report (R…, MOCK). */
const PAGE_ID = /^(OS|W|R)(\d+)$/i;

/** The bare ID a paper page takes, upper-cased, or null for anything else. */
export function paperPageId(raw: string): string | null {
  const match = PAGE_ID.exec(raw.trim().split("/").at(-1) ?? "");
  return match ? `${match[1]!.toUpperCase()}${match[2]}` : null;
}

/** The words of a title as they read in an address: letters and digits of any script, joined by dashes, cut at a word. */
export function paperSlug(title: string | null | undefined): string {
  const words = (title ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
  let slug = "";
  for (const word of words) {
    if (slug && slug.length + word.length + 1 > 80) break;
    slug = slug ? `${slug}-${word}` : word.slice(0, 80);
  }
  return slug;
}

/** A paper page's own address: its ID, then its title's words when it has any, percent-encoded, as a redirect's header must carry them. */
export function paperPath(id: string, title: string | null | undefined): string {
  const slug = paperSlug(title);
  return slug ? `/papers/${id}/${encodeURIComponent(slug)}` : `/papers/${id}`;
}

/**
 * A search result's own page here, for a paper from OpenAlex or our index; null for one that lives elsewhere (a
 * community's record, Zotero, an upload). Named by our ID when the paper carries it, so the link needs no redirect.
 */
export function ourPaperPage(paper: { id: string; title?: string | null; display_name?: string | null; openscholar_id?: string }): string | null {
  const ref = legacyPaperRef(paper.id);
  if (ref?.source !== "openalex" && ref?.source !== "openscholar") return null;
  return paperPath(paper.openscholar_id?.split("/").at(-1) ?? ref.work, paper.title ?? paper.display_name);
}

/** Where a paper's citation file is served: beside its page, named by its kind. */
export const citeFilePath = (id: string, kind: CitationFile) => `/papers/${id}/cite.${CITATION_FILES[kind].extension}`;
