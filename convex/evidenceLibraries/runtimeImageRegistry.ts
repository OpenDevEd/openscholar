const REGISTRY_ORIGIN = "https://ghcr.io";
const TOKEN_URL = "https://ghcr.io/token";
const GITHUB_USER_URL = "https://api.github.com/user";
const REPOSITORY = "opendeved/evidence-library-runtime";
const IMAGE = "ghcr.io/opendeved/evidence-library-runtime";
const PULL_SCOPE = `repository:${REPOSITORY}:pull`;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_JSON_BYTES = 64 * 1024;
const COMMIT = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

export type RuntimeImageReference =
  `ghcr.io/opendeved/evidence-library-runtime@sha256:${string}`;

export class RuntimeImageRegistryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeImageRegistryError";
  }
}

type BearerChallenge = {
  realm: typeof TOKEN_URL;
  service: "ghcr.io";
  scope: typeof PULL_SCOPE;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(message: string): never {
  throw new RuntimeImageRegistryError("REGISTRY_INVALID_RESPONSE", message);
}

export function parseRegistryChallenge(value: string | null): BearerChallenge {
  if (!value?.startsWith("Bearer ")) {
    return invalidResponse("GHCR returned an invalid authentication challenge");
  }
  const parameters = new Map<string, string>();
  for (const match of value
    .slice("Bearer ".length)
    .matchAll(/([a-z]+)="([^"]*)"/giu)) {
    parameters.set(match[1]!.toLowerCase(), match[2]!);
  }
  if (
    parameters.get("realm") !== TOKEN_URL ||
    parameters.get("service") !== "ghcr.io" ||
    parameters.get("scope") !== PULL_SCOPE
  ) {
    return invalidResponse(
      "GHCR returned an unexpected authentication challenge",
    );
  }
  return { realm: TOKEN_URL, service: "ghcr.io", scope: PULL_SCOPE };
}

async function request(
  fetchImpl: typeof fetch,
  input: URL | string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch {
    throw new RuntimeImageRegistryError(
      "REGISTRY_UNAVAILABLE",
      "The runtime image registry could not be reached",
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    return invalidResponse("A registry response was too large");
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    return invalidResponse("A registry response could not be read");
  }
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    return invalidResponse("A registry response was too large");
  }
  try {
    return JSON.parse(text);
  } catch {
    return invalidResponse("A registry response was not valid JSON");
  }
}

function digestFrom(response: Response): RuntimeImageReference {
  const digest = response.headers.get("docker-content-digest");
  if (!digest || !DIGEST.test(digest)) {
    return invalidResponse("GHCR did not return an exact image digest");
  }
  return `${IMAGE}@${digest}` as RuntimeImageReference;
}

async function readTokenOwner(fetchImpl: typeof fetch, githubToken: string) {
  const response = await request(fetchImpl, GITHUB_USER_URL, {
    method: "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${githubToken}`,
      "user-agent": "OpenScholar",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (response.status === 401 || response.status === 403) {
    throw new RuntimeImageRegistryError(
      "REGISTRY_AUTHENTICATION_FAILED",
      "GitHub rejected the runtime registry token",
    );
  }
  if (response.status !== 200) {
    throw new RuntimeImageRegistryError(
      "REGISTRY_UNAVAILABLE",
      "The runtime registry token owner could not be read",
    );
  }
  const body = await readJson(response);
  const login = isRecord(body) ? body.login : undefined;
  if (typeof login !== "string" || !GITHUB_LOGIN.test(login)) {
    return invalidResponse("GitHub returned an invalid token owner");
  }
  return login;
}

async function exchangeBearerToken(
  fetchImpl: typeof fetch,
  githubToken: string,
  login: string,
  challenge: BearerChallenge,
) {
  const tokenUrl = new URL(challenge.realm);
  tokenUrl.searchParams.set("service", challenge.service);
  tokenUrl.searchParams.set("scope", challenge.scope);
  const response = await request(fetchImpl, tokenUrl, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Basic ${btoa(`${login}:${githubToken}`)}`,
      "user-agent": "OpenScholar",
    },
  });
  if (response.status === 401 || response.status === 403) {
    throw new RuntimeImageRegistryError(
      "REGISTRY_AUTHENTICATION_FAILED",
      "GHCR rejected the runtime registry token",
    );
  }
  if (response.status !== 200) {
    throw new RuntimeImageRegistryError(
      "REGISTRY_UNAVAILABLE",
      "GHCR could not issue a pull token",
    );
  }
  const body = await readJson(response);
  const token = isRecord(body) ? (body.token ?? body.access_token) : undefined;
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > 16_384
  ) {
    return invalidResponse("GHCR returned an invalid pull token");
  }
  return token;
}

export async function resolveRuntimeImage(input: {
  commit: string;
  githubToken: string;
  fetchImpl?: typeof fetch;
}): Promise<RuntimeImageReference | null> {
  if (!COMMIT.test(input.commit)) {
    throw new RuntimeImageRegistryError(
      "REGISTRY_INVALID_COMMIT",
      "The runtime release commit is invalid",
    );
  }
  const githubToken = input.githubToken.trim();
  if (!githubToken) {
    throw new RuntimeImageRegistryError(
      "GITHUB_TOKEN_MISSING",
      "GITHUB_TOKEN is not configured",
    );
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const manifestUrl = new URL(
    `/v2/${REPOSITORY}/manifests/${input.commit}`,
    REGISTRY_ORIGIN,
  );
  const manifestHeaders = {
    accept: MANIFEST_ACCEPT,
    "user-agent": "OpenScholar",
  };
  const anonymous = await request(fetchImpl, manifestUrl, {
    method: "HEAD",
    headers: manifestHeaders,
  });
  if (anonymous.status === 200) return digestFrom(anonymous);
  if (anonymous.status === 404) return null;
  if (anonymous.status !== 401) {
    throw new RuntimeImageRegistryError(
      "REGISTRY_UNAVAILABLE",
      "The runtime image could not be checked",
    );
  }

  const challenge = parseRegistryChallenge(
    anonymous.headers.get("www-authenticate"),
  );
  const login = await readTokenOwner(fetchImpl, githubToken);
  const bearer = await exchangeBearerToken(
    fetchImpl,
    githubToken,
    login,
    challenge,
  );
  const authenticated = await request(fetchImpl, manifestUrl, {
    method: "HEAD",
    headers: { ...manifestHeaders, authorization: `Bearer ${bearer}` },
  });
  if (authenticated.status === 404) return null;
  if (authenticated.status === 401 || authenticated.status === 403) {
    throw new RuntimeImageRegistryError(
      "REGISTRY_AUTHENTICATION_FAILED",
      "GHCR rejected the runtime image request",
    );
  }
  if (authenticated.status !== 200) {
    throw new RuntimeImageRegistryError(
      "REGISTRY_UNAVAILABLE",
      "The runtime image could not be checked",
    );
  }
  return digestFrom(authenticated);
}
