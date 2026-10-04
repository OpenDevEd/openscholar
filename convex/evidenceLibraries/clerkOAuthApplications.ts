// Clerk's Backend API for OAuth applications: the client each Evidence
// Library signs readers and admins in with. Plain fetch, no Convex imports, so
// any action can call it.

const CLERK_API = "https://api.clerk.com/v1";
const REQUEST_TIMEOUT_MS = 15_000;
const LIST_PAGE_SIZE = 100;

export type ClerkOAuthApplication = {
  id: string;
  name: string;
  clientId: string;
  redirectUris: string[];
  discoveryUrl: string;
};

export class ClerkApiError extends Error {
  constructor(
    message: string,
    /** Clerk's HTTP status, or undefined when Clerk could not be reached. */
    readonly status: number | undefined,
    readonly code: string | undefined,
    readonly traceId: string | undefined,
  ) {
    super(message);
    this.name = "ClerkApiError";
  }

  /** Worth trying again later: Clerk was unreachable or failed on its side. */
  get retryable() {
    return this.status === undefined || this.status === 429 || this.status >= 500;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function clerkRequest(
  secretKey: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${CLERK_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ClerkApiError(
      `Clerk could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      undefined,
      undefined,
      undefined,
    );
  }
  const parsed: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const firstError =
      isRecord(parsed) && Array.isArray(parsed.errors) && isRecord(parsed.errors[0])
        ? parsed.errors[0]
        : null;
    throw new ClerkApiError(
      `Clerk answered ${response.status} to ${method} ${path.split("?")[0]}`,
      response.status,
      typeof firstError?.code === "string" ? firstError.code : undefined,
      isRecord(parsed) && typeof parsed.clerk_trace_id === "string" ? parsed.clerk_trace_id : undefined,
    );
  }
  return { status: response.status, body: parsed };
}

function readApplication(value: unknown): ClerkOAuthApplication {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.client_id !== "string" ||
    !Array.isArray(value.redirect_uris) ||
    !value.redirect_uris.every((uri) => typeof uri === "string") ||
    typeof value.discovery_url !== "string"
  ) {
    throw new ClerkApiError("Clerk answered with an unexpected OAuth application", 200, undefined, undefined);
  }
  return {
    id: value.id,
    name: value.name,
    clientId: value.client_id,
    redirectUris: value.redirect_uris as string[],
    discoveryUrl: value.discovery_url,
  };
}

function readSecret(value: unknown): string {
  if (!isRecord(value) || typeof value.client_secret !== "string" || !value.client_secret) {
    throw new ClerkApiError("Clerk answered without a client secret", 200, undefined, undefined);
  }
  return value.client_secret;
}

/** Every OAuth application named `name`; Clerk does not enforce unique names. */
export async function findOAuthApplicationsByName(secretKey: string, name: string) {
  const found: ClerkOAuthApplication[] = [];
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const { body } = await clerkRequest(
      secretKey,
      "GET",
      `/oauth_applications?limit=${LIST_PAGE_SIZE}&offset=${offset}`,
    );
    const page = isRecord(body) && Array.isArray(body.data) ? body.data : null;
    if (!page) {
      throw new ClerkApiError("Clerk answered with an unexpected OAuth application list", 200, undefined, undefined);
    }
    for (const item of page) {
      if (isRecord(item) && item.name === name) found.push(readApplication(item));
    }
    if (page.length < LIST_PAGE_SIZE) return found;
  }
}

/**
 * A confidential client with PKCE and no consent screen: the library is part
 * of OpenScholar, so readers are not asked to approve it.
 */
export async function createOAuthApplication(
  secretKey: string,
  input: { name: string; redirectUris: string[] },
) {
  const { body } = await clerkRequest(secretKey, "POST", "/oauth_applications", {
    name: input.name,
    redirect_uris: input.redirectUris,
    scopes: "openid email profile offline_access",
    public: false,
    consent_screen_enabled: false,
    pkce_required: true,
  });
  return { application: readApplication(body), clientSecret: readSecret(body) };
}

/** Clerk shows a secret only once, so an adopted application gets a new one. */
export async function rotateOAuthApplicationSecret(secretKey: string, applicationId: string) {
  const { body } = await clerkRequest(
    secretKey,
    "POST",
    `/oauth_applications/${encodeURIComponent(applicationId)}/rotate_secret`,
  );
  return readSecret(body);
}

/** The application as Clerk has it now, or null when Clerk no longer has it. */
export async function readOAuthApplication(secretKey: string, applicationId: string) {
  try {
    const { body } = await clerkRequest(secretKey, "GET", `/oauth_applications/${encodeURIComponent(applicationId)}`);
    return readApplication(body);
  } catch (error) {
    if (error instanceof ClerkApiError && error.status === 404) return null;
    throw error;
  }
}

export async function setOAuthApplicationRedirectUris(
  secretKey: string,
  applicationId: string,
  redirectUris: string[],
) {
  const { body } = await clerkRequest(
    secretKey,
    "PATCH",
    `/oauth_applications/${encodeURIComponent(applicationId)}`,
    { redirect_uris: redirectUris },
  );
  return readApplication(body);
}

/** Deleting an application that is already gone is not an error. */
export async function deleteOAuthApplication(secretKey: string, applicationId: string) {
  try {
    await clerkRequest(secretKey, "DELETE", `/oauth_applications/${encodeURIComponent(applicationId)}`);
  } catch (error) {
    if (error instanceof ClerkApiError && error.status === 404) return;
    throw error;
  }
}

/**
 * Where this Clerk instance issues tokens and keeps its account pages, read
 * from its primary domain. A library verifies OpenScholar's tokens against the
 * first and sends readers to the second to change their name or picture.
 */
export async function readClerkInstanceUrls(secretKey: string) {
  const { body } = await clerkRequest(secretKey, "GET", "/domains");
  const domains = isRecord(body) && Array.isArray(body.data) ? body.data : [];
  const primary = domains.find((domain) => isRecord(domain) && domain.is_satellite === false);
  if (
    !isRecord(primary) ||
    typeof primary.frontend_api_url !== "string" ||
    typeof primary.accounts_portal_url !== "string"
  ) {
    throw new ClerkApiError("Clerk answered without a primary domain", 200, undefined, undefined);
  }
  return {
    issuer: new URL(primary.frontend_api_url).origin,
    accountUrl: new URL("/user", primary.accounts_portal_url).toString(),
  };
}
