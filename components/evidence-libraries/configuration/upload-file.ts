/**
 * Upload adapter for the configuration page.
 *
 * Two platform calls (plan 03, `convex/evidenceLibraries/uploads.ts` and
 * `uploadActions.ts`): get a temporary upload URL, POST the file to it, then
 * run the `upload` action that checks the file, stores it in the platform
 * bucket and returns its public URL. Replaced files are deleted by the page
 * after a successful Save (`staleUploads` in rules.ts).
 */

import { ConvexError } from "convex/values";
import type { Id } from "@/convex/_generated/dataModel";
import {
  checkEvidenceLibraryUpload,
  type EvidenceLibraryUploadKind,
} from "@/lib/evidence-libraries/configuration/uploads";

export type UploadKind = EvidenceLibraryUploadKind;
export type UploadError = "type" | "size" | "failed";

export type UploadActionResult =
  | { kind: "file"; bytes: number; contentType: string; name: string; url: string }
  | { kind: "text"; bytes: number; name: string; text: string };

export type UploadResult =
  | { ok: true; kind: "file"; url: string; name: string }
  | { ok: true; kind: "text"; text: string; name: string }
  | { ok: false; error: UploadError };

/** Returns why a file is not allowed before it leaves the browser, or null when it is fine. Same rule as the platform. */
export function checkUploadFile(
  kind: UploadKind,
  file: { name: string; size: number },
): Exclude<UploadError, "failed"> | null {
  const check = checkEvidenceLibraryUpload({ kind, name: file.name, bytes: file.size });
  return check.ok ? null : check.reason;
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
