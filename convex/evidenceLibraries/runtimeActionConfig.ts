"use node";

import type {
  PlatformBrandAssets,
  PlatformMailService,
} from "../../lib/evidence-libraries/configuration/assembly";

type ErrorFactory = (message: string) => Error;

export function requireRuntimeEnvironment(
  name: string,
  createError: ErrorFactory,
): string {
  const value = process.env[name]?.trim();
  if (!value) throw createError(`${name} is not configured`);
  return value;
}

export function optionalRuntimeEnvironment(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export function requirePositiveRuntimeInteger(
  name: string,
  createError: ErrorFactory,
): number {
  const value = Number(requireRuntimeEnvironment(name, createError));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw createError(`${name} must be a positive integer`);
  }
  return value;
}

export function requireRuntimeHttpsOrigin(
  name: string,
  createError: ErrorFactory,
): string {
  const value = requireRuntimeEnvironment(name, createError);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw createError(`${name} must be a valid HTTPS origin`);
  }
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw createError(`${name} must be a valid HTTPS origin`);
  }
  return url.origin;
}

const MAIL_SECURITY = ["tls", "starttls", "none"] as const;

// The platform mail service used for contact and takedown emails. Returns
// undefined when EL_SMTP_HOST is not set, so libraries without recipients
// still deploy. Once a host is set, the sender and matching credentials
// must be complete.
export function optionalPlatformMailService(
  createError: ErrorFactory,
): PlatformMailService | undefined {
  const host = optionalRuntimeEnvironment("EL_SMTP_HOST");
  if (!host) return undefined;
  const from = requireRuntimeEnvironment("EL_SMTP_FROM", createError);
  const port = optionalRuntimeEnvironment("EL_SMTP_PORT")
    ? requirePositiveRuntimeInteger("EL_SMTP_PORT", createError)
    : 587;
  if (port > 65_535) {
    throw createError("EL_SMTP_PORT must be a port number between 1 and 65535");
  }
  const security = optionalRuntimeEnvironment("EL_SMTP_SECURITY") ?? "starttls";
  if (!(MAIL_SECURITY as readonly string[]).includes(security)) {
    throw createError("EL_SMTP_SECURITY must be tls, starttls, or none");
  }
  const username = optionalRuntimeEnvironment("EL_SMTP_USERNAME");
  const password = optionalRuntimeEnvironment("EL_SMTP_PASSWORD");
  if (Boolean(username) !== Boolean(password)) {
    throw createError(
      "EL_SMTP_USERNAME and EL_SMTP_PASSWORD must be set together",
    );
  }
  return {
    host,
    port,
    security: security as PlatformMailService["security"],
    from,
    ...(username && password ? { username, password } : {}),
  };
}

// The OpenScholar logo and favicon used when an owner uploads nothing.
// Returns undefined when neither value is set; assembly then refuses a
// library without its own uploads. Both must be set together.
export function optionalPlatformBrandAssets(
  createError: ErrorFactory,
): PlatformBrandAssets | undefined {
  const logoUrl = optionalRuntimeEnvironment("EL_DEFAULT_LOGO_URL");
  const faviconUrl = optionalRuntimeEnvironment("EL_DEFAULT_FAVICON_URL");
  if (!logoUrl && !faviconUrl) return undefined;
  if (!logoUrl || !faviconUrl) {
    throw createError(
      "EL_DEFAULT_LOGO_URL and EL_DEFAULT_FAVICON_URL must be set together",
    );
  }
  return { logoUrl, faviconUrl };
}
