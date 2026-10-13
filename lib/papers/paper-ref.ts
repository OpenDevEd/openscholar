// A paper named by where it comes from (plans/evidence-library-sources): an OpenAlex work, a record
// of an Evidence Library, an item in Zotero, or a PDF someone uploaded. OpenAlex is one source among
// them; its ID and a DOI are cross-references that find the same paper across sources, never keys.
// `paperKey` is the one string form every index stores; nothing else builds or splits one.

export type PaperRef =
  | { source: "openalex"; work: string }
  | { source: "library"; libraryId: string; key: string }
  | { source: "zotero"; library: "user" | "group"; owner: string; key: string }
  | { source: "upload"; file: string };

export type PaperSource = PaperRef["source"];

export type CrossRefs = { openalexId?: string; doi?: string };

export function paperKey(ref: PaperRef): string {
  switch (ref.source) {
    case "openalex":
      return `openalex:${ref.work}`;
    case "library":
      return `library:${ref.libraryId}:${ref.key}`;
    case "zotero":
      return `zotero:${ref.library}:${ref.owner}:${ref.key}`;
    case "upload":
      return `upload:${ref.file}`;
  }
}

const WORK = /^W\d+$/;
// Library IDs and record keys, Zotero owners and keys, and storage IDs hold no colon.
const PART = /^[^:\s]+$/;

export function parsePaperKey(key: string): PaperRef | null {
  const [source, ...parts] = key.split(":");
  if (source === "openalex" && parts.length === 1 && WORK.test(parts[0]!)) return { source, work: parts[0]! };
  if (source === "library" && parts.length === 2 && parts.every((part) => PART.test(part))) return { source, libraryId: parts[0]!, key: parts[1]! };
  if (source === "zotero" && parts.length === 3 && (parts[0] === "user" || parts[0] === "group") && (parts[1] === "" || PART.test(parts[1]!)) && PART.test(parts[2]!)) {
    return { source, library: parts[0], owner: parts[1]!, key: parts[2]! };
  }
  if (source === "upload" && parts.length === 1 && PART.test(parts[0]!)) return { source, file: parts[0]! };
  return null;
}

/** The bare OpenAlex work (W2741809807) in its address, its page's address or the ID itself; null for anything else. */
export function openalexWork(id: string): string | null {
  return id.trim().match(/^(?:https?:\/\/openalex\.org\/(?:works\/)?)?(W\d+)$/i)?.[1]?.toUpperCase() ?? null;
}

/** A DOI in one form, lower case and without its address; null when there is none. */
export function normalDoi(doi: string | undefined | null): string | null {
  const bare = doi?.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "").replace(/^doi:/, "");
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
 * or a key already. Null for what can't be placed.
 */
export function legacyPaperRef(id: string, hints: { pdfUrl?: string } = {}): PaperRef | null {
  const keyed = parsePaperKey(id);
  if (keyed) return keyed;
  const work = openalexWork(id) ?? (id.startsWith("openalex:") ? openalexWork(id.slice("openalex:".length)) : null);
  if (work) return { source: "openalex", work };
  const zotero = id.match(/^zotero:(?:(user|group):)?([^:\s]+)$/);
  if (zotero) {
    const library = zotero[1] as "user" | "group" | undefined;
    const owned = zoteroOwner(hints.pdfUrl, library);
    return { source: "zotero", library: owned?.library ?? library ?? "user", owner: owned?.owner ?? "", key: zotero[2]! };
  }
  return null;
}

/** What finds the same paper elsewhere: an OpenAlex paper carries its own work; IDs and DOIs in one form; nothing that isn't one. */
export function crossRefsOf(ref: PaperRef, given: { openalexId?: string | null; doi?: string | null } = {}): CrossRefs {
  const openalexId = ref.source === "openalex" ? ref.work : given.openalexId ? openalexWork(given.openalexId) : null;
  const doi = normalDoi(given.doi);
  return { ...(openalexId ? { openalexId } : {}), ...(doi ? { doi } : {}) };
}
