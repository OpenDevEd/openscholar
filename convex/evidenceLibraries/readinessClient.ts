import { isRuntimeImageReference } from "./runtimeImageRegistry";
import { isCoolifyApplicationUuid } from "./coolifyApplication";

const REQUEST_TIMEOUT_MS = 15_000;
const ROUTE_REQUEST_TIMEOUT_MS = 30_000;
const MAX_JSON_RESPONSE_BYTES = 256 * 1024;
const COMMIT = /^[a-f0-9]{40}$/u;
const RUNTIME_ROUTE_HEADER = "x-openscholar-route";

export type LibraryRuntimeRouteOperation =
  | "maintenance"
  | "protection"
  | "activation"
  | "finalization";

export type LibraryRuntimeRouteInput = {
  applicationUuid: string;
  runtimeCommit: string;
  runtimeImage: string;
  revisionKey: string;
  platformOrigins: readonly string[];
  customOrigins: readonly string[];
  verifierUrl: string;
  verifierToken: string;
  fetchImpl?: typeof fetch;
};

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
  if (!isCoolifyApplicationUuid(input.applicationUuid)) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Evidence Library application ID is invalid",
    );
  }
  if (!COMMIT.test(input.runtimeCommit)) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Evidence Library commit is invalid",
    );
  }
  if (!isRuntimeImageReference(input.runtimeImage)) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Evidence Library image is invalid",
    );
  }
  if (!input.revisionKey.trim()) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Evidence Library revision is missing",
    );
  }
  if (!input.loginPageUrl.trim()) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Evidence Library login page address is missing",
    );
  }
  if (!input.verifierToken.trim()) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Runtime verifier token is missing",
    );
  }
}

/**
 * One deadline for the whole exchange, not just the headers.
 *
 * A server that answers headers and then stops sending would otherwise hold
 * the check open for ever: the timer used to be cleared the moment the
 * headers arrived. The caller closes the request when it has finished with
 * the body, and anything left unread is cancelled.
 */
async function fetchWithTimeout<T>(
  fetchImpl: typeof fetch,
  url: URL,
  init: RequestInit,
  use: (response: Response) => Promise<T>,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response | undefined;
  try {
    response = await fetchImpl(url, {
      ...init,
      redirect: "manual",
      signal: controller.signal,
    });
    return await use(response);
  } catch (error) {
    if (error instanceof ReadinessClientError) throw error;
    throw new ReadinessClientError(
      "READINESS_UNAVAILABLE",
      "Evidence Library readiness could not be checked",
    );
  } finally {
    clearTimeout(timeout);
    // A body nobody read keeps the connection open. Released without
    // waiting: a server that has stopped sending must not be able to hold
    // the check open here either.
    if (response && !response.bodyUsed) {
      void response.body?.cancel().catch(() => undefined);
    }
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
  const serialized = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    serialized.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(serialized);
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
  try {
    // The body is read inside the deadline, so an answer that stops halfway
    // is a failed check rather than a check that never ends.
    return await fetchWithTimeout(
      fetchImpl,
      new URL("/api/library-config/health", origin),
      { headers: { accept: "application/json" }, method: "GET" },
      async (response) =>
        classifyEvidenceLibraryAddress({
          kind: "answer",
          status: response.status,
          body: await readBoundedText(response, { allowEmpty: true }),
        }),
    );
  } catch {
    return UNREACHABLE_ADDRESS;
  }
}

async function requireVerifierReady(
  fetchImpl: typeof fetch,
  origin: URL,
  input: ReadinessCheckInput,
) {
  const body = await fetchWithTimeout(
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
        runtimeImage: input.runtimeImage,
      }),
    },
    async (response) => {
      if (response.status !== 200) {
        throw new ReadinessClientError(
          "RUNTIME_NOT_READY",
          "The Evidence Library services are not ready",
        );
      }
      return await readBoundedJson(response);
    },
  );
  if (
    !isRecord(body) ||
    body.ready !== true ||
    body.applicationUuid !== input.applicationUuid ||
    body.commit !== input.runtimeCommit ||
    body.runtimeImage !== input.runtimeImage ||
    !Array.isArray(body.services) ||
    body.services.length !== 7
  ) {
    throw new ReadinessClientError(
      "READINESS_INVALID_RESPONSE",
      "The runtime verifier returned an invalid response",
    );
  }
}

const runtimeRouteStatuses = {
  activation: "active",
  finalization: "finalized",
  maintenance: "maintenance",
  protection: "protected",
} as const satisfies Record<LibraryRuntimeRouteOperation, string>;

function requireRuntimeRouteInput(input: LibraryRuntimeRouteInput) {
  if (!isCoolifyApplicationUuid(input.applicationUuid)) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Evidence Library application ID is invalid",
    );
  }
  if (!COMMIT.test(input.runtimeCommit)) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Evidence Library commit is invalid",
    );
  }
  if (!isRuntimeImageReference(input.runtimeImage)) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Evidence Library image is invalid",
    );
  }
  if (!input.revisionKey.trim()) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Evidence Library revision is missing",
    );
  }
  if (input.platformOrigins.length < 1 || input.platformOrigins.length > 2) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Evidence Library platform addresses are invalid",
    );
  }
  if (input.customOrigins.length > 20) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Evidence Library custom addresses are invalid",
    );
  }
  const origins = [
    ...input.platformOrigins.map(
      (origin) =>
        requireHttpsOrigin("Evidence Library platform URL", origin).origin,
    ),
    ...input.customOrigins.map(
      (origin) =>
        requireHttpsOrigin("Evidence Library custom URL", origin).origin,
    ),
  ];
  if (new Set(origins).size !== origins.length) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Evidence Library addresses must be unique",
    );
  }
  if (!input.verifierToken.trim()) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Runtime verifier token is missing",
    );
  }
  return {
    customOrigins: origins.slice(input.platformOrigins.length),
    platformOrigins: origins.slice(0, input.platformOrigins.length),
  };
}

export async function changeLibraryRuntimeRoute(
  operation: LibraryRuntimeRouteOperation,
  input: LibraryRuntimeRouteInput,
): Promise<{ status: string }> {
  const origins = requireRuntimeRouteInput(input);
  const verifierOrigin = requireHttpsOrigin(
    "Runtime verifier URL",
    input.verifierUrl,
  );
  const expectedStatus = runtimeRouteStatuses[operation];
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = new URL(`/v1/library-runtime/${operation}`, verifierOrigin);
  const init = {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.verifierToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      applicationUuid: input.applicationUuid,
      commit: input.runtimeCommit,
      customOrigins: origins.customOrigins,
      platformOrigins: origins.platformOrigins,
      revision: input.revisionKey,
      runtimeImage: input.runtimeImage,
    }),
  } satisfies RequestInit;
  let body: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      body = await fetchWithTimeout(
        fetchImpl,
        url,
        init,
        async (response) => {
          if (response.status !== 200) {
            throw new ReadinessClientError(
              response.status === 409 || response.status >= 500
                ? "RUNTIME_ROUTE_UNAVAILABLE"
                : "RUNTIME_ROUTE_FAILED",
              "Evidence Library traffic could not be updated",
            );
          }
          return await readBoundedJson(response);
        },
        ROUTE_REQUEST_TIMEOUT_MS,
      );
      break;
    } catch (error) {
      const transient =
        error instanceof ReadinessClientError &&
        (error.code === "READINESS_UNAVAILABLE" ||
          error.code === "RUNTIME_ROUTE_UNAVAILABLE");
      if (transient && attempt === 0) continue;
      if (transient) {
        throw new ReadinessClientError(
          "RUNTIME_ROUTE_FAILED",
          "Evidence Library traffic could not be updated",
        );
      }
      throw error;
    }
  }
  if (!isRecord(body) || body.status !== expectedStatus) {
    throw new ReadinessClientError(
      "READINESS_INVALID_RESPONSE",
      "The runtime verifier returned an invalid route response",
    );
  }
  return { status: expectedStatus };
}

export async function removeLibraryRuntimeRoute(input: {
  applicationUuid: string;
  verifierUrl: string;
  verifierToken: string;
  fetchImpl?: typeof fetch;
}): Promise<{ status: "removed" }> {
  if (!isCoolifyApplicationUuid(input.applicationUuid)) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Evidence Library application ID is invalid",
    );
  }
  if (!input.verifierToken.trim()) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Runtime verifier token is missing",
    );
  }
  const verifierOrigin = requireHttpsOrigin(
    "Runtime verifier URL",
    input.verifierUrl,
  );
  const body = await fetchWithTimeout(
    input.fetchImpl ?? fetch,
    new URL("/v1/library-runtime/removal", verifierOrigin),
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.verifierToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ applicationUuid: input.applicationUuid }),
    },
    async (response) => {
      if (response.status !== 200) {
        throw new ReadinessClientError(
          "RUNTIME_ROUTE_FAILED",
          "Evidence Library traffic could not be removed",
        );
      }
      return await readBoundedJson(response);
    },
  );
  if (!isRecord(body) || body.status !== "removed") {
    throw new ReadinessClientError(
      "READINESS_INVALID_RESPONSE",
      "The runtime verifier returned an invalid route response",
    );
  }
  return { status: "removed" };
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

async function requireActiveRuntimeRoute(
  fetchImpl: typeof fetch,
  targetOrigin: URL,
  runtimeCommit: string,
  revisionKey: string,
) {
  await fetchWithTimeout(
    fetchImpl,
    new URL("/api/library-config/health", targetOrigin),
    { headers: { accept: "application/json" }, method: "GET" },
    async (response) => {
      if (
        response.headers.get(RUNTIME_ROUTE_HEADER) !==
        `${runtimeCommit}:${revisionKey}`
      ) {
        throw new ReadinessClientError(
          "CONFIG_NOT_READY",
          "The Evidence Library traffic route is not active",
        );
      }
    },
  );
}

async function requirePage(
  fetchImpl: typeof fetch,
  url: URL,
  description: string,
) {
  // A valid page can exceed the pinned client's 256 KiB response cap.
  await fetchWithTimeout(
    fetchImpl,
    url,
    { headers: { accept: "text/html" }, method: "HEAD" },
    async (response) => {
      if (!response.ok) {
        throw new ReadinessClientError(
          "PAGE_NOT_READY",
          `The Evidence Library ${description} is not ready`,
        );
      }
    },
  );
}

/**
 * The address the library sends a signed-out visitor of `/admin` to. Only
 * the exact login page for this library counts, so a page that merely starts
 * with the same text, or one on a look-alike host, is refused.
 */
function isLibraryLoginPage(destination: URL, loginPageUrl: string): boolean {
  let expected: URL;
  try {
    expected = new URL(loginPageUrl);
  } catch {
    return false;
  }
  return (
    destination.origin === expected.origin &&
    destination.pathname === expected.pathname
  );
}

/**
 * A signed-out `/admin` does not render a page: the runtime answers `307` and
 * sends the browser to this library's OpenScholar login page, which signs the
 * person in and hands the session back. Only that exact answer counts as
 * ready. A page of its own, or another kind of redirect, means the library
 * runs software that does not follow this contract.
 */
async function requireAdminPage(
  fetchImpl: typeof fetch,
  url: URL,
  loginPageUrl: string,
) {
  const notReady = new ReadinessClientError(
    "PAGE_NOT_READY",
    "The Evidence Library admin page is not ready",
  );
  await fetchWithTimeout(
    fetchImpl,
    url,
    { headers: { accept: "text/html" }, method: "GET" },
    async (response) => {
      // The runtime contract is one exact answer: a 307 to the login page.
      if (response.status !== 307) throw notReady;

      const location = response.headers.get("location");
      if (!location) throw notReady;
      let destination: URL;
      try {
        destination = new URL(location, url);
      } catch {
        throw notReady;
      }
      if (!isLibraryLoginPage(destination, loginPageUrl)) throw notReady;
    },
  );
}

/**
 * The platform address is never released. Once a library answers on a custom
 * domain, its platform address has to keep sending visitors there, because
 * DOI landing pages already registered point at it.
 */
async function requireRedirectToCanonical(
  fetchImpl: typeof fetch,
  platformOrigin: URL,
  canonicalOrigin: URL,
): Promise<void> {
  let redirected: boolean;
  try {
    redirected = await fetchWithTimeout(
      fetchImpl,
      new URL("/lib", platformOrigin),
      { headers: { accept: "text/html" }, method: "GET", redirect: "manual" },
      async (response) =>
        readsAsRedirectTo(response, platformOrigin, canonicalOrigin),
    );
  } catch {
    throw new ReadinessClientError(
      "CONFIG_NOT_READY",
      "The platform address does not answer yet",
    );
  }
  if (!redirected) {
    throw new ReadinessClientError(
      "CONFIG_NOT_READY",
      "The platform address does not send visitors to the library address yet",
    );
  }
}

function readsAsRedirectTo(response: Response, from: URL, to: URL): boolean {
  const location = response.headers.get("location");
  return (
    response.status >= 300 &&
    response.status < 400 &&
    location !== null &&
    new URL(location, from).origin === to.origin
  );
}

export type ReadinessCheckInput = {
  applicationUuid: string;
  runtimeCommit: string;
  runtimeImage: string;
  revisionKey: string;
  /** The address the library calls its own. Everything is read here. */
  targetBaseUrl: string;
  /**
   * The platform address, when the library answers on a custom domain. It
   * must send visitors to `targetBaseUrl` rather than answer itself.
   */
  platformBaseUrl?: string;
  /** Where the library sends a signed-out visitor of `/admin`. */
  loginPageUrl: string;
  /**
   * Used only for requests to `targetBaseUrl`. When that is a customer's
   * domain it is a client pinned to the addresses that were checked, which
   * can reach nothing else — so the verifier and the platform address keep
   * using the ordinary one.
   */
  targetFetchImpl?: typeof fetch;
  verifierUrl: string;
  verifierToken: string;
  fetchImpl?: typeof fetch;
};

export async function requireLibraryRuntimeReady(
  input: ReadinessCheckInput,
): Promise<{ status: "ready" }> {
  await requireLibraryRuntimeServicesReady(input);
  await requireLibraryRuntimePublicReady(input);
  return { status: "ready" };
}

export async function requireLibraryRuntimeServicesReady(
  input: ReadinessCheckInput,
): Promise<{ status: "ready" }> {
  requireInput(input);
  const fetchImpl = input.fetchImpl ?? fetch;
  const verifierOrigin = requireHttpsOrigin(
    "Runtime verifier URL",
    input.verifierUrl,
  );
  await requireVerifierReady(fetchImpl, verifierOrigin, input);
  return { status: "ready" };
}

export async function requireLibraryRuntimePublicReady(
  input: ReadinessCheckInput,
): Promise<{ status: "ready" }> {
  requireInput(input);
  const fetchImpl = input.fetchImpl ?? fetch;
  const targetFetchImpl = input.targetFetchImpl ?? fetchImpl;
  const targetOrigin = requireHttpsOrigin(
    "Evidence Library URL",
    input.targetBaseUrl,
  );
  await requireActiveRevision(targetFetchImpl, targetOrigin, input.revisionKey);
  await requireActiveRuntimeRoute(
    targetFetchImpl,
    targetOrigin,
    input.runtimeCommit,
    input.revisionKey,
  );
  if (input.platformBaseUrl && input.platformBaseUrl !== targetOrigin.origin) {
    await requireRedirectToCanonical(
      fetchImpl,
      requireHttpsOrigin(
        "Evidence Library platform URL",
        input.platformBaseUrl,
      ),
      targetOrigin,
    );
  }
  await Promise.all([
    requirePage(targetFetchImpl, new URL("/lib", targetOrigin), "public page"),
    requireAdminPage(
      targetFetchImpl,
      new URL("/admin", targetOrigin),
      input.loginPageUrl,
    ),
  ]);
  return { status: "ready" };
}
