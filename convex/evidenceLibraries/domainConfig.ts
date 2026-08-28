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

/**
 * The platform's own domains. A custom domain may not be one of these or sit
 * beneath one: the CNAME target's registrable domain, and the domain every
 * library's platform address lives on.
 */
export function readReservedDomainSuffixes(
  env: Environment = process.env,
): string[] {
  const target = readCustomDomainTarget(env);
  const labels = target.split(".");
  const registrable = labels.slice(-2).join(".");
  const platformDomain = env.EVIDENCE_LIBRARY_PLATFORM_DOMAIN?.trim()
    .toLowerCase()
    .replace(/\.$/u, "");
  return [target, registrable, ...(platformDomain ? [platformDomain] : [])].filter(
    Boolean,
  );
}

export function verificationRecordName(host: string): string {
  return `${VERIFICATION_RECORD_PREFIX}.${host}`;
}

export function verificationRecordValue(token: string): string {
  return `${VERIFICATION_VALUE_PREFIX}${token}`;
}
