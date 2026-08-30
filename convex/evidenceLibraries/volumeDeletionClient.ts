"use node";

import { createError } from "../lib/errors";
import { isCoolifyApplicationUuid } from "./coolifyApplication";

const REQUEST_TIMEOUT_MS = 15_000;

export type VolumeDeletionResult = {
  outcome: "absent" | "deleted";
};

export class VolumeDeletionClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VolumeDeletionClientError";
  }
}

const RETRYABLE_VOLUME_DELETION_CODES = new Set([
  "VOLUME_IN_USE",
  "VOLUME_DELETION_FAILED",
  "VOLUME_DELETER_UNAVAILABLE",
]);

export function isRetryableVolumeDeletionError(
  error: unknown,
): error is VolumeDeletionClientError {
  return (
    error instanceof VolumeDeletionClientError &&
    RETRYABLE_VOLUME_DELETION_CODES.has(error.code)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireDeleterOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw createError(
      "INVALID_DATA",
      "Volume deleter URL must be a valid HTTPS origin",
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
    throw createError(
      "INVALID_DATA",
      "Volume deleter URL must be a valid HTTPS origin",
    );
  }
  return url;
}

function parseServiceError(payload: unknown): VolumeDeletionClientError {
  const code =
    isRecord(payload) &&
    isRecord(payload.error) &&
    typeof payload.error.code === "string"
      ? payload.error.code
      : "";
  if (code === "volume_in_use") {
    return new VolumeDeletionClientError(
      "VOLUME_IN_USE",
      "The library runtime is still releasing its data volume",
    );
  }
  if (code === "volume_deletion_failed") {
    return new VolumeDeletionClientError(
      "VOLUME_DELETION_FAILED",
      "The library data volume could not be deleted",
    );
  }
  return new VolumeDeletionClientError(
    "VOLUME_DELETER_FAILED",
    "The volume deleter rejected the request",
  );
}

function parseDeletionResult(
  payload: unknown,
  applicationUuid: string,
): VolumeDeletionResult {
  if (
    !isRecord(payload) ||
    payload.applicationUuid !== applicationUuid ||
    (payload.outcome !== "absent" && payload.outcome !== "deleted")
  ) {
    throw new VolumeDeletionClientError(
      "VOLUME_DELETER_INVALID_RESPONSE",
      "The volume deleter returned an invalid response",
    );
  }
  return { outcome: payload.outcome };
}

export async function deleteLibraryVolume(input: {
  applicationUuid: string;
  deleterUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<VolumeDeletionResult> {
  const origin = requireDeleterOrigin(input.deleterUrl);
  if (!isCoolifyApplicationUuid(input.applicationUuid)) {
    throw createError("INVALID_DATA", "Coolify application UUID is invalid");
  }
  if (!input.token.trim()) {
    throw createError("INVALID_DATA", "Volume deleter token is missing");
  }
  const response = await (input.fetchImpl ?? fetch)(
    new URL("/v1/library-volumes/delete", origin),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ applicationUuid: input.applicationUuid }),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  ).catch(() => {
    throw new VolumeDeletionClientError(
      "VOLUME_DELETER_UNAVAILABLE",
      "The volume deleter could not be reached",
    );
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw parseServiceError(payload);
  return parseDeletionResult(payload, input.applicationUuid);
}
