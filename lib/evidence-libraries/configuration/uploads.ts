/**
 * Rules for owner uploads (logos, favicon, share image, legal text).
 *
 * Files live in one public platform bucket under
 * `evidence-libraries/<libraryId>/<kind>-<hash8>.<ext>`. The browser and the
 * Convex action both use these helpers so they agree on what is accepted.
 */

export const EVIDENCE_LIBRARY_UPLOAD_BUCKET = "openscholar";

export const EVIDENCE_LIBRARY_UPLOAD_KINDS = [
  "image",
  "shareImage",
  "legal",
] as const;

export type EvidenceLibraryUploadKind =
  (typeof EVIDENCE_LIBRARY_UPLOAD_KINDS)[number];

export const EVIDENCE_LIBRARY_UPLOAD_LIMITS: Record<
  EvidenceLibraryUploadKind,
  number
> = {
  image: 1 * 1024 * 1024,
  shareImage: 2 * 1024 * 1024,
  legal: 200 * 1024,
};

type AcceptedType = { extension: string; contentType: string };

const ACCEPTED_TYPES: Record<EvidenceLibraryUploadKind, AcceptedType[]> = {
  image: [
    { extension: "svg", contentType: "image/svg+xml" },
    { extension: "png", contentType: "image/png" },
    { extension: "webp", contentType: "image/webp" },
  ],
  shareImage: [
    { extension: "png", contentType: "image/png" },
    { extension: "jpg", contentType: "image/jpeg" },
    { extension: "webp", contentType: "image/webp" },
  ],
  legal: [
    { extension: "md", contentType: "text/markdown" },
    { extension: "txt", contentType: "text/plain" },
  ],
};

/** File name endings that map to a canonical extension. */
const EXTENSION_ALIASES: Record<string, string> = {
  jpeg: "jpg",
  markdown: "md",
};

/** Browser `accept` values per kind, for the upload field. */
export const EVIDENCE_LIBRARY_UPLOAD_ACCEPT: Record<
  EvidenceLibraryUploadKind,
  Record<string, string[]>
> = {
  image: {
    "image/svg+xml": [".svg"],
    "image/png": [".png"],
    "image/webp": [".webp"],
  },
  shareImage: {
    "image/png": [".png"],
    "image/jpeg": [".jpg", ".jpeg"],
    "image/webp": [".webp"],
  },
  legal: {
    "text/markdown": [".md", ".markdown"],
    "text/plain": [".txt"],
  },
};

export type EvidenceLibraryUploadCheck =
  | { ok: true; extension: string; contentType: string }
  | { ok: false; reason: "type" | "size" };

function extensionFromName(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const raw = name.slice(dot + 1).toLowerCase();
  return EXTENSION_ALIASES[raw] ?? raw;
}

export function checkEvidenceLibraryUpload(input: {
  kind: EvidenceLibraryUploadKind;
  name: string;
  bytes: number;
}): EvidenceLibraryUploadCheck {
  const extension = extensionFromName(input.name);
  const accepted = extension
    ? ACCEPTED_TYPES[input.kind].find((type) => type.extension === extension)
    : undefined;
  if (!accepted) return { ok: false, reason: "type" };
  if (
    !Number.isSafeInteger(input.bytes) ||
    input.bytes <= 0 ||
    input.bytes > EVIDENCE_LIBRARY_UPLOAD_LIMITS[input.kind]
  ) {
    return { ok: false, reason: "size" };
  }
  return {
    ok: true,
    extension: accepted.extension,
    contentType: accepted.contentType,
  };
}

export function evidenceLibraryUploadPrefix(libraryId: string): string {
  return `evidence-libraries/${libraryId}/`;
}

export function createEvidenceLibraryUploadKey(input: {
  libraryId: string;
  kind: EvidenceLibraryUploadKind;
  contentHashHex: string;
  extension: string;
}): string {
  return `${evidenceLibraryUploadPrefix(input.libraryId)}${input.kind}-${input.contentHashHex.slice(0, 8)}.${input.extension}`;
}

function publicObjectPathPrefix(): string {
  return `/storage/v1/object/public/${EVIDENCE_LIBRARY_UPLOAD_BUCKET}/`;
}

export function evidenceLibraryUploadUrl(input: {
  storageOrigin: string;
  key: string;
}): string {
  return `${new URL(input.storageOrigin).origin}${publicObjectPathPrefix()}${input.key}`;
}

/**
 * Returns the object key when `url` is a public file inside this library's
 * prefix in the platform bucket. Returns `null` for anything else.
 */
export function parseOwnedEvidenceLibraryUploadUrl(input: {
  storageOrigin: string;
  libraryId: string;
  url: string;
}): string | null {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return null;
  }
  if (url.origin !== new URL(input.storageOrigin).origin) return null;
  if (url.search || url.hash) return null;
  const pathPrefix = publicObjectPathPrefix();
  if (!url.pathname.startsWith(pathPrefix)) return null;
  const key = url.pathname.slice(pathPrefix.length);
  const ownedPrefix = evidenceLibraryUploadPrefix(input.libraryId);
  if (!key.startsWith(ownedPrefix)) return null;
  const fileName = key.slice(ownedPrefix.length);
  if (!fileName || fileName.includes("/") || fileName.includes("..")) {
    return null;
  }
  return key;
}
