"use node";
import { z } from "zod";

import {
  platformEmbeddingKey,
  PLATFORM_EMBEDDING_KEY_MISSING_MESSAGE,
} from "../../lib/evidence-libraries/configuration/ai";
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
  if (!z.email().safeParse(from).success) throw createError("EL_SMTP_FROM must be a bare email address");
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

// The OpenScholar logo and browser icon set used when an owner uploads nothing.
// Returns undefined when none are set; assembly then refuses a library without
// its own uploads. All three values must be set together.
export function optionalPlatformBrandAssets(
  createError: ErrorFactory,
): PlatformBrandAssets | undefined {
  const logoUrl = optionalRuntimeEnvironment("EL_DEFAULT_LOGO_URL");
  const faviconUrl = optionalRuntimeEnvironment("EL_DEFAULT_FAVICON_URL");
  const iconUrlsJson = optionalRuntimeEnvironment("EL_DEFAULT_ICON_URLS_JSON");
  if (!logoUrl && !faviconUrl && !iconUrlsJson) return undefined;
  if (!logoUrl || !faviconUrl || !iconUrlsJson) {
    throw createError(
      "EL_DEFAULT_LOGO_URL, EL_DEFAULT_FAVICON_URL, and EL_DEFAULT_ICON_URLS_JSON must be set together",
    );
  }
  let iconUrls: unknown;
  try {
    iconUrls = JSON.parse(iconUrlsJson);
  } catch {
    throw createError("EL_DEFAULT_ICON_URLS_JSON must be a JSON array of URLs");
  }
  if (
    !Array.isArray(iconUrls) ||
    iconUrls.length === 0 ||
    iconUrls.some((value) => typeof value !== "string" || value.trim() === "")
  ) {
    throw createError("EL_DEFAULT_ICON_URLS_JSON must be a non-empty JSON array of URLs");
  }
  return { logoUrl, faviconUrl, iconUrls };
}

// The key that pays for meaning-based search. A separate embedding key keeps
// that spend apart from answer spend; without one the shared OpenRouter key
// is used. Returns undefined when neither is set, and assembly then refuses
// to publish a library with AI answers on.
export function optionalPlatformEmbeddingKey(): string | undefined {
  return platformEmbeddingKey(process.env);
}

/**
 * Raised before a library with AI answers on creates or changes anything.
 * Its own class so the pipelines can report the owner-readable reason instead
 * of their generic "setup failed" message.
 */
export class PlatformEmbeddingKeyMissingError extends Error {
  readonly code = "PLATFORM_EMBEDDING_KEY_MISSING";

  constructor() {
    super(PLATFORM_EMBEDDING_KEY_MISSING_MESSAGE);
    this.name = "PlatformEmbeddingKeyMissingError";
  }
}

/**
 * Search by meaning needs the platform embedding key. Both pipelines check it
 * before their first outside call, so a library with AI answers on never
 * creates a database, a bucket or a Coolify application it cannot use.
 */
export function requirePlatformEmbeddingKey(aiEnabled: boolean): void {
  if (aiEnabled && !optionalPlatformEmbeddingKey()) {
    throw new PlatformEmbeddingKeyMissingError();
  }
}
