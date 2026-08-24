"use node";

import { createError } from "../lib/errors";

const POSTGRES_IDENTIFIER = /^[a-z0-9_]{1,63}$/u;
const ERROR_CODE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const REQUEST_TIMEOUT_MS = 8 * 60 * 1_000;

export type DatabaseSetupResult = {
  outcome: "created" | "matched" | "updated";
  databaseName: string;
  loginName: string;
  databaseUrl: string;
};

export class DatabaseProvisionerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DatabaseProvisionerError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireProvisionerOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw createError(
      "INVALID_DATA",
      "Database provisioner URL must be a valid HTTPS origin",
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
      "Database provisioner URL must be a valid HTTPS origin",
    );
  }
  return url;
}

const SAFE_PROVISIONER_ERRORS: Record<string, string> = {
  database_object_owner_conflict:
    "The library database contains objects owned by another login.",
  database_owner_conflict:
    "The library database is owned by another login.",
  extension_owner_conflict:
    "A required database extension is owned by another login.",
  login_database_conflict: "The library login owns another database.",
  login_security_conflict: "The library login has server-wide rights.",
};

function parseSafeServiceError(payload: unknown): DatabaseProvisionerError {
  if (
    isRecord(payload) &&
    isRecord(payload.error) &&
    typeof payload.error.code === "string" &&
    ERROR_CODE.test(payload.error.code)
  ) {
    const message = SAFE_PROVISIONER_ERRORS[payload.error.code];
    if (message) return new DatabaseProvisionerError(payload.error.code, message);
  }
  return new DatabaseProvisionerError(
    "DATABASE_PROVISIONER_FAILED",
    "Database provisioner rejected the request",
  );
}

function parseDatabaseSetupResult(
  payload: unknown,
  expectedLibraryId: string,
  expectedPassword: string,
): DatabaseSetupResult {
  if (
    !isRecord(payload) ||
    payload.libraryId !== expectedLibraryId ||
    (payload.outcome !== "created" &&
      payload.outcome !== "matched" &&
      payload.outcome !== "updated") ||
    typeof payload.databaseName !== "string" ||
    !POSTGRES_IDENTIFIER.test(payload.databaseName) ||
    typeof payload.loginName !== "string" ||
    !POSTGRES_IDENTIFIER.test(payload.loginName) ||
    typeof payload.databaseUrl !== "string"
  ) {
    throw new DatabaseProvisionerError(
      "DATABASE_PROVISIONER_INVALID_RESPONSE",
      "Database provisioner returned an invalid response",
    );
  }
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(payload.databaseUrl);
  } catch {
    throw new DatabaseProvisionerError(
      "DATABASE_PROVISIONER_INVALID_RESPONSE",
      "Database provisioner returned an invalid response",
    );
  }
  let databasePassword: string;
  try {
    databasePassword = decodeURIComponent(databaseUrl.password);
  } catch {
    throw new DatabaseProvisionerError(
      "DATABASE_PROVISIONER_INVALID_RESPONSE",
      "Database provisioner returned an invalid response",
    );
  }
  if (
    (databaseUrl.protocol !== "postgres:" &&
      databaseUrl.protocol !== "postgresql:") ||
    !databaseUrl.hostname ||
    decodeURIComponent(databaseUrl.username) !== payload.loginName ||
    databasePassword !== expectedPassword ||
    databaseUrl.pathname !== `/${payload.databaseName}`
  ) {
    throw new DatabaseProvisionerError(
      "DATABASE_PROVISIONER_INVALID_RESPONSE",
      "Database provisioner returned an invalid response",
    );
  }
  return {
    outcome: payload.outcome,
    databaseName: payload.databaseName,
    loginName: payload.loginName,
    databaseUrl: databaseUrl.toString(),
  };
}

export async function reconcileLibraryDatabase(input: {
  provisionerUrl: string;
  token: string;
  libraryId: string;
  password: string;
  fetchImpl?: typeof fetch;
}): Promise<DatabaseSetupResult> {
  const origin = requireProvisionerOrigin(input.provisionerUrl);
  if (!input.token.trim()) {
    throw createError("INVALID_DATA", "Database provisioner token is missing");
  }
  const response = await (input.fetchImpl ?? fetch)(
    new URL("/v1/library-databases/reconcile", origin),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        libraryId: input.libraryId,
        password: input.password,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  ).catch(() => {
    throw new DatabaseProvisionerError(
      "DATABASE_PROVISIONER_UNAVAILABLE",
      "Database provisioner could not be reached",
    );
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw parseSafeServiceError(payload);
  return parseDatabaseSetupResult(payload, input.libraryId, input.password);
}
