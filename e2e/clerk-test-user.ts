import { createClerkClient } from "@clerk/backend";
import { clerk } from "@clerk/testing/playwright";
import type { Page } from "@playwright/test";

export type ClerkTestUser = {
  id: string;
  email: string;
  password: string;
  organizationId: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getClerkClient() {
  return createClerkClient({
    secretKey: requireEnv("CLERK_SECRET_KEY"),
  });
}

export async function createDisposableClerkUser(args?: {
  prefix?: string;
  firstName?: string;
  lastName?: string;
}): Promise<ClerkTestUser> {
  const prefix = args?.prefix ?? "e2e";
  const organizationId = requireEnv("E2E_CLERK_ORGANIZATION_ID");
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `${prefix}-${uniqueId}+clerk_test@example.com`;
  const password = `E2E${prefix.replace(/[^a-z0-9]/gi, "")}${uniqueId}!`;
  const clerkClient = getClerkClient();

  const user = await clerkClient.users.createUser({
    emailAddress: [email],
    password,
    skipPasswordChecks: true,
    skipPasswordRequirement: true,
    firstName: args?.firstName ?? "E2E",
    lastName: args?.lastName ?? "User",
  });

  try {
    await clerkClient.organizations.createOrganizationMembership({
      organizationId,
      userId: user.id,
      role: "org:member",
    });
  } catch (error) {
    await clerkClient.users.deleteUser(user.id);
    throw error;
  }

  return {
    id: user.id,
    email,
    password,
    organizationId,
  };
}

export async function signInClerkTestUser(
  page: Page,
  user: ClerkTestUser,
): Promise<void> {
  await page.goto("/");
  await clerk.loaded({ page });
  await clerk.signIn({ page, emailAddress: user.email });
  await page.evaluate(async (organizationId) => {
    await window.Clerk.setActive({ organization: organizationId });
  }, user.organizationId);
}

export async function deleteClerkUser(userId: string): Promise<void> {
  await getClerkClient().users.deleteUser(userId);
}
