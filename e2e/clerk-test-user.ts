import { createClerkClient } from "@clerk/backend";

export type ClerkTestUser = {
  id: string;
  email: string;
  password: string;
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
  organizationId?: string;
}): Promise<ClerkTestUser> {
  const prefix = args?.prefix ?? "e2e";
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `${prefix}-${uniqueId}@test.example.com`;
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

  if (args?.organizationId) {
    try {
      await clerkClient.organizations.createOrganizationMembership({
        organizationId: args.organizationId,
        userId: user.id,
        role: "org:member",
      });
    } catch (error) {
      await clerkClient.users.deleteUser(user.id);
      throw error;
    }
  }

  return {
    id: user.id,
    email,
    password,
  };
}

export async function deleteClerkUser(userId: string): Promise<void> {
  await getClerkClient().users.deleteUser(userId);
}
