// Default-runtime check used by save, activate, and restore mutations.
// The full mail settings are read by optionalPlatformMailService when the
// runtime configuration is assembled.
export function isPlatformMailConfigured(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return Boolean(env.EL_SMTP_HOST?.trim()) && Boolean(env.EL_SMTP_FROM?.trim());
}
