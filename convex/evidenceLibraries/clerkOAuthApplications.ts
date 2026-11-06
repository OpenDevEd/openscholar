// Clerk's Backend API for OAuth applications: the client each Evidence
// Library signs readers and admins in with, and the apps people build on
// Openscholar (convex/developerApps).

import { ClerkApiError, clerkRequest, isRecord } from "../lib/clerk";

const LIST_PAGE_SIZE = 100;

export type ClerkOAuthApplication = {
  id: string;
  name: string;
  clientId: string;
  redirectUris: string[];
  discoveryUrl: string;
};

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
 * A client with PKCE. A library's is confidential with no consent screen: the
 * library is part of OpenScholar, so readers are not asked to approve it. A
 * developer app asks for consent, and a browser app is public, with no secret.
 */
export async function createOAuthApplication(
  secretKey: string,
  input: { name: string; redirectUris: string[] },
): Promise<{ application: ClerkOAuthApplication; clientSecret: string }>;
export async function createOAuthApplication(
  secretKey: string,
  input: { name: string; redirectUris: string[]; public: boolean; consent: true },
): Promise<{ application: ClerkOAuthApplication; clientSecret: string | null }>;
export async function createOAuthApplication(
  secretKey: string,
  input: { name: string; redirectUris: string[]; public?: boolean; consent?: boolean },
) {
  const { body } = await clerkRequest(secretKey, "POST", "/oauth_applications", {
    name: input.name,
    redirect_uris: input.redirectUris,
    scopes: "openid email profile offline_access",
    public: input.public ?? false,
    consent_screen_enabled: input.consent ?? false,
    pkce_required: true,
  });
  return { application: readApplication(body), clientSecret: input.public ? null : readSecret(body) };
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

export async function updateOAuthApplication(
  secretKey: string,
  applicationId: string,
  changes: { redirectUris: string[]; name?: string },
) {
  const { body } = await clerkRequest(
    secretKey,
    "PATCH",
    `/oauth_applications/${encodeURIComponent(applicationId)}`,
    { redirect_uris: changes.redirectUris, ...(changes.name ? { name: changes.name } : {}) },
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
