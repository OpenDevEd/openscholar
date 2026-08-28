/**
 * Platform settings for custom domains. Read from the environment so the
 * target name and the Cloudflare account are never written into the code.
 */

export const CUSTOM_DOMAIN_TARGET_ENV = "EL_CUSTOM_DOMAIN_TARGET";
export const CLOUDFLARE_API_TOKEN_ENV = "EL_CLOUDFLARE_API_TOKEN";
export const CLOUDFLARE_ZONE_ID_ENV = "EL_CLOUDFLARE_ZONE_ID";
/** Extra names nobody may claim, beyond the target and the platform domain. */
export const RESERVED_DOMAIN_SUFFIXES_ENV = "EL_RESERVED_DOMAIN_SUFFIXES";

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
  const account = readCloudflareAccount(env);
  return account !== null;
}

/**
 * The platform's certificate account, or null when it is not set up. One
 * place reads it, so the section, the actions and the teardown all agree.
 */
export function readCloudflareAccount(
  env: Environment = process.env,
): { apiToken: string; zoneId: string } | null {
  const apiToken = env[CLOUDFLARE_API_TOKEN_ENV]?.trim();
  const zoneId = env[CLOUDFLARE_ZONE_ID_ENV]?.trim();
  if (!apiToken || !zoneId) return null;
  return { apiToken, zoneId };
}

/**
 * The platform's own domains. A custom domain may not be one of these or sit
 * beneath one: the CNAME target's registrable domain, and the domain every
 * library's platform address lives on.
 */
export function readReservedDomainSuffixes(
  env: Environment = process.env,
): string[] {
  // Named, never guessed. Taking "the last two labels" of the target would
  // call `co.uk` a domain of ours, and would miss a target whose own domain
  // has more parts. The platform says which names are its own.
  const named = (env[RESERVED_DOMAIN_SUFFIXES_ENV] ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/\.$/u, ""))
    .filter(Boolean);
  const platformDomain = env.EVIDENCE_LIBRARY_PLATFORM_DOMAIN?.trim()
    .toLowerCase()
    .replace(/\.$/u, "");
  return [
    readCustomDomainTarget(env),
    ...named,
    ...(platformDomain ? [platformDomain] : []),
  ].filter(Boolean);
}

export function verificationRecordName(host: string): string {
  return `${VERIFICATION_RECORD_PREFIX}.${host}`;
}

export function verificationRecordValue(token: string): string {
  return `${VERIFICATION_VALUE_PREFIX}${token}`;
}
