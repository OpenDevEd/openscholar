"use node";

import { createHash } from "node:crypto";
import type { Id } from "../_generated/dataModel";

const BUCKET_HASH_LENGTH = 48;
const REQUEST_TIMEOUT_MS = 15_000;

type StorageReconcileOutcome = "created" | "matched" | "updated";

type BucketNames = {
  privateBucket: string;
  publicBucket: string;
};

export type BucketPolicy = {
  allowedMimeTypes: string[];
  fileSizeLimit: number;
  name: string;
  public: boolean;
};

type StorageBucket = {
  allowedMimeTypes: string[] | null;
  fileSizeLimit: number | null;
  public: boolean;
};

type StorageRequest = {
  body?: Record<string, unknown>;
  method: "DELETE" | "GET" | "POST" | "PUT";
  path: string;
};

export type StorageClient = {
  fetchImpl: typeof fetch;
  origin: URL;
  serviceRoleKey: string;
};

export type StorageSetupResult = BucketNames & {
  outcome: StorageReconcileOutcome;
};

export type StorageDeletionResult = BucketNames & {
  outcome: "absent" | "deleted" | "pending";
};

export class StorageSetupError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "StorageSetupError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireStorageOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StorageSetupError(
      "INVALID_STORAGE_CONFIG",
      "Storage URL must be a valid HTTPS origin",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.origin === "null" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new StorageSetupError(
      "INVALID_STORAGE_CONFIG",
      "Storage URL must be a valid HTTPS origin",
    );
  }
  return url;
}

function requireServiceRoleKey(value: string): string {
  const serviceRoleKey = value.trim();
  if (!serviceRoleKey) {
    throw new StorageSetupError(
      "INVALID_STORAGE_CONFIG",
      "Storage service-role key is missing",
    );
  }
  return serviceRoleKey;
}

function requireMaxPdfBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new StorageSetupError(
      "INVALID_STORAGE_CONFIG",
      "Storage file size limit must be a positive integer",
    );
  }
  return value;
}

export function createStorageClient(input: {
  storageUrl: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): StorageClient {
  return {
    fetchImpl: input.fetchImpl ?? fetch,
    origin: requireStorageOrigin(input.storageUrl),
    serviceRoleKey: requireServiceRoleKey(input.serviceRoleKey),
  };
}

export function createLibraryStorageBucketNames(
  libraryId: Id<"evidenceLibraries">,
): BucketNames {
  if (!libraryId.trim()) {
    throw new StorageSetupError(
      "INVALID_STORAGE_CONFIG",
      "Evidence Library ID is missing",
    );
  }
  const digest = createHash("sha256").update(libraryId).digest("hex");
  const hash = digest.slice(0, BUCKET_HASH_LENGTH);
  return {
    privateBucket: `el-private-${hash}`,
    publicBucket: `el-public-${hash}`,
  };
}

export async function requestStorage(
  client: StorageClient,
  request: StorageRequest,
): Promise<unknown> {
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
          ...(request.body ? { "content-type": "application/json" } : {}),
        },
        body: request.body ? JSON.stringify(request.body) : undefined,
        signal: controller.signal,
      });
    } catch {
      throw new StorageSetupError(
        "STORAGE_UNAVAILABLE",
        "Supabase Storage could not be reached",
      );
    }

    if (request.method === "GET") {
      if (response.status === 404) return null;
      if (response.status === 400) {
        let errorPayload: unknown;
        try {
          errorPayload = await response.json();
        } catch {
          errorPayload = null;
        }
        if (
          isRecord(errorPayload) &&
          errorPayload.code === "NoSuchBucket" &&
          (errorPayload.statusCode === "404" || errorPayload.statusCode === 404)
        ) {
          return null;
        }
      }
    }
    if (!response.ok) {
      throw new StorageSetupError(
        "STORAGE_REQUEST_FAILED",
        "Supabase Storage rejected the bucket request",
        response.status,
      );
    }
    if (request.method !== "GET") return null;

    try {
      return await response.json();
    } catch {
      throw new StorageSetupError(
        "STORAGE_INVALID_RESPONSE",
        "Supabase Storage returned an invalid bucket response",
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

function parseBucket(payload: unknown, expectedName: string): StorageBucket {
  if (
    !isRecord(payload) ||
    payload.id !== expectedName ||
    payload.name !== expectedName ||
    typeof payload.public !== "boolean"
  ) {
    throw new StorageSetupError(
      "STORAGE_INVALID_RESPONSE",
      "Supabase Storage returned an invalid bucket response",
    );
  }

  const fileSizeLimit = payload.file_size_limit;
  if (
    fileSizeLimit !== null &&
    fileSizeLimit !== undefined &&
    (typeof fileSizeLimit !== "number" ||
      !Number.isSafeInteger(fileSizeLimit) ||
      fileSizeLimit < 0)
  ) {
    throw new StorageSetupError(
      "STORAGE_INVALID_RESPONSE",
      "Supabase Storage returned an invalid bucket response",
    );
  }

  const allowedMimeTypes = payload.allowed_mime_types;
  if (
    allowedMimeTypes !== null &&
    allowedMimeTypes !== undefined &&
    (!Array.isArray(allowedMimeTypes) ||
      !allowedMimeTypes.every((value) => typeof value === "string"))
  ) {
    throw new StorageSetupError(
      "STORAGE_INVALID_RESPONSE",
      "Supabase Storage returned an invalid bucket response",
    );
  }

  return {
    allowedMimeTypes:
      allowedMimeTypes === null || allowedMimeTypes === undefined
        ? null
        : [...allowedMimeTypes],
    fileSizeLimit: fileSizeLimit ?? null,
    public: payload.public,
  };
}

async function readBucket(
  client: StorageClient,
  name: string,
): Promise<StorageBucket | null> {
  const payload = await requestStorage(client, {
    method: "GET",
    path: `/storage/v1/bucket/${encodeURIComponent(name)}`,
  });
  return payload === null ? null : parseBucket(payload, name);
}

function hasRequiredPolicy(
  bucket: StorageBucket,
  policy: BucketPolicy,
): boolean {
  return (
    bucket.public === policy.public &&
    bucket.fileSizeLimit === policy.fileSizeLimit &&
    bucket.allowedMimeTypes?.length === policy.allowedMimeTypes.length &&
    bucket.allowedMimeTypes.every(
      (value, index) => value === policy.allowedMimeTypes[index],
    )
  );
}

function bucketRequestBody(policy: BucketPolicy): Record<string, unknown> {
  return {
    id: policy.name,
    name: policy.name,
    public: policy.public,
    file_size_limit: policy.fileSizeLimit,
    allowed_mime_types: [...policy.allowedMimeTypes],
  };
}

function requireSavedPolicy(
  bucket: StorageBucket | null,
  policy: BucketPolicy,
): void {
  if (!bucket || !hasRequiredPolicy(bucket, policy)) {
    throw new StorageSetupError(
      "STORAGE_POLICY_MISMATCH",
      "Supabase Storage did not save the required bucket policy",
    );
  }
}

export async function reconcileBucket(
  client: StorageClient,
  policy: BucketPolicy,
): Promise<StorageReconcileOutcome> {
  const current = await readBucket(client, policy.name);
  if (!current) {
    await requestStorage(client, {
      method: "POST",
      path: "/storage/v1/bucket",
      body: bucketRequestBody(policy),
    });
    requireSavedPolicy(await readBucket(client, policy.name), policy);
    return "created";
  }
  if (hasRequiredPolicy(current, policy)) return "matched";

  await requestStorage(client, {
    method: "PUT",
    path: `/storage/v1/bucket/${encodeURIComponent(policy.name)}`,
    body: bucketRequestBody(policy),
  });
  requireSavedPolicy(await readBucket(client, policy.name), policy);
  return "updated";
}

function combineOutcomes(
  privateOutcome: StorageReconcileOutcome,
  publicOutcome: StorageReconcileOutcome,
): StorageReconcileOutcome {
  if (privateOutcome === "updated" || publicOutcome === "updated") {
    return "updated";
  }
  if (privateOutcome === "created" || publicOutcome === "created") {
    return "created";
  }
  return "matched";
}

export async function reconcileLibraryStorage(input: {
  storageUrl: string;
  serviceRoleKey: string;
  libraryId: Id<"evidenceLibraries">;
  maxPdfBytes: number;
  fetchImpl?: typeof fetch;
}): Promise<StorageSetupResult> {
  const client: StorageClient = {
    fetchImpl: input.fetchImpl ?? fetch,
    origin: requireStorageOrigin(input.storageUrl),
    serviceRoleKey: requireServiceRoleKey(input.serviceRoleKey),
  };
  const maxFileBytes = requireMaxPdfBytes(input.maxPdfBytes);
  const names = createLibraryStorageBucketNames(input.libraryId);
  const allowedMimeTypes = ["application/pdf", "image/png"];
  const privateOutcome = await reconcileBucket(client, {
    allowedMimeTypes,
    fileSizeLimit: maxFileBytes,
    name: names.privateBucket,
    public: false,
  });
  const publicOutcome = await reconcileBucket(client, {
    allowedMimeTypes,
    fileSizeLimit: maxFileBytes,
    name: names.publicBucket,
    public: true,
  });

  return {
    ...names,
    outcome: combineOutcomes(privateOutcome, publicOutcome),
  };
}

async function emptyAndDeleteBucket(client: StorageClient, name: string) {
  if (!(await readBucket(client, name))) return "absent" as const;
  await requestStorage(client, {
    method: "POST",
    path: `/storage/v1/bucket/${encodeURIComponent(name)}/empty`,
  });
  try {
    await requestStorage(client, {
      method: "DELETE",
      path: `/storage/v1/bucket/${encodeURIComponent(name)}`,
    });
  } catch (error) {
    if (
      error instanceof StorageSetupError &&
      (error.status === 400 || error.status === 409)
    ) {
      return "pending" as const;
    }
    throw error;
  }
  return (await readBucket(client, name))
    ? ("pending" as const)
    : ("deleted" as const);
}

export async function deleteLibraryStorage(input: {
  storageUrl: string;
  serviceRoleKey: string;
  libraryId: Id<"evidenceLibraries">;
  fetchImpl?: typeof fetch;
}): Promise<StorageDeletionResult> {
  const client: StorageClient = {
    fetchImpl: input.fetchImpl ?? fetch,
    origin: requireStorageOrigin(input.storageUrl),
    serviceRoleKey: requireServiceRoleKey(input.serviceRoleKey),
  };
  const names = createLibraryStorageBucketNames(input.libraryId);
  const outcomes = await Promise.all([
    emptyAndDeleteBucket(client, names.privateBucket),
    emptyAndDeleteBucket(client, names.publicBucket),
  ]);
  return {
    ...names,
    outcome: outcomes.includes("pending")
      ? "pending"
      : outcomes.includes("deleted")
        ? "deleted"
        : "absent",
  };
}
