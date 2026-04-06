import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ConvexError } from "convex/values";
import { createMockMutationDef, createMockMutationCtx, createMockIdentity } from "./factories";
import type { MutationCtx } from "../convex/_generated/server";

// Mock _generated/server so mutation() returns the definition object directly,
// giving us access to the .handler function
vi.mock("../convex/_generated/server", () => createMockMutationDef());

// Mock createUserWithDefaults and repairUserBillingRecords to track calls
vi.mock("../convex/lib/userCreation", () => ({
  createUserWithDefaults: vi.fn().mockResolvedValue("new_user_id"),
  repairUserBillingRecords: vi.fn().mockResolvedValue({ creditsCreated: false, subscriptionCreated: false }),
}));

// Mock createError -- must import the real one since handler calls it directly
// (not mocked -- we need the actual ConvexError construction)

import { createUserWithDefaults } from "../convex/lib/userCreation";
import { ensureUser } from "../convex/users/mutations";

const mockCreateUserWithDefaults = vi.mocked(createUserWithDefaults);

// Access handler directly since mutation is mocked to return definition
const ensureUserDef = ensureUser as unknown as { handler: (ctx: MutationCtx, args: Record<string, unknown>) => Promise<string> };
const ensureUserHandler = ensureUserDef.handler;

const mockIdentity = createMockIdentity({
  subject: "clerk_123",
  email: "new@example.com",
  givenName: "New",
  familyName: "User",
  pictureUrl: "https://example.com/avatar.jpg",
});

function createMockCtx(
  identity: ReturnType<typeof createMockIdentity> | null,
  existingUser: Record<string, unknown> | null,
) {
  return createMockMutationCtx({
    auth: { getUserIdentity: vi.fn().mockResolvedValue(identity) },
    db: {
      query: vi.fn().mockReturnValue({
        withIndex: vi.fn().mockReturnValue({
          unique: vi.fn().mockResolvedValue(existingUser),
        }),
      }),
      patch: vi.fn(),
      insert: vi.fn().mockResolvedValue("mock_id"),
      get: vi.fn(),
    },
  });
}

describe("ensureUser", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    mockCreateUserWithDefaults.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates new user on first login via createUserWithDefaults", async () => {
    const ctx = createMockCtx(mockIdentity, null);

    const result = await ensureUserHandler(ctx, {});

    expect(mockCreateUserWithDefaults).toHaveBeenCalledWith(ctx, {
      clerkId: "clerk_123",
      email: "new@example.com",
      firstName: "New",
      lastName: "User",
      avatarUrl: "https://example.com/avatar.jpg",
    });
    expect(result).toBe("new_user_id");
  });

  it("updates lastLoginAt on return visit", async () => {
    const existingUser = {
      _id: "existing_user_id",
      state: "active",
      clerkId: "clerk_123",
      email: "existing@example.com",
      firstName: "Existing",
      lastName: "User",
      avatarUrl: "https://example.com/old-avatar.jpg",
    };
    const ctx = createMockCtx(mockIdentity, existingUser);

    const result = await ensureUserHandler(ctx, {});

    expect(ctx.db.patch).toHaveBeenCalledWith("users", "existing_user_id", expect.objectContaining({
      lastLoginAt: expect.any(Number),
    }));
    expect(mockCreateUserWithDefaults).not.toHaveBeenCalled();
    expect(result).toBe("existing_user_id");
  });

  it("does not overwrite existing profile fields on return visit", async () => {
    const existingUser = {
      _id: "existing_user_id",
      state: "active",
      clerkId: "clerk_123",
      email: "existing@example.com",
      firstName: "Existing",
      lastName: "User",
      avatarUrl: "https://example.com/old-avatar.jpg",
    };
    const ctx = createMockCtx(mockIdentity, existingUser);

    await ensureUserHandler(ctx, {});

    const patchCalls = vi.mocked(ctx.db.patch).mock.calls[0] as unknown[];
    const patchArg = patchCalls[2];
    expect(patchArg).not.toHaveProperty("email");
    expect(patchArg).not.toHaveProperty("firstName");
    expect(patchArg).not.toHaveProperty("lastName");
    expect(patchArg).not.toHaveProperty("avatarUrl");
  });

  it("patches blank profile fields from identity on return visit", async () => {
    const existingUser = {
      _id: "existing_user_id",
      state: "active",
      clerkId: "clerk_123",
      email: "",
      firstName: undefined,
      lastName: undefined,
      avatarUrl: undefined,
    };
    const ctx = createMockCtx(mockIdentity, existingUser);

    await ensureUserHandler(ctx, {});

    const patchCalls = vi.mocked(ctx.db.patch).mock.calls[0] as unknown[];
    const patchArg = patchCalls[2] as Record<string, unknown>;
    expect(patchArg.email).toBe("new@example.com");
    expect(patchArg.firstName).toBe("New");
    expect(patchArg.lastName).toBe("User");
    expect(patchArg.avatarUrl).toBe("https://example.com/avatar.jpg");
  });

  it("sets updatedAt only when profile fields are patched", async () => {
    // Case 1: blank fields -> updatedAt should be set
    const userWithBlanks = {
      _id: "user1",
      state: "active",
      clerkId: "clerk_123",
      email: "",
      firstName: undefined,
      lastName: undefined,
      avatarUrl: undefined,
    };
    const ctx1 = createMockCtx(mockIdentity, userWithBlanks);
    await ensureUserHandler(ctx1, {});
    const patch1Calls = vi.mocked(ctx1.db.patch).mock.calls[0] as unknown[];
    const patch1 = patch1Calls[2];
    expect(patch1).toHaveProperty("updatedAt");

    // Case 2: all filled -> updatedAt should NOT be set
    const userAllFilled = {
      _id: "user2",
      state: "active",
      clerkId: "clerk_123",
      email: "existing@example.com",
      firstName: "Existing",
      lastName: "User",
      avatarUrl: "https://example.com/avatar.jpg",
    };
    const ctx2 = createMockCtx(mockIdentity, userAllFilled);
    await ensureUserHandler(ctx2, {});
    const patch2Calls = vi.mocked(ctx2.db.patch).mock.calls[0] as unknown[];
    const patch2 = patch2Calls[2];
    expect(patch2).not.toHaveProperty("updatedAt");
  });

  it("throws FORBIDDEN for suspended existing user", async () => {
    const suspendedUser = {
      _id: "user1",
      state: "suspended",
      clerkId: "clerk_123",
      email: "test@example.com",
    };
    const ctx = createMockCtx(mockIdentity, suspendedUser);

    try {
      await ensureUserHandler(ctx, {});
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      const convexErr = err as ConvexError<{ code: string; message: string }>;
      expect(convexErr.data.code).toBe("FORBIDDEN");
      expect(convexErr.data.message).toBe("Account suspended");
    }
  });

  it("throws FORBIDDEN for deleted existing user", async () => {
    const deletedUser = {
      _id: "user1",
      state: "deleted",
      clerkId: "clerk_123",
      email: "test@example.com",
    };
    const ctx = createMockCtx(mockIdentity, deletedUser);

    try {
      await ensureUserHandler(ctx, {});
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      const convexErr = err as ConvexError<{ code: string; message: string }>;
      expect(convexErr.data.code).toBe("FORBIDDEN");
      expect(convexErr.data.message).toBe("Account deleted");
    }
  });

  it("throws UNAUTHENTICATED when no identity", async () => {
    const ctx = createMockCtx(null, null);

    try {
      await ensureUserHandler(ctx, {});
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      const convexErr = err as ConvexError<{ code: string }>;
      expect(convexErr.data.code).toBe("UNAUTHENTICATED");
    }
  });
});
