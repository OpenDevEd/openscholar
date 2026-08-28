/**
 * Platform settings for custom domains. Read from the environment so the
 * target name and the Cloudflare account are never written into the code.
 */

export const CUSTOM_DOMAIN_TARGET_ENV = "EL_CUSTOM_DOMAIN_TARGET";
export const CLOUDFLARE_API_TOKEN_ENV = "EL_CLOUDFLARE_API_TOKEN";
export const CLOUDFLARE_ZONE_ID_ENV = "EL_CLOUDFLARE_ZONE_ID";

/** The name every custom domain points at. One name for the whole platform. */
export const DEFAULT_CUSTOM_DOMAIN_TARGET = "cname.openscholar.ai";

/** Where the ownership record lives, and what it holds. */
export const VERIFICATION_RECORD_PREFIX = "_openscholar";
export const VERIFICATION_VALUE_PREFIX = "os-verify=";

type Environment = Readonly<Record<string, string | undefined>>;

export function readCustomDomainTarget(env: Environment = process.env): string {
  return (
    env[CUSTOM_DOMAIN_TARGET_ENV]?.trim().toLowerCase().replace(/\.$/u, "") ||
    DEFAULT_CUSTOM_DOMAIN_TARGET
  );
}

/**
 * Custom domains only work once the platform's Cloudflare account is set up.
 * Without it the Domain section says so and adds nothing.
 */
export function isCustomDomainPlatformReady(
  env: Environment = process.env,
): boolean {
  return Boolean(
    env[CLOUDFLARE_API_TOKEN_ENV]?.trim() && env[CLOUDFLARE_ZONE_ID_ENV]?.trim(),
  );
}

export function verificationRecordName(host: string): string {
  return `${VERIFICATION_RECORD_PREFIX}.${host}`;
}

export function verificationRecordValue(token: string): string {
  return `${VERIFICATION_VALUE_PREFIX}${token}`;
}
