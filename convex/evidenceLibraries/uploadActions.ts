"use node";

import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import {
  EVIDENCE_LIBRARY_UPLOAD_LIMITS,
  checkEvidenceLibraryUpload,
  parseOwnedEvidenceLibraryUploadUrl,
} from "../../lib/evidence-libraries/configuration/uploads";
import { requireRuntimeEnvironment } from "./runtimeActionConfig";
import { StorageSetupError } from "./storageSetupClient";
import {
  deleteLibraryUpload,
  ensureUploadBucket as ensurePlatformUploadBucket,
  storeLibraryUpload,
} from "./uploadsClient";

const uploadKindValidator = v.union(
  v.literal("image"),
  v.literal("shareImage"),
  v.literal("legal"),
);

const uploadResultValidator = v.union(
  v.object({
    kind: v.literal("file"),
    bytes: v.number(),
    contentType: v.string(),
    name: v.string(),
    url: v.string(),
  }),
  v.object({
    kind: v.literal("text"),
    bytes: v.number(),
    name: v.string(),
    text: v.string(),
  }),
);

type UploadResult =
  | { kind: "file"; bytes: number; contentType: string; name: string; url: string }
  | { kind: "text"; bytes: number; name: string; text: string };

function storageConfig() {
  const invalid = (message: string) => createError("INVALID_DATA", message);
  return {
    storageUrl: requireRuntimeEnvironment("EL_STORAGE_URL", invalid),
    serviceRoleKey: requireRuntimeEnvironment("EL_STORAGE_SERVICE_KEY", invalid),
  };
}

function rejectUpload(reason: "type" | "size", kind: "image" | "shareImage" | "legal"): never {
  const limitMb = EVIDENCE_LIBRARY_UPLOAD_LIMITS[kind] / (1024 * 1024);
  const limit = limitMb >= 1 ? `${limitMb} MB` : `${Math.round(limitMb * 1024)} KB`;
  throw createError(
    "VALIDATION_ERROR",
    reason === "type"
      ? "This file type is not accepted"
      : `This file is bigger than ${limit}`,
    { reason },
  );
}

function decodeLegalText(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw createError("VALIDATION_ERROR", "This file is not plain text", {
      reason: "type",
    });
  }
}

/**
 * Step two of an owner upload. Reads the temporary Convex file, checks it,
 * stores images in the platform bucket, and returns legal text as text.
 * The temporary file is deleted whatever the outcome.
 */
export const upload = action({
  args: {
    libraryId: v.id("evidenceLibraries"),
    kind: uploadKindValidator,
    name: v.string(),
    storageId: v.id("_storage"),
  },
  returns: uploadResultValidator,
  handler: async (ctx, args): Promise<UploadResult> => {
    await ctx.runQuery(internal.evidenceLibraries.uploads.requireUploadOwner, {
      libraryId: args.libraryId,
    });
    const name = args.name.trim();
    if (!name) rejectUpload("type", args.kind);
    let bytes: ArrayBuffer;
    try {
      const blob = await ctx.storage.get(args.storageId);
      if (!blob) throw createError("NOT_FOUND", "The uploaded file was not found");
      bytes = await blob.arrayBuffer();
    } finally {
      await ctx.storage.delete(args.storageId).catch(() => undefined);
    }

    const check = checkEvidenceLibraryUpload({
      kind: args.kind,
      name,
      bytes: bytes.byteLength,
    });
    if (!check.ok) rejectUpload(check.reason, args.kind);

    if (args.kind === "legal") {
      return {
        kind: "text",
        bytes: bytes.byteLength,
        name,
        text: decodeLegalText(bytes),
      };
    }

    try {
      const stored = await storeLibraryUpload({
        ...storageConfig(),
        libraryId: args.libraryId,
        kind: args.kind,
        name,
        bytes,
      });
      return {
        kind: "file",
        bytes: stored.bytes,
        contentType: stored.contentType,
        name,
        url: stored.url,
      };
    } catch (error) {
      if (error instanceof StorageSetupError) {
        throw createError("INVALID_DATA", "The file could not be stored", {
          storageCode: error.code,
        });
      }
      throw error;
    }
  },
});

/** Deletes a file this library uploaded. Called on Replace and Remove. */
export const remove = action({
  args: { libraryId: v.id("evidenceLibraries"), url: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.runQuery(internal.evidenceLibraries.uploads.requireUploadOwner, {
      libraryId: args.libraryId,
    });
    const config = storageConfig();
    const key = parseOwnedEvidenceLibraryUploadUrl({
      storageOrigin: config.storageUrl,
      libraryId: args.libraryId,
      url: args.url,
    });
    if (!key) {
      throw createError("FORBIDDEN", "This file does not belong to the library");
    }
    try {
      await deleteLibraryUpload({ ...config, key });
    } catch (error) {
      if (error instanceof StorageSetupError) {
        throw createError("INVALID_DATA", "The file could not be removed", {
          storageCode: error.code,
        });
      }
      throw error;
    }
    return null;
  },
});

/**
 * Development-only admin step: create the public platform bucket once.
 * Run from the dashboard or `npx convex run`.
 */
export const ensureUploadBucket = internalAction({
  args: {},
  returns: v.union(
    v.literal("created"),
    v.literal("matched"),
    v.literal("updated"),
  ),
  handler: async () => {
    if (process.env.EL_COOLIFY_ENVIRONMENT !== "development") {
      throw createError(
        "FORBIDDEN",
        "The upload bucket is only created from a development deployment",
      );
    }
    return await ensurePlatformUploadBucket(storageConfig());
  },
});
