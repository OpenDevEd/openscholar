import type { FullConfig } from "@playwright/test";
import { clerkSetup } from "@clerk/testing/playwright";
import { createClerkClient } from "@clerk/backend";
import path from "node:path";
import { accessSync, constants } from "node:fs";

function loadEnvironmentFromFiles(): void {
  const loadEnvFile = (process as typeof process & {
    loadEnvFile?: (file?: string) => void;
  }).loadEnvFile;

  if (typeof loadEnvFile !== "function") {
    return;
  }

  for (const envFile of [".env.local", ".env"]) {
    const absolutePath = path.resolve(process.cwd(), envFile);
    try {
      accessSync(absolutePath, constants.F_OK);
      loadEnvFile(absolutePath);
    } catch {
      // Ignore missing env files in CI/workflows that rely on injected env vars.
    }
  }
}

function normalizeClerkTestingEnv(): void {
  const publishableKey =
    process.env.CLERK_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    throw new Error(
      "Missing required E2E environment variable: CLERK_PUBLISHABLE_KEY (or NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).",
    );
  }

  process.env.CLERK_PUBLISHABLE_KEY = publishableKey;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required E2E environment variable: ${name}`);
  }
  return value;
}

async function ensureDisposableClerkUser(): Promise<void> {
  const secretKey = requireEnv("CLERK_SECRET_KEY");
  const email = requireEnv("E2E_CLERK_USER_EMAIL");
  const password = requireEnv("E2E_CLERK_USER_PASSWORD");

  const clerkClient = createClerkClient({ secretKey });
  const existing = await clerkClient.users.getUserList({
    emailAddress: [email],
    limit: 100,
  });

  const primary = existing.data[0] ?? null;
  const extras = existing.data.slice(1);

  for (const extra of extras) {
    await clerkClient.users.deleteUser(extra.id);
  }

  if (!primary) {
    await clerkClient.users.createUser({
      emailAddress: [email],
      password,
      firstName: "E2E",
      lastName: "Auth",
      skipPasswordChecks: true,
      skipPasswordRequirement: true,
    });
    return;
  }

  await clerkClient.users.updateUser(primary.id, {
    password,
    skipPasswordChecks: true,
    signOutOfOtherSessions: true,
    firstName: primary.firstName ?? "E2E",
    lastName: primary.lastName ?? "Auth",
  });
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  loadEnvironmentFromFiles();
  normalizeClerkTestingEnv();
  await clerkSetup();
  await ensureDisposableClerkUser();
}
