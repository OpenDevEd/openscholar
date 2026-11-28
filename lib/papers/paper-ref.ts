// A paper named by where it comes from (plans/evidence-library-sources): an OpenAlex work, a record
// of an Evidence Library, an item in Zotero, a PDF someone uploaded, or a report published on Openscholar. OpenAlex is one source among
// them; its ID and a DOI are cross-references that find the same paper across sources, never keys.
// `paperKey` is the one string form every index stores; nothing else builds or splits one.

export type PaperRef =
  | { source: "openalex"; work: string }
  | { source: "openscholar"; work: string }
  | { source: "library"; libraryId: string; key: string }
  | { source: "zotero"; library: "user" | "group"; owner: string; key: string }
  | { source: "upload"; file: string }
  | { source: "report"; key: string };

export type PaperSource = PaperRef["source"];

export type CrossRefs = { openalexId?: string; doi?: string };

export function paperKey(ref: PaperRef): string {
  switch (ref.source) {
    case "openalex":
      return `openalex:${ref.work}`;
    case "openscholar":
      return `openscholar:${ref.work}`;
    case "library":
      return `library:${ref.libraryId}:${ref.key}`;
    case "zotero":
      return `zotero:${ref.library}:${ref.owner}:${ref.key}`;
    case "upload":
      return `upload:${ref.file}`;
    case "report":
      return `report:${ref.key}`;
  }
}

const WORK = /^W\d+$/;
const OWN_WORK = /^OS\d+$/;
const REPORT = /^R\d{6,}$/;
// Library IDs and record keys, Zotero owners and keys, and storage IDs hold no colon.
const PART = /^[^:\s]+$/;

export function parsePaperKey(key: string): PaperRef | null {
  const [source, ...parts] = key.split(":");
  if (source === "openalex" && parts.length === 1 && WORK.test(parts[0]!)) return { source, work: parts[0]! };
  if (source === "openscholar" && parts.length === 1 && OWN_WORK.test(parts[0]!)) return { source, work: parts[0]! };
  if (source === "library" && parts.length === 2 && parts.every((part) => PART.test(part))) return { source, libraryId: parts[0]!, key: parts[1]! };
  if (source === "zotero" && parts.length === 3 && (parts[0] === "user" || parts[0] === "group") && PART.test(parts[1]!) && PART.test(parts[2]!)) {
    return { source, library: parts[0], owner: parts[1]!, key: parts[2]! };
  }
  if (source === "upload" && parts.length === 1 && PART.test(parts[0]!)) return { source, file: parts[0]! };
  if (source === "report" && parts.length === 1 && REPORT.test(parts[0]!)) return { source, key: parts[0]! };
  return null;
}

/** The bare OpenAlex work (W2741809807) in its address, its page's address or the ID itself; null for anything else. */
export function openalexWork(id: string): string | null {
  return id.trim().match(/^(?:https?:\/\/openalex\.org\/(?:works\/)?)?(W\d+)$/i)?.[1]?.toUpperCase() ?? null;
}

/** The bare work on our index (OS79563844) in its address, or the ID itself; null for anything else. A paper only our index has goes by this. */
export function ownWork(id: string): string | null {
  return id.trim().match(/^(?:https?:\/\/openscholar\.ai\/)?(OS\d+)$/i)?.[1]?.toUpperCase() ?? null;
}

/** The bare key of a report published on Openscholar (R100001) in its address, or the key itself; null for anything else. */
export function reportKey(id: string): string | null {
  return id.trim().match(/^(?:https?:\/\/openscholar\.ai\/)?(R\d{6,})$/i)?.[1]?.toUpperCase() ?? null;
}

/** A DOI in one form, lower case and without its address; null when there is none. */
export function normalDoi(doi: string | undefined | null): string | null {
  const bare = doi?.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "").replace(/^doi:/, "").trim();
  return bare || null;
}

/** The owner a Zotero item's `zotero://select/...` address names. */
function zoteroOwner(pdfUrl: string | undefined, library?: "user" | "group") {
  const found = pdfUrl?.match(/^zotero:\/\/select\/(users|groups)\/([^/]+)\/items\//);
  if (!found) return undefined;
  const named = found[1] === "groups" ? "group" : "user";
  return library === undefined || library === named ? { library: named as "user" | "group", owner: found[2]! } : undefined;
}

/**
 * The paper an ID stored before keys names: an OpenAlex ID in any form; `zotero:group:KEY`,
 * `zotero:user:KEY` or `zotero:KEY`, whose owner the item's PDF address gives; `upload:<storage ID>`;
 * or a key already. Null for what can't be placed, a Zotero item whose owner nothing names too:
 * item keys are only unique within their library.
 */
export function legacyPaperRef(id: string, hints: { pdfUrl?: string } = {}): PaperRef | null {
  const keyed = parsePaperKey(id);
  if (keyed) return keyed;
  const work = openalexWork(id) ?? (id.startsWith("openalex:") ? openalexWork(id.slice("openalex:".length)) : null);
  if (work) return { source: "openalex", work };
  const own = ownWork(id);
  if (own) return { source: "openscholar", work: own };
  const report = reportKey(id);
  if (report) return { source: "report", key: report };
  const zotero = id.match(/^zotero:(?:(user|group):)?([^:\s]+)$/);
  if (zotero) {
    const library = zotero[1] as "user" | "group" | undefined;
    const owned = zoteroOwner(hints.pdfUrl, library);
    return owned ? { source: "zotero", library: owned.library, owner: owned.owner, key: zotero[2]! } : null;
  }
  return null;
}

/** The key of a paper named by its key or by an ID stored before keys (with what else it was kept with, `legacyPaperRef`); null when it names none. */
export function toPaperKey(id: string, hints: { pdfUrl?: string } = {}): string | null {
  const ref = legacyPaperRef(id, hints);
  return ref ? paperKey(ref) : null;
}

/**
 * The ID pages and a screening's answers name a paper by: an OpenAlex paper's address, as OpenAlex gives it and its
 * search results carry it, and any other paper's key.
 */
export function paperIdOf(key: string): string {
  const ref = parsePaperKey(key);
  if (ref?.source === "openalex") return `https://openalex.org/${ref.work}`;
  if (ref?.source === "report") return `https://openscholar.ai/${ref.key}`;
  return ref?.source === "openscholar" ? `https://openscholar.ai/${ref.work}` : key;
}

/** Whether a paper can be saved to a library: any but an uploaded PDF, whose file stays with its job. */
export const saveablePaper = (paper: string) => {
  const ref = legacyPaperRef(paper);
  return ref !== null && ref.source !== "upload";
};

/**
 * Where a paper opens, by its source: its OpenAlex page, a library record's page on its library at `libraryAddress`,
 * the item in Zotero, or an uploaded PDF's `file` where the page has it. Null for one with nowhere to open.
 */
export function paperPage(paper: string, { file, libraryAddress }: { file?: string | null; libraryAddress?: string | null } = {}): string | null {
  const ref = legacyPaperRef(paper);
  if (ref?.source === "openalex") return `https://openalex.org/${ref.work}`;
  if (ref?.source === "library") return libraryAddress ? new URL(`/lib/${encodeURIComponent(ref.key)}`, libraryAddress).href : null;
  if (ref?.source === "zotero") return `zotero://select/${ref.library === "group" ? "groups" : "users"}/${ref.owner}/items/${ref.key}`;
  if (ref?.source === "upload") return file ?? null;
  return null;
}

/** The Evidence Library a paper is a record of, if it is one. */
export function libraryOfPaper(paper: string): string | null {
  const ref = legacyPaperRef(paper);
  return ref?.source === "library" ? ref.libraryId : null;
}

/** The OpenAlex work a paper is or is known as, from its key or ID and its cross-references. */
export function openalexWorkOf(paper: string, crossRefs?: CrossRefs): string | null {
  const ref = legacyPaperRef(paper);
  if (ref?.source === "openalex") return ref.work;
  return crossRefs?.openalexId ? openalexWork(crossRefs.openalexId) : null;
}

/** The ID a stored paper goes by on pages and in a screening's answers (`paperIdOf` its key). */
export const pageIdOf = (row: { paperKey: string }) => paperIdOf(row.paperKey);

/** The OpenAlex work a stored paper is or is known as. */
export const openalexWorkOfRow = (row: { paperKey: string; crossRefs?: CrossRefs }) => openalexWorkOf(row.paperKey, row.crossRefs);

/** An OpenAlex work's address, as OpenAlex and exports name it. */
export const openalexAddress = (work: string | null) => (work ? `https://openalex.org/${work}` : null);

/** What finds the same paper elsewhere: an OpenAlex paper carries its own work; IDs and DOIs in one form; nothing that isn't one. */
export function crossRefsOf(ref: PaperRef, given: { openalexId?: string | null; doi?: string | null } = {}): CrossRefs {
  const openalexId = ref.source === "openalex" ? ref.work : given.openalexId ? openalexWork(given.openalexId) : null;
  const doi = normalDoi(given.doi);
  return { ...(openalexId ? { openalexId } : {}), ...(doi ? { doi } : {}) };
}

/**
 * A title as two sources of one paper would both give it: its letters and digits, in lower case, without the accents
 * Latin, Greek and Cyrillic letters take ("é" is "e"). The marks of other scripts are letters' own: a Devanagari vowel
 * sign or a Japanese voicing mark makes another word ("कल" and "काल", "カ" and "ガ"), so they stay.
 */
export const plainTitle = (title: string) => title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").normalize("NFC").replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
/** Whether two titles name one paper: one holds the other, a subtitle or not, and neither is too short to tell. */
export function sameTitle(one: string, other: string) {
  const [a, b] = [plainTitle(one), plainTitle(other)];
  return a.length > 12 && b.length > 12 && (a.includes(b) || b.includes(a));
}
