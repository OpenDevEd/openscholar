/**
 * The platform's Cloudflare for SaaS account: one custom hostname per
 * attached domain.
 *
 * Cloudflare answers the customer's domain at its edge and issues and renews
 * the certificate, so the server's address never appears in any DNS answer
 * and the runtime never issues a certificate for a customer's name.
 *
 * Origin TLS. Each hostname is created with the library's own platform
 * address as its custom origin (`custom_origin_server`). Cloudflare's default
 * origin SNI is the custom origin's own name, so the runtime is asked for
 * the certificate it already has and answers with it; the customer's name
 * travels in the `Host` header, which is what the proxy routes on. The
 * explicit `custom_origin_sni` field only accepts `:request_host_header:` or
 * a name inside the platform zone, neither of which is what we want here, so
 * the field is left out on purpose.
 * https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/custom-origin/
 */

import {
  CLOUDFLARE_API_TOKEN_ENV,
  CLOUDFLARE_ZONE_ID_ENV,
} from "./domainConfig";

const API_ORIGIN = "https://api.cloudflare.com/client/v4";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 512 * 1024;

export class CloudflareSaasError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CloudflareSaasError";
    this.code = code;
  }
}

/** How far along the certificate for one custom hostname is. */
export type CertificateState = "pending" | "active" | "failed";

export type CustomHostname = {
  hostnameId: string;
  certificate: CertificateState;
  hostnameStatus: string;
  sslStatus: string;
  /** Where Cloudflare sends the request. Must be the library's own address. */
  originHost: string | null;
  validationErrors: string[];
};

// Cloudflare's certificate lifecycle. Anything that has stopped moving is a
// failure; anything still moving, including a status added after this was
// written, is treated as pending so a domain is never failed by surprise.
const FAILED_SSL_STATUS = new Set([
  "initializing_timed_out",
  "validation_timed_out",
  "issuance_timed_out",
  "deployment_timed_out",
  "deletion_timed_out",
  "expired",
  "deleted",
  "inactive",
]);

const FAILED_HOSTNAME_STATUS = new Set([
  "blocked",
  "moved",
  "deleted",
  "pending_deletion",
  "pending_blocked",
  "test_failed",
  "test_blocked",
]);

export function classifyCustomHostnameStatus(
  hostnameStatus: string,
  sslStatus: string,
): CertificateState {
  if (FAILED_HOSTNAME_STATUS.has(hostnameStatus)) return "failed";
  if (FAILED_SSL_STATUS.has(sslStatus)) return "failed";
  if (hostnameStatus === "active" && sslStatus === "active") return "active";
  return "pending";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new CloudflareSaasError(
    "CLOUDFLARE_INVALID_RESPONSE",
    "The certificate service returned an unexpected answer",
  );
}

function parseCustomHostname(payload: unknown): CustomHostname {
  if (!isRecord(payload) || typeof payload.id !== "string") invalid();
  const ssl = isRecord(payload.ssl) ? payload.ssl : {};
  const hostnameStatus =
    typeof payload.status === "string" ? payload.status : "pending";
  const sslStatus = typeof ssl.status === "string" ? ssl.status : "initializing";
  const errors: string[] = [];
  for (const key of ["validation_errors", "verification_errors"]) {
    const list = key === "validation_errors" ? ssl[key] : payload[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list.slice(0, 8)) {
      if (typeof entry === "string") errors.push(entry);
      else if (isRecord(entry) && typeof entry.message === "string") {
        errors.push(entry.message);
      }
    }
  }
  return {
    hostnameId: payload.id,
    certificate: classifyCustomHostnameStatus(hostnameStatus, sslStatus),
    hostnameStatus,
    sslStatus,
    originHost:
      typeof payload.custom_origin_server === "string"
        ? payload.custom_origin_server
        : null,
    validationErrors: errors,
  };
}

type Transport = {
  fetchImpl: typeof fetch;
  apiToken: string;
  zoneId: string;
};

async function request(
  transport: Transport,
  input: {
    method: "GET" | "POST" | "PATCH" | "DELETE";
    path: string;
    body?: Record<string, unknown>;
    /** A missing hostname is a normal answer for a delete. */
    allowNotFound?: boolean;
  },
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await transport.fetchImpl(new URL(input.path, `${API_ORIGIN}/`), {
        method: input.method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${transport.apiToken}`,
          ...(input.body ? { "content-type": "application/json" } : {}),
        },
        body: input.body ? JSON.stringify(input.body) : undefined,
        signal: controller.signal,
      });
    } catch {
      throw new CloudflareSaasError(
        "CLOUDFLARE_UNAVAILABLE",
        "The certificate service could not be reached",
      );
    }
    if (input.allowNotFound && response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) invalid();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      invalid();
    }
    if (!isRecord(payload) || typeof payload.success !== "boolean") invalid();
    if (!payload.success || response.status >= 400) {
      throw new CloudflareSaasError(
        "CLOUDFLARE_REQUEST_FAILED",
        "The certificate service refused that domain",
      );
    }
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

export function createCloudflareSaasClient(input: {
  apiToken: string;
  zoneId: string;
  fetchImpl?: typeof fetch;
}) {
  const apiToken = input.apiToken.trim();
  const zoneId = input.zoneId.trim();
  if (!apiToken || !zoneId) {
    throw new CloudflareSaasError(
      "CLOUDFLARE_NOT_CONFIGURED",
      "Custom domains are not set up on this platform yet",
    );
  }
  const transport: Transport = {
    fetchImpl: input.fetchImpl ?? fetch,
    apiToken,
    zoneId,
  };
  const base = `zones/${encodeURIComponent(zoneId)}/custom_hostnames`;

  return {
    /**
     * Registers the customer's domain in the platform's zone. HTTP
     * validation is used: the domain already points at Cloudflare by the
     * time this runs, so the challenge answers itself.
     */
    async createCustomHostname(hostname: {
      host: string;
      originHost: string;
    }): Promise<CustomHostname> {
      return parseCustomHostname(
        await request(transport, {
          method: "POST",
          path: base,
          body: {
            hostname: hostname.host,
            custom_origin_server: hostname.originHost,
            ssl: {
              method: "http",
              type: "dv",
              bundle_method: "ubiquitous",
              wildcard: false,
              settings: { min_tls_version: "1.2" },
            },
          },
        }),
      );
    },

    /** The hostname as Cloudflare holds it, or null when it is not there. */
    async readCustomHostname(host: string): Promise<CustomHostname | null> {
      const result = await request(transport, {
        method: "GET",
        path: `${base}?hostname=${encodeURIComponent(host)}&per_page=5`,
      });
      if (!Array.isArray(result)) invalid();
      const match = result.find(
        (entry) => isRecord(entry) && entry.hostname === host,
      );
      return match ? parseCustomHostname(match) : null;
    },

    /** Points an existing hostname at the right library. */
    async setCustomHostnameOrigin(input: {
      hostnameId: string;
      originHost: string;
    }): Promise<CustomHostname> {
      return parseCustomHostname(
        await request(transport, {
          method: "PATCH",
          path: `${base}/${encodeURIComponent(input.hostnameId)}`,
          body: { custom_origin_server: input.originHost },
        }),
      );
    },

    async deleteCustomHostname(hostnameId: string): Promise<void> {
      await request(transport, {
        method: "DELETE",
        path: `${base}/${encodeURIComponent(hostnameId)}`,
        allowNotFound: true,
      });
    },
  };
}

export type CloudflareSaasClient = ReturnType<typeof createCloudflareSaasClient>;

/**
 * The platform's Cloudflare account, or null when it has not been set up.
 * Everything about custom domains is switched off in that case.
 */
export function createPlatformCloudflareSaasClient(
  fetchImpl?: typeof fetch,
): CloudflareSaasClient | null {
  const apiToken = process.env[CLOUDFLARE_API_TOKEN_ENV]?.trim();
  const zoneId = process.env[CLOUDFLARE_ZONE_ID_ENV]?.trim();
  if (!apiToken || !zoneId) return null;
  return createCloudflareSaasClient({ apiToken, zoneId, fetchImpl });
}
