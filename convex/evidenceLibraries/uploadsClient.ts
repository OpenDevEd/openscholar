"use node";

import { createHash } from "node:crypto";
import {
  createStorageClient,
  reconcileBucket,
  StorageSetupError,
  type StorageClient,
} from "./storageSetupClient";
import {
  EVIDENCE_LIBRARY_UPLOAD_BUCKET,
  EVIDENCE_LIBRARY_UPLOAD_LIMITS,
  checkEvidenceLibraryUpload,
  createEvidenceLibraryUploadKey,
  evidenceLibraryUploadPrefix,
  evidenceLibraryUploadUrl,
  type EvidenceLibraryUploadKind,
} from "../../lib/evidence-libraries/configuration/uploads";

const REQUEST_TIMEOUT_MS = 15_000;
/** One year. New content gets a new hash, so files never go stale. */
const CACHE_MAX_AGE_SECONDS = 31_536_000;
const LIST_PAGE_SIZE = 100;

type StorageInput = {
  storageUrl: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
};

export type StoredUpload = {
  bytes: number;
  contentType: string;
  key: string;
  url: string;
};

function bucketPath(suffix: string): string {
  return `/storage/v1/object/${suffix}`;
}

async function requestObjects(
  client: StorageClient,
  request: {
    body?: BodyInit;
    headers?: Record<string, string>;
    method: "DELETE" | "POST";
    path: string;
    /** Return null instead of throwing when the bucket does not exist. */
    allowMissingBucket?: boolean;
  },
): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await client.fetchImpl(new URL(request.path, client.origin), {
        method: request.method,
        headers: {
          apikey: client.serviceRoleKey,
          authorization: `Bearer ${client.serviceRoleKey}`,
          ...request.headers,
        },
        body: request.body,
        signal: controller.signal,
      });
    } catch {
      throw new StorageSetupError(
        "STORAGE_UNAVAILABLE",
        "The file store could not be reached",
      );
    }
    if (
      request.allowMissingBucket &&
      (response.status === 400 || response.status === 404)
    ) {
      return null;
    }
    if (!response.ok) {
      throw new StorageSetupError(
        "STORAGE_REQUEST_FAILED",
        "The file store rejected the request",
        response.status,
      );
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/** Creates the public platform bucket once, or fixes its policy. */
export async function ensureUploadBucket(input: StorageInput) {
  const client = createStorageClient(input);
  const allowedMimeTypes = [
    "image/svg+xml",
    "image/png",
    "image/webp",
    "image/jpeg",
  ];
  return await reconcileBucket(client, {
    allowedMimeTypes,
    fileSizeLimit: Math.max(...Object.values(EVIDENCE_LIBRARY_UPLOAD_LIMITS)),
    name: EVIDENCE_LIBRARY_UPLOAD_BUCKET,
    public: true,
  });
}

export async function storeLibraryUpload(
  input: StorageInput & {
    libraryId: string;
    kind: Exclude<EvidenceLibraryUploadKind, "legal">;
    name: string;
    bytes: ArrayBuffer;
  },
): Promise<StoredUpload> {
  const client = createStorageClient(input);
  const check = checkEvidenceLibraryUpload({
    kind: input.kind,
    name: input.name,
    bytes: input.bytes.byteLength,
  });
  if (!check.ok) {
    throw new StorageSetupError(
      check.reason === "type" ? "UPLOAD_WRONG_TYPE" : "UPLOAD_TOO_BIG",
      check.reason === "type"
        ? "This file type is not accepted"
        : "This file is too big",
    );
  }
  const key = createEvidenceLibraryUploadKey({
    libraryId: input.libraryId,
    kind: input.kind,
    contentHashHex: createHash("sha256")
      .update(Buffer.from(input.bytes))
      .digest("hex"),
    extension: check.extension,
  });
  await requestObjects(client, {
    method: "POST",
    path: bucketPath(`${EVIDENCE_LIBRARY_UPLOAD_BUCKET}/${key}`),
    headers: {
      "cache-control": `max-age=${CACHE_MAX_AGE_SECONDS}`,
      "content-type": check.contentType,
      "x-upsert": "true",
    },
    body: input.bytes,
  });
  return {
    bytes: input.bytes.byteLength,
    contentType: check.contentType,
    key,
    url: evidenceLibraryUploadUrl({ storageOrigin: client.origin.origin, key }),
  };
}

async function deleteObjects(client: StorageClient, keys: string[]) {
  if (keys.length === 0) return;
  await requestObjects(client, {
    method: "DELETE",
    path: bucketPath(EVIDENCE_LIBRARY_UPLOAD_BUCKET),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prefixes: keys }),
  });
}

export async function deleteLibraryUpload(
  input: StorageInput & { key: string },
): Promise<void> {
  await deleteObjects(createStorageClient(input), [input.key]);
}

async function listObjectNames(
  client: StorageClient,
  prefix: string,
): Promise<string[]> {
  const names: string[] = [];
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const response = await requestObjects(client, {
      method: "POST",
      path: bucketPath(`list/${EVIDENCE_LIBRARY_UPLOAD_BUCKET}`),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefix, limit: LIST_PAGE_SIZE, offset }),
      allowMissingBucket: true,
    });
    if (!response) return names;
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new StorageSetupError(
        "STORAGE_INVALID_RESPONSE",
        "The file store returned an invalid file list",
      );
    }
    if (!Array.isArray(payload)) {
      throw new StorageSetupError(
        "STORAGE_INVALID_RESPONSE",
        "The file store returned an invalid file list",
      );
    }
    for (const entry of payload) {
      const name =
        typeof entry === "object" && entry !== null && "name" in entry
          ? entry.name
          : null;
      if (typeof name === "string" && name) names.push(name);
    }
    if (payload.length < LIST_PAGE_SIZE) return names;
  }
}

/**
 * Removes every file the library uploaded. Used at teardown. A missing
 * bucket means the library never uploaded anything.
 */
export async function deleteLibraryUploads(
  input: StorageInput & { libraryId: string },
): Promise<{ deleted: number }> {
  const client = createStorageClient(input);
  const prefix = evidenceLibraryUploadPrefix(input.libraryId);
  const names = await listObjectNames(client, prefix);
  const keys = names.map((name) => `${prefix}${name}`);
  await deleteObjects(client, keys);
  return { deleted: keys.length };
}
