export const EVIDENCE_LIBRARY_PLATFORM_DOMAIN_ENV =
  "EVIDENCE_LIBRARY_PLATFORM_DOMAIN";
export const MAX_EVIDENCE_LIBRARY_NAME_LENGTH = 100;
export const MAX_EVIDENCE_LIBRARY_SHORT_NAME_LENGTH = 40;
export const MAX_EVIDENCE_LIBRARY_SLUG_LENGTH = 59;
export const MAX_EVIDENCE_LIBRARY_ADDRESS_CANDIDATES = 100;

const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EVIDENCE_LIBRARY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateEvidenceLibraryPlatformDomain(
  value: string | undefined,
): string {
  const domain = value?.trim().toLowerCase();
  if (!domain) {
    throw new Error(`${EVIDENCE_LIBRARY_PLATFORM_DOMAIN_ENV} is required`);
  }

  const labels = domain.split(".");
  if (
    domain.length > 253 ||
    labels.length < 2 ||
    labels.some((label) => !DNS_LABEL_PATTERN.test(label)) ||
    !/[a-z]/.test(labels.at(-1) ?? "")
  ) {
    throw new Error(
      `${EVIDENCE_LIBRARY_PLATFORM_DOMAIN_ENV} must be a DNS hostname without a scheme, port, path, wildcard, or trailing dot`,
    );
  }

  return domain;
}

export function normalizeEvidenceLibraryName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function createInitialEvidenceLibraryShortName(name: string): string {
  const normalized = normalizeEvidenceLibraryName(name);
  const characters = Array.from(normalized);
  if (characters.length <= MAX_EVIDENCE_LIBRARY_SHORT_NAME_LENGTH) {
    return normalized;
  }

  const prefix = characters
    .slice(0, MAX_EVIDENCE_LIBRARY_SHORT_NAME_LENGTH)
    .join("")
    .trimEnd();
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
    .slice(0, MAX_EVIDENCE_LIBRARY_SLUG_LENGTH)
    .replace(/-+$/g, "");

  return slug || "library";
}

export function createEvidenceLibrarySlugCandidate(
  baseSlug: string,
  position: number,
): string {
  if (
    !Number.isSafeInteger(position) ||
    position < 1 ||
    position > MAX_EVIDENCE_LIBRARY_ADDRESS_CANDIDATES
  ) {
    throw new RangeError("Library address position must be between 1 and 100");
  }

  const suffix = position === 1 ? "" : `-${position}`;
  const normalizedBase = createEvidenceLibraryBaseSlug(baseSlug);
  const stem = normalizedBase
    .slice(0, MAX_EVIDENCE_LIBRARY_SLUG_LENGTH - suffix.length)
    .replace(/-+$/g, "");
  return `${stem}${suffix}`;
}

export function createEvidenceLibraryPublicAddress(
  slug: string,
  platformDomain: string,
): string {
  if (
    slug.length > MAX_EVIDENCE_LIBRARY_SLUG_LENGTH ||
    !EVIDENCE_LIBRARY_SLUG_PATTERN.test(slug)
  ) {
    throw new RangeError("Evidence Library slug is not a valid DNS label");
  }
  const hostname = `${slug}-lib.${validateEvidenceLibraryPlatformDomain(platformDomain)}`;
  if (hostname.length > 253) {
    throw new RangeError(
      "Evidence Library hostname must not exceed 253 characters",
    );
  }
  return `https://${hostname}`;
}

// The address a name gets at a given position. Position 1 has no number
// suffix. The server walks positions until it finds one nothing else holds.
export function createEvidenceLibraryAddressCandidate(
  name: string,
  platformDomain: string,
  position = 1,
): string {
  const slug = createEvidenceLibrarySlugCandidate(
    createEvidenceLibraryBaseSlug(name),
    position,
  );
  return createEvidenceLibraryPublicAddress(slug, platformDomain);
}
