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

export type EvidenceLibraryUploadContent =
  | "png"
  | "jpg"
  | "webp"
  | "svg"
  | "text";

function startsWithBytes(content: Uint8Array, prefix: number[], at = 0) {
  if (content.length < at + prefix.length) return false;
  return prefix.every((byte, index) => content[at + index] === byte);
}

function decodeText(content: Uint8Array): string | null {
  if (content.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return null;
  }
}

/** Strips the XML declaration, comments, doctype and processing instructions. */
function stripXmlProlog(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .trim();
}

/**
 * A safe SVG: the root element is `<svg>` (any namespace prefix), no
 * `<script>` elements, no event attributes, no `javascript:` links.
 */
function isSafeSvg(text: string): boolean {
  const body = stripXmlProlog(text);
  if (!/^<(?:[A-Za-z_][\w.-]*:)?svg[\s/>]/.test(body)) return false;
  if (/<\/?(?:[A-Za-z_][\w.-]*:)?script[\s/>]/i.test(body)) return false;
  if (/\son[a-z]+\s*=/i.test(body)) return false;
  if (/(?:href|xlink:href)\s*=\s*["']?\s*javascript:/i.test(body)) return false;
  return true;
}

/** Reads the real type from the bytes, not the file name. */
export function detectEvidenceLibraryUploadContent(
  content: Uint8Array,
): EvidenceLibraryUploadContent | null {
  if (startsWithBytes(content, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }
  if (startsWithBytes(content, [0xff, 0xd8, 0xff])) return "jpg";
  if (
    startsWithBytes(content, [0x52, 0x49, 0x46, 0x46]) &&
    startsWithBytes(content, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "webp";
  }
  const text = decodeText(content);
  if (text === null) return null;
  return isSafeSvg(text) ? "svg" : "text";
}

const CONTENT_FOR_EXTENSION: Record<string, EvidenceLibraryUploadContent> = {
  png: "png",
  jpg: "jpg",
  webp: "webp",
  svg: "svg",
  md: "text",
  txt: "text",
};

/**
 * Full check for the server: name and size rules, then the bytes must be
 * what the name says they are.
 */
export function checkEvidenceLibraryUploadContent(input: {
  kind: EvidenceLibraryUploadKind;
  name: string;
  content: Uint8Array;
}): EvidenceLibraryUploadCheck {
  const check = checkEvidenceLibraryUpload({
    kind: input.kind,
    name: input.name,
    bytes: input.content.byteLength,
  });
  if (!check.ok) return check;
  const detected = detectEvidenceLibraryUploadContent(input.content);
  if (detected === null || detected !== CONTENT_FOR_EXTENSION[check.extension]) {
    return { ok: false, reason: "type" };
  }
  return check;
}
