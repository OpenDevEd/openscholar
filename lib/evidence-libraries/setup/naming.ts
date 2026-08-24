export const EVIDENCE_LIBRARY_PLATFORM_DOMAIN = "openscholar.ai";

const MAX_SHORT_NAME_LENGTH = 40;
const MAX_PLATFORM_SLUG_LENGTH = 59;

export function normalizeEvidenceLibraryName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function createInitialEvidenceLibraryShortName(name: string): string {
  const normalized = normalizeEvidenceLibraryName(name);
  const characters = Array.from(normalized);
  if (characters.length <= MAX_SHORT_NAME_LENGTH) return normalized;

  const prefix = characters.slice(0, MAX_SHORT_NAME_LENGTH).join("").trimEnd();
  const lastSpace = prefix.lastIndexOf(" ");
  return lastSpace > 0 ? prefix.slice(0, lastSpace) : prefix;
}

export function createEvidenceLibraryBaseSlug(name: string): string {
  const slug = normalizeEvidenceLibraryName(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_PLATFORM_SLUG_LENGTH)
    .replace(/-+$/g, "");

  return slug || "library";
}

export function createEvidenceLibrarySlugCandidate(
  baseSlug: string,
  position: number,
): string {
  if (!Number.isSafeInteger(position) || position < 1) {
    throw new RangeError("Library address position must be a positive integer");
  }

  const suffix = position === 1 ? "" : `-${position}`;
  const normalizedBase = createEvidenceLibraryBaseSlug(baseSlug);
  const stem = normalizedBase
    .slice(0, MAX_PLATFORM_SLUG_LENGTH - suffix.length)
    .replace(/-+$/g, "");
  return `${stem}${suffix}`;
}

export function createEvidenceLibraryPublicAddress(slug: string): string {
  return `https://${slug}-lib.${EVIDENCE_LIBRARY_PLATFORM_DOMAIN}`;
}
