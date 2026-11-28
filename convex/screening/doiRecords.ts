/**
 * What the two registries know of a DOI the index has no record of (plans/screening-reviewers): Crossref first, then
 * DataCite, which holds reports, datasets and theses. Of 1,000 DOIs from one Zotero library, OpenAlex knew 85% and
 * the three together 92.8%, and the share with an abstract rose from 73% to 80%. A DOI neither knows is one nothing
 * is known of.
 */
import type { FileRecord } from "../../lib/screening/files";
import { createError } from "../lib/errors";

/** DOIs asked of the registries at once, and how long one may take. */
const AT_ONCE = 16;
const WAIT_MS = 15_000;
const HEADERS = { Accept: "application/json", "User-Agent": "Openscholar (https://openscholar.ai)" };

/** A registry's abstract as plain text: Crossref sends JATS markup, with a heading that says "Abstract". */
const plain = (text: string | undefined) => text?.replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().replace(/^abstract[:.]?\s+/i, "") || undefined;
/**
 * A registry's answer, or null for a DOI it has no record of. One that didn't come, or came as a refusal other than "no
 * such DOI", is asked for once more, and then the reading stops with why: a busy registry is not a DOI nothing is
 * known of, and the source is read again once it answers.
 */
const read = async (url: string): Promise<unknown> => {
  for (let tries = 0; tries < 2; tries++) {
    const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(WAIT_MS) }).catch(() => null);
    if (response?.ok) return await response.json().catch(() => null);
    if (response?.status === 404) return null;
  }
  throw createError("EXTERNAL_SERVICE_ERROR", "Crossref or DataCite didn't answer. Read this source again in a few minutes.");
};

type Crossref = { message?: { title?: string[]; abstract?: string; author?: Array<{ given?: string; family?: string; name?: string }>; issued?: { "date-parts"?: number[][] }; "container-title"?: string[] } };
async function crossref(doi: string): Promise<FileRecord | null> {
  const work = ((await read(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)) as Crossref | null)?.message;
  const title = work?.title?.[0]?.trim();
  if (!work || !title) return null;
  const authors = (work.author ?? []).map((one) => [one.given, one.family].filter(Boolean).join(" ") || one.name || "").filter(Boolean);
  const [abstract, year, venue] = [plain(work.abstract), work.issued?.["date-parts"]?.[0]?.[0], work["container-title"]?.[0]];
  return { title: plain(title)!, doi, ...(abstract ? { abstract } : {}), ...(authors.length ? { authors } : {}), ...(year ? { publicationYear: year } : {}), ...(venue ? { venue } : {}) };
}

type DataCite = { data?: { attributes?: { titles?: Array<{ title?: string }>; descriptions?: Array<{ description?: string; descriptionType?: string }>; creators?: Array<{ name?: string; givenName?: string; familyName?: string }>; publicationYear?: number; publisher?: string | { name?: string } } } };
async function datacite(doi: string): Promise<FileRecord | null> {
  const record = ((await read(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`)) as DataCite | null)?.data?.attributes;
  const title = record?.titles?.[0]?.title?.trim();
  if (!record || !title) return null;
  const authors = (record.creators ?? []).map((one) => [one.givenName, one.familyName].filter(Boolean).join(" ") || one.name || "").filter(Boolean);
  const abstract = plain((record.descriptions?.find((one) => one.descriptionType === "Abstract") ?? record.descriptions?.[0])?.description);
  const venue = typeof record.publisher === "string" ? record.publisher : record.publisher?.name;
  return { title, doi, ...(abstract ? { abstract } : {}), ...(authors.length ? { authors } : {}), ...(record.publicationYear ? { publicationYear: record.publicationYear } : {}), ...(venue ? { venue } : {}) };
}

/** The records Crossref, then DataCite, hold for these DOIs, by DOI. A DOI neither holds isn't in what comes back. */
export async function registered(dois: string[], { strict = false }: { /** A registry that doesn't answer stops the reading, for a list of DOIs whose records these are. Looking up abstracts, it only finds none. */ strict?: boolean } = {}): Promise<Map<string, FileRecord>> {
  const found = new Map<string, FileRecord>();
  const look = async (doi: string) => (await crossref(doi)) ?? (await datacite(doi));
  for (let at = 0; at < dois.length; at += AT_ONCE) {
    const records = await Promise.all(dois.slice(at, at + AT_ONCE).map((doi) => (strict ? look(doi) : look(doi).catch(() => null))));
    records.forEach((record, i) => { if (record) found.set(dois[at + i]!, record); });
  }
  return found;
}
