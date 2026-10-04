import { MAX_AUTHORS } from "../../convex/lib/listCaps";
import { trimPaperData } from "./trim-paper-data";

/** Source metadata shared by saved papers and their research inputs. */
export type PaperSourceMetadata = {
  authorsUnparsed?: string;
  workType?: string;
  isOpenAccess?: boolean;
  oaStatus?: string;
  oaUrl?: string;
  pdfUrl?: string;
};

export function sourceMetadata(paper: PaperSourceMetadata): PaperSourceMetadata {
  return { authorsUnparsed: paper.authorsUnparsed, workType: paper.workType, isOpenAccess: paper.isOpenAccess, oaStatus: paper.oaStatus, oaUrl: paper.oaUrl, pdfUrl: paper.pdfUrl };
}

export type PaperMetadata = PaperSourceMetadata & {
  title: string;
  authors?: string[];
  doi?: string;
  abstract?: string;
  publicationYear?: number;
  journal?: string;
  citedByCount?: number;
  paperData?: string;
};

export function paperRecord(raw?: string): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Project only known source facts from the retained OpenAlex snapshot. */
export function metadataFromPaperData(raw?: string): Partial<PaperMetadata> {
  const record = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};
  const text = (value: unknown) => typeof value === "string" ? value : undefined;
  const work = paperRecord(raw) ?? {};
  const location = record(work.primary_location);
  const access = record(work.open_access);
  const projected = trimPaperData({
    id: "",
    primary_location: { source: { display_name: text(record(location.source).display_name) }, pdf_url: text(location.pdf_url) },
    best_oa_location: { pdf_url: text(record(work.best_oa_location).pdf_url) },
    open_access: { is_oa: typeof access.is_oa === "boolean" ? access.is_oa : undefined, oa_status: text(access.oa_status), oa_url: text(access.oa_url) },
    type: text(work.type),
    cited_by_count: typeof work.cited_by_count === "number" && Number.isFinite(work.cited_by_count) ? work.cited_by_count : undefined,
  });
  return { ...sourceMetadata(projected), journal: projected.journal, citedByCount: projected.citedByCount };
}

/** Old text is recoverable only when retained names reproduce it exactly. */
export function authorMetadata(paper: Pick<PaperMetadata, "authors" | "authorsUnparsed" | "paperData">): { authors?: string[]; authorsUnparsed?: string } {
  if (paper.authors?.length) return {
    authors: paper.authors,
    ...(paper.authorsUnparsed && paper.authorsUnparsed !== paper.authors.join(", ") ? { authorsUnparsed: paper.authorsUnparsed } : {}),
  };
  const text = paper.authorsUnparsed;
  const raw = paperRecord(paper.paperData)?.authorships;
  const names = Array.isArray(raw) ? raw.flatMap((entry) => isRecord(entry) && isRecord(entry.author) && typeof entry.author.display_name === "string" && entry.author.display_name.trim() ? [entry.author.display_name] : []) : [];
  if (names.length && (!text || names.join(", ") === text)) return names.length <= MAX_AUTHORS ? { authors: names } : { authorsUnparsed: text || names.join(", ") };
  return text ? { authorsUnparsed: text } : {};
}

export function authorDisplay(paper: Pick<PaperMetadata, "authors" | "authorsUnparsed" | "paperData">): string {
  const value = authorMetadata(paper);
  return value.authors?.join(", ") || value.authorsUnparsed || "";
}

const present = (value: unknown) => value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);

function fillRecord(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const result = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (!present(result[key])) result[key] = value;
    else if (isRecord(result[key]) && isRecord(value)) result[key] = fillRecord(result[key], value);
  }
  return result;
}

/** Fill missing source facts; zero, false and saved text are meaningful values. */
export function mergePaperMetadata(existing: PaperMetadata, incoming: PaperMetadata): PaperMetadata {
  const retainedNames = authorMetadata(existing);
  const retained = fillRecord({ ...existing, ...retainedNames, authors: retainedNames.authors }, metadataFromPaperData(existing.paperData));
  const supplied = fillRecord(incoming, metadataFromPaperData(incoming.paperData));
  const merged = fillRecord(retained, supplied) as PaperMetadata;
  const before = paperRecord(existing.paperData);
  const added = paperRecord(incoming.paperData);
  if (before || added) merged.paperData = JSON.stringify(before && added ? fillRecord(before, added) : before ?? added);
  const names = authorMetadata(merged);
  merged.authors = names.authors;
  merged.authorsUnparsed = names.authorsUnparsed;
  return merged;
}
