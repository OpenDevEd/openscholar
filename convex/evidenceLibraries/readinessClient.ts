const REQUEST_TIMEOUT_MS = 15_000;
const MAX_JSON_RESPONSE_BYTES = 256 * 1024;
const COMMIT = /^[a-f0-9]{40}$/u;
const APPLICATION_UUID = /^[a-z0-9]{24}$/u;

export class ReadinessClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReadinessClientError";
  }
}

const RETRYABLE_READINESS_CODES = new Set([
  "READINESS_UNAVAILABLE",
  "RUNTIME_NOT_READY",
  "CONFIG_NOT_READY",
  "PAGE_NOT_READY",
]);

export function isRetryableReadinessError(
  error: unknown,
): error is ReadinessClientError {
  return (
    error instanceof ReadinessClientError &&
    RETRYABLE_READINESS_CODES.has(error.code)
  );
}

// Something other than this library answers the address. Waiting will not fix
// it, so the platform moves the library to a free address instead.
export const ADDRESS_NOT_OURS_CODE = "ADDRESS_NOT_OURS";

export function isAddressNotOursError(
  error: unknown,
): error is ReadinessClientError {
  return (
    error instanceof ReadinessClientError &&
    error.code === ADDRESS_NOT_OURS_CODE
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireHttpsOrigin(label: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      `${label} must be a valid HTTPS origin`,
    );
  }
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      `${label} must be a valid HTTPS origin`,
    );
  }
  return new URL(url.origin);
}

function requireInput(input: ReadinessCheckInput) {
  if (!APPLICATION_UUID.test(input.applicationUuid)) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Coolify application UUID is invalid",
    );
  }
  if (!COMMIT.test(input.runtimeCommit)) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Evidence Library commit is invalid",
    );
  }
  if (!input.revisionKey.trim()) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Evidence Library revision is missing",
    );
  }
  if (!input.verifierToken.trim()) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Runtime verifier token is missing",
    );
  }
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: URL,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      ...init,
      redirect: "manual",
      signal: controller.signal,
    });
  } catch {
    throw new ReadinessClientError(
      "READINESS_UNAVAILABLE",
      "Evidence Library readiness could not be checked",
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedText(
  response: Response,
  { allowEmpty = false } = {},
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_JSON_RESPONSE_BYTES
  ) {
    throw new ReadinessClientError(
      "READINESS_INVALID_RESPONSE",
      "A readiness service returned too much data",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) {
    if (allowEmpty) return "";
    throw new ReadinessClientError(
      "READINESS_INVALID_RESPONSE",
      "A readiness service returned an empty response",
    );
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_JSON_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ReadinessClientError(
        "READINESS_INVALID_RESPONSE",
        "A readiness service returned too much data",
      );
    }
    chunks.push(value);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
  } catch {
    // Bytes that are not text cannot be our JSON answer.
    return "";
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const serialized = await readBoundedText(response);
  try {
    return JSON.parse(serialized);
  } catch {
    throw new ReadinessClientError(
      "READINESS_INVALID_RESPONSE",
      "A readiness service returned invalid JSON",
    );
  }
}

// Our proxy answers this when no container serves the host yet.
const FREE_ADDRESS_SIGNAL = "no available server";

export type EvidenceLibraryAddressState = "ours" | "not-ours" | "unreachable";

export type EvidenceLibraryAddressProbe =
  | { kind: "unreachable" }
  | { kind: "answer"; status: number; body: string };

export type EvidenceLibraryAddressAnswer = {
  /** Whose site answers this address. */
  state: EvidenceLibraryAddressState;
  /** The configuration revision the library reports, when it is ours. */
  revision: string | null;
  /** The library answered with an accepted, active configuration. */
  activeAndAccepted: boolean;
};

const UNREACHABLE_ADDRESS: EvidenceLibraryAddressAnswer = {
  state: "unreachable",
  revision: null,
  activeAndAccepted: false,
};

/**
 * Reads one answer from `/api/library-config/health`. Only our own health
 * answer counts as ours. Nothing serving the host yet stays "unreachable";
 * any other answer means another site holds the address.
 */
export function classifyEvidenceLibraryAddress(
  probe: EvidenceLibraryAddressProbe,
): EvidenceLibraryAddressAnswer {
  if (probe.kind === "unreachable") return UNREACHABLE_ADDRESS;
  if (
    probe.status === 503 &&
    probe.body.trimStart().toLowerCase().startsWith(FREE_ADDRESS_SIGNAL)
  ) {
    return UNREACHABLE_ADDRESS;
  }
  if (probe.status !== 200) {
    return { state: "not-ours", revision: null, activeAndAccepted: false };
  }
  let body: unknown;
  try {
    body = JSON.parse(probe.body);
  } catch {
    return { state: "not-ours", revision: null, activeAndAccepted: false };
  }
  if (
    !isRecord(body) ||
    typeof body.state !== "string" ||
    !("active" in body) ||
    !("rejected" in body)
  ) {
    return { state: "not-ours", revision: null, activeAndAccepted: false };
  }
  const active = isRecord(body.active) ? body.active : null;
  const revision =
    typeof active?.revision === "string" ? active.revision : null;
  return {
    state: "ours",
    revision,
    activeAndAccepted:
      body.state === "active" && body.rejected === null && revision !== null,
  };
}

/** Asks one address who serves it. Never throws; a failure is "unreachable". */
export async function probeEvidenceLibraryAddress(input: {
  targetBaseUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<EvidenceLibraryAddressAnswer> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let origin: URL;
  try {
    origin = requireHttpsOrigin("Evidence Library URL", input.targetBaseUrl);
  } catch {
    return UNREACHABLE_ADDRESS;
  }
  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      new URL("/api/library-config/health", origin),
      { headers: { accept: "application/json" }, method: "GET" },
    );
  } catch {
    return UNREACHABLE_ADDRESS;
  }
  let body: string;
  try {
    body = await readBoundedText(response, { allowEmpty: true });
  } catch {
    return UNREACHABLE_ADDRESS;
  }
  return classifyEvidenceLibraryAddress({
    kind: "answer",
    status: response.status,
    body,
  });
}

async function requireVerifierReady(
  fetchImpl: typeof fetch,
  origin: URL,
  input: ReadinessCheckInput,
) {
  const response = await fetchWithTimeout(
    fetchImpl,
    new URL("/v1/library-runtime/readiness", origin),
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.verifierToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        applicationUuid: input.applicationUuid,
        commit: input.runtimeCommit,
      }),
    },
  );
  if (response.status !== 200) {
    throw new ReadinessClientError(
      "RUNTIME_NOT_READY",
      "The Evidence Library services are not ready",
    );
  }
  const body = await readBoundedJson(response);
  if (
    !isRecord(body) ||
    body.ready !== true ||
    body.applicationUuid !== input.applicationUuid ||
    body.commit !== input.runtimeCommit ||
    !Array.isArray(body.services) ||
    body.services.length !== 6
  ) {
    throw new ReadinessClientError(
      "READINESS_INVALID_RESPONSE",
      "The runtime verifier returned an invalid response",
    );
  }
}

/**
 * The address must answer as this library. The Coolify application is already
 * running by the time this runs, so an answer from anything else means the
 * address belongs to another site and the library has to move.
 */
async function requireActiveRevision(
  fetchImpl: typeof fetch,
  targetOrigin: URL,
  revisionKey: string,
) {
  const address = await probeEvidenceLibraryAddress({
    targetBaseUrl: targetOrigin.origin,
    fetchImpl,
  });
  if (address.state === "not-ours") {
    throw new ReadinessClientError(
      ADDRESS_NOT_OURS_CODE,
      "Another site answers this Evidence Library address",
    );
  }
  if (address.state === "unreachable") {
    throw new ReadinessClientError(
      "CONFIG_NOT_READY",
      "The Evidence Library configuration is not active",
    );
  }
  if (!address.activeAndAccepted || address.revision !== revisionKey) {
    throw new ReadinessClientError(
      "CONFIG_NOT_READY",
      "The Evidence Library has not activated the requested revision",
    );
  }
}

async function requirePage(
  fetchImpl: typeof fetch,
  url: URL,
  description: string,
) {
  const response = await fetchWithTimeout(fetchImpl, url, {
    headers: { accept: "text/html" },
    method: "GET",
  });
  if (!response.ok) {
    throw new ReadinessClientError(
      "PAGE_NOT_READY",
      `The Evidence Library ${description} is not ready`,
    );
  }
}

export type ReadinessCheckInput = {
  applicationUuid: string;
  runtimeCommit: string;
  revisionKey: string;
  targetBaseUrl: string;
  verifierUrl: string;
  verifierToken: string;
  fetchImpl?: typeof fetch;
};

export async function requireLibraryRuntimeReady(
  input: ReadinessCheckInput,
): Promise<{ status: "ready" }> {
  requireInput(input);
  const fetchImpl = input.fetchImpl ?? fetch;
  const verifierOrigin = requireHttpsOrigin(
    "Runtime verifier URL",
    input.verifierUrl,
  );
  const targetOrigin = requireHttpsOrigin(
    "Evidence Library URL",
    input.targetBaseUrl,
  );
  await requireVerifierReady(fetchImpl, verifierOrigin, input);
  await requireActiveRevision(fetchImpl, targetOrigin, input.revisionKey);
  await Promise.all([
    requirePage(
      fetchImpl,
      new URL("/lib", targetOrigin),
      "public page",
    ),
    requirePage(fetchImpl, new URL("/admin", targetOrigin), "admin page"),
  ]);
  return { status: "ready" };
}
