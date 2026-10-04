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
  createEvidenceLibraryUploadKey,
  evidenceLibraryUploadPrefix,
  evidenceLibraryUploadUrl,
  type EvidenceLibraryUploadKind,
} from "../../lib/evidence-libraries/configuration/uploads";

const REQUEST_TIMEOUT_MS = 15_000;
/** One year, immutable. New content gets a new hash, so files never go stale. */
const CACHE_CONTROL = "public, max-age=31536000, immutable";
const LIST_PAGE_SIZE = 100;

type StorageInput = {
  storageUrl: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
};

type StoredUpload = {
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
    "image/x-icon",
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

/**
 * Writes an already-checked file (see `checkEvidenceLibraryUploadContent`)
 * under the library prefix and returns its public URL.
 */
export async function storeLibraryUpload(
  input: StorageInput & {
    libraryId: string;
    kind: Exclude<EvidenceLibraryUploadKind, "legal">;
    extension: string;
    contentType: string;
    bytes: ArrayBuffer;
  },
): Promise<StoredUpload> {
  const client = createStorageClient(input);
  const key = createEvidenceLibraryUploadKey({
    libraryId: input.libraryId,
    kind: input.kind,
    contentHashHex: createHash("sha256")
      .update(Buffer.from(input.bytes))
      .digest("hex"),
    extension: input.extension,
  });
  await requestObjects(client, {
    method: "POST",
    path: bucketPath(`${EVIDENCE_LIBRARY_UPLOAD_BUCKET}/${key}`),
    headers: {
      "cache-control": CACHE_CONTROL,
      "content-type": input.contentType,
      "x-upsert": "true",
    },
    body: input.bytes,
  });
  return {
    bytes: input.bytes.byteLength,
    contentType: input.contentType,
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

/**
 * The first page of the files under `prefix`, and whether the list ends with it. Null when
 * the bucket is missing.
 */
async function listObjectPage(
  client: StorageClient,
  prefix: string,
): Promise<{ names: string[]; isLast: boolean } | null> {
  const response = await requestObjects(client, {
    method: "POST",
    path: bucketPath(`list/${EVIDENCE_LIBRARY_UPLOAD_BUCKET}`),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prefix, limit: LIST_PAGE_SIZE, offset: 0 }),
    allowMissingBucket: true,
  });
  if (!response) return null;
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
  const names: string[] = [];
  for (const entry of payload) {
    const name =
      typeof entry === "object" && entry !== null && "name" in entry
        ? entry.name
        : null;
    if (typeof name === "string" && name) names.push(name);
  }
  return { names, isLast: payload.length < LIST_PAGE_SIZE };
}

/**
 * Removes every file the library uploaded. Used at teardown. A missing
 * bucket means the library never uploaded anything.
 */
export async function deleteLibraryUploads(
  input: StorageInput & {
    libraryId: string;
    /**
     * Called before each batch of deletions. A library with many files takes
     * longer than one lease to walk, so the caller uses this to keep hold of
     * the teardown while it works.
     */
    onBatch?: () => Promise<void>;
  },
): Promise<{ deleted: number }> {
  const client = createStorageClient(input);
  const prefix = evidenceLibraryUploadPrefix(input.libraryId);
  let deleted = 0;
  let previous: string | undefined;
  // A page is deleted before the next is read, so every read starts at the
  // first file still there and no list of them all is ever held.
  for (;;) {
    await input.onBatch?.();
    const page = await listObjectPage(client, prefix);
    if (!page || page.names.length === 0) return { deleted };
    if (page.names[0] === previous) {
      throw new StorageSetupError(
        "STORAGE_REQUEST_FAILED",
        "The file store kept files it was asked to delete",
      );
    }
    previous = page.names[0];
    await input.onBatch?.();
    await deleteObjects(
      client,
      page.names.map((name) => `${prefix}${name}`),
    );
    deleted += page.names.length;
    if (page.isLast) return { deleted };
  }
}
