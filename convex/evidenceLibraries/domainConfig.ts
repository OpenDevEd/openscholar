/**
 * Platform settings for custom domains. Read from the environment so the
 * target name is kept outside the domain workflow so infrastructure can move
 * without changing the records owners are shown.
 */

export const CUSTOM_DOMAIN_TARGET_ENV = "EL_CUSTOM_DOMAIN_TARGET";
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
