/** How a saved paper is named to an Evidence Library, which looks papers up on OpenAlex. */
import { shortWorkId } from "../openalex/work-id";

/** "https://openalex.org/W123" or "W123" as "W123"; anything else is not an OpenAlex work. */
function openAlexWorkId(value: string) {
  return /(?:^|\/)(W\d+)$/u.exec(value.trim())?.[1] ?? null;
}

/**
 * The OpenAlex id a stored work names in its `ids`, as the OpenScholar API gives one for its OS
 * works: a W id, bare or on openalex.org only, since one on another site could name another paper.
 */
function storedOpenAlexId(paperData: string | undefined): string | null {
  try {
    const ids = (JSON.parse(paperData ?? "null") as { ids?: { openalex?: unknown } } | null)?.ids;
    const short = typeof ids?.openalex === "string" ? shortWorkId(ids.openalex) : null;
    return short?.startsWith("W") ? short : null;
  } catch {
    return null;
  }
}

/**
 * The OpenAlex id the library can look a saved paper up by: its own, or for a paper from the
 * OpenScholar API, whose id is OS…, the OpenAlex id its stored work names. The library asks
 * OpenAlex, so an OS id is never handed on; a paper with neither goes by its DOI.
 */
export function lookupOpenAlexId(item: { openalexId: string; paperData?: string }) {
  return openAlexWorkId(item.openalexId) ?? storedOpenAlexId(item.paperData);
}
