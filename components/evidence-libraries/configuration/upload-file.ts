/**
 * Upload adapter for the configuration page.
 *
 * Three platform calls (plan 03, `convex/evidenceLibraries/uploads.ts` and
 * `uploadActions.ts`): get a temporary upload URL, POST the file to it, then
 * run the `upload` action that checks the file, stores it in the platform
 * bucket and returns its public URL. `remove` deletes a stored file.
 *
 * The references are typed by hand until plan 03 is on `dev`; swap them for
 * `api.evidenceLibraries.uploads.*` / `api.evidenceLibraries.uploadActions.*`
 * once the generated types include them.
 */

import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import type { Id } from "@/convex/_generated/dataModel";

export const FILE_LIMITS = {
  image: {
    accept: ["image/svg+xml", "image/png", "image/webp"],
    extensions: [".svg", ".png", ".webp"],
    maxBytes: 1024 * 1024,
  },
  shareImage: {
    accept: ["image/png", "image/jpeg", "image/webp"],
    extensions: [".png", ".jpg", ".jpeg", ".webp"],
    maxBytes: 2 * 1024 * 1024,
  },
  legal: {
    accept: ["text/markdown", "text/plain"],
    extensions: [".md", ".txt"],
    maxBytes: 200 * 1024,
  },
} as const;

export type UploadKind = keyof typeof FILE_LIMITS;
export type UploadError = "type" | "size" | "failed";

export type UploadActionResult =
  | { kind: "file"; bytes: number; contentType: string; name: string; url: string }
  | { kind: "text"; bytes: number; name: string; text: string };

export type UploadResult =
  | { ok: true; kind: "file"; url: string; name: string }
  | { ok: true; kind: "text"; text: string; name: string }
  | { ok: false; error: UploadError };

export const uploadFunctions = {
  generateUploadUrl: makeFunctionReference<
    "mutation",
    { libraryId: Id<"evidenceLibraries"> },
    string
  >("evidenceLibraries/uploads:generateUploadUrl"),
  upload: makeFunctionReference<
    "action",
    {
      libraryId: Id<"evidenceLibraries">;
      kind: UploadKind;
      name: string;
      storageId: Id<"_storage">;
    },
    UploadActionResult
  >("evidenceLibraries/uploadActions:upload"),
  remove: makeFunctionReference<
    "action",
    { libraryId: Id<"evidenceLibraries">; url: string },
    null
  >("evidenceLibraries/uploadActions:remove"),
};

/** Returns why a file is not allowed before it leaves the browser, or null when it is fine. */
export function checkUploadFile(
  kind: UploadKind,
  file: { name: string; type: string; size: number },
): Exclude<UploadError, "failed"> | null {
  const limit = FILE_LIMITS[kind];
  const lowerName = file.name.toLowerCase();
  const typeAllowed =
    (limit.accept as readonly string[]).includes(file.type) ||
    limit.extensions.some((extension) => lowerName.endsWith(extension));
  if (!typeAllowed) return "type";
  if (file.size > limit.maxBytes) return "size";
  return null;
}

/** The name shown for a stored file: the last path segment of its URL. */
export function fileNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? url);
  } catch {
    return url;
  }
}

export function uploadErrorFrom(error: unknown): UploadError {
  if (error instanceof ConvexError) {
    const reason = (error.data as { reason?: unknown })?.reason;
    if (reason === "type" || reason === "size") return reason;
  }
  return "failed";
}

export type UploadClient = {
  generateUploadUrl: (args: { libraryId: Id<"evidenceLibraries"> }) => Promise<string>;
  upload: (args: {
    libraryId: Id<"evidenceLibraries">;
    kind: UploadKind;
    name: string;
    storageId: Id<"_storage">;
  }) => Promise<UploadActionResult>;
  remove: (args: { libraryId: Id<"evidenceLibraries">; url: string }) => Promise<null>;
};

export async function uploadFile(
  client: UploadClient,
  libraryId: Id<"evidenceLibraries">,
  kind: UploadKind,
  file: File,
): Promise<UploadResult> {
  const early = checkUploadFile(kind, file);
  if (early) return { ok: false, error: early };
  try {
    const uploadUrl = await client.generateUploadUrl({ libraryId });
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: file.type ? { "Content-Type": file.type } : undefined,
      body: file,
    });
    if (!response.ok) return { ok: false, error: "failed" };
    const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
    const stored = await client.upload({ libraryId, kind, name: file.name, storageId });
    return stored.kind === "file"
      ? { ok: true, kind: "file", url: stored.url, name: stored.name }
      : { ok: true, kind: "text", text: stored.text, name: stored.name };
  } catch (error) {
    return { ok: false, error: uploadErrorFrom(error) };
  }
}
