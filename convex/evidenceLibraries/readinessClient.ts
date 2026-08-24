const REQUEST_TIMEOUT_MS = 15_000;
const MAX_JSON_RESPONSE_BYTES = 256 * 1024;
const COMMIT = /^[a-f0-9]{40}$/u;
const APPLICATION_UUID = /^[a-z0-9]{24}$/u;
const LOCALE = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u;

export class ReadinessClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReadinessClientError";
  }
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
  if (!LOCALE.test(input.defaultLocale)) {
    throw new ReadinessClientError(
      "READINESS_CONFIG_INVALID",
      "Evidence Library default language is invalid",
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

async function readBoundedJson(response: Response): Promise<unknown> {
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
  const serialized = new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.concat(chunks),
  );
  try {
    return JSON.parse(serialized);
  } catch {
    throw new ReadinessClientError(
      "READINESS_INVALID_RESPONSE",
      "A readiness service returned invalid JSON",
    );
  }
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

async function requireActiveRevision(
  fetchImpl: typeof fetch,
  targetOrigin: URL,
  revisionKey: string,
) {
  const response = await fetchWithTimeout(
    fetchImpl,
    new URL("/api/library-config/health", targetOrigin),
    { headers: { accept: "application/json" }, method: "GET" },
  );
  if (response.status !== 200) {
    throw new ReadinessClientError(
      "CONFIG_NOT_READY",
      "The Evidence Library configuration is not active",
    );
  }
  const body = await readBoundedJson(response);
  if (
    !isRecord(body) ||
    body.state !== "active" ||
    body.rejected !== null ||
    !isRecord(body.active) ||
    body.active.revision !== revisionKey
  ) {
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
  defaultLocale: string;
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
      new URL(`/${input.defaultLocale}/lib`, targetOrigin),
      "public page",
    ),
    requirePage(fetchImpl, new URL("/admin", targetOrigin), "admin page"),
  ]);
  return { status: "ready" };
}
