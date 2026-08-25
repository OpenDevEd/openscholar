"use node";

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
