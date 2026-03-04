import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { MutationCtx } from "../convex/_generated/server";
import type { Id } from "../convex/_generated/dataModel";
import { createMockMutationDef, mockId } from "./factories";

// Use vi.hoisted to create mock values before vi.mock factories are hoisted
const { mockUser, mockRequireAuth } = vi.hoisted(() => {
  const mockUser = {
    _id: "mock_users_123" as unknown as Id<"users">,
    _creationTime: 0,
    state: "active" as const,
    clerkId: "clerk_123",
    email: "",
    firstName: undefined as string | undefined,
    lastName: undefined as string | undefined,
    avatarUrl: undefined as string | undefined,
    createdAt: 0,
    updatedAt: 0,
    lastLoginAt: 0,
  };
  const mockRequireAuth = vi.fn().mockResolvedValue(mockUser);
  return { mockUser, mockRequireAuth };
});

// Mock _generated/server so mutation() returns the definition object directly
vi.mock("../convex/_generated/server", () => createMockMutationDef());

// Mock requireAuth to return the hoisted mockUser
vi.mock("../convex/lib/auth", () => ({
  requireAuth: mockRequireAuth,
}));

import { syncProfileFromSession } from "../convex/users/mutations";

// Access handler directly since mutation is mocked to return definition
const syncDef = syncProfileFromSession as unknown as { handler: (ctx: MutationCtx, args: Record<string, unknown>) => Promise<null> };
const syncHandler = syncDef.handler;

function createMockCtx() {
  return {
    auth: { getUserIdentity: vi.fn() },
    db: {
      patch: vi.fn(),
      query: vi.fn(),
      insert: vi.fn(),
      get: vi.fn(),
    },
  } as unknown as MutationCtx & { db: { patch: ReturnType<typeof vi.fn> } };
}

describe("syncProfileFromSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
    // Reset mockUser to default blank state
    Object.assign(mockUser, {
      _id: "mock_users_123",
      state: "active",
      clerkId: "clerk_123",
      email: "",
      firstName: undefined,
      lastName: undefined,
      avatarUrl: undefined,
    });
    mockRequireAuth.mockResolvedValue(mockUser);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("patches only blank email field", async () => {
    mockUser.email = "";
    const ctx = createMockCtx();

    await syncHandler(ctx, { email: "new@example.com" });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "mock_users_123",
      expect.objectContaining({ email: "new@example.com" })
    );
  });

  it("preserves existing non-empty email", async () => {
    mockUser.email = "existing@example.com";
    const ctx = createMockCtx();

    await syncHandler(ctx, { email: "new@example.com" });

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("patches blank firstName and lastName", async () => {
    mockUser.firstName = undefined;
    mockUser.lastName = undefined;
    const ctx = createMockCtx();

    await syncHandler(ctx, { firstName: "Test", lastName: "User" });

    const patchArg = ctx.db.patch.mock.calls[0][1];
    expect(patchArg.firstName).toBe("Test");
    expect(patchArg.lastName).toBe("User");
  });

  it("preserves existing firstName, patches blank lastName", async () => {
    mockUser.firstName = "Existing";
    mockUser.lastName = undefined;
    const ctx = createMockCtx();

    await syncHandler(ctx, { firstName: "New", lastName: "User" });

    const patchArg = ctx.db.patch.mock.calls[0][1];
    expect(patchArg.lastName).toBe("User");
    expect(patchArg).not.toHaveProperty("firstName");
  });

  it("patches blank avatarUrl", async () => {
    mockUser.avatarUrl = undefined;
    const ctx = createMockCtx();

    await syncHandler(ctx, { avatarUrl: "https://new-avatar.jpg" });

    const patchArg = ctx.db.patch.mock.calls[0][1];
    expect(patchArg.avatarUrl).toBe("https://new-avatar.jpg");
  });

  it("preserves existing avatarUrl", async () => {
    mockUser.avatarUrl = "https://old-avatar.jpg";
    const ctx = createMockCtx();

    await syncHandler(ctx, { avatarUrl: "https://new-avatar.jpg" });

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("does not call db.patch when no fields need updating", async () => {
    Object.assign(mockUser, {
      email: "existing@example.com",
      firstName: "Existing",
      lastName: "User",
      avatarUrl: "https://existing-avatar.jpg",
    });
    const ctx = createMockCtx();

    const result = await syncHandler(ctx, {
      email: "new@example.com",
      firstName: "New",
      lastName: "NewUser",
      avatarUrl: "https://new-avatar.jpg",
    });

    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("sets updatedAt when patching fields", async () => {
    mockUser.firstName = undefined;
    const ctx = createMockCtx();

    await syncHandler(ctx, { firstName: "Test" });

    const patchArg = ctx.db.patch.mock.calls[0][1];
    expect(patchArg.updatedAt).toBe(new Date("2026-01-15T12:00:00Z").getTime());
  });

  it("returns null always", async () => {
    // Case 1: no patching needed
    Object.assign(mockUser, {
      email: "existing@example.com",
      firstName: "Existing",
      lastName: "User",
      avatarUrl: "https://avatar.jpg",
    });
    const ctx1 = createMockCtx();
    const result1 = await syncHandler(ctx1, { email: "new@example.com" });
    expect(result1).toBeNull();

    // Case 2: patching happens
    mockUser.firstName = undefined;
    const ctx2 = createMockCtx();
    const result2 = await syncHandler(ctx2, { firstName: "Test" });
    expect(result2).toBeNull();
  });

  it("handles all blank fields at once", async () => {
    Object.assign(mockUser, {
      email: "",
      firstName: undefined,
      lastName: undefined,
      avatarUrl: undefined,
    });
    const ctx = createMockCtx();

    await syncHandler(ctx, {
      email: "new@example.com",
      firstName: "New",
      lastName: "User",
      avatarUrl: "https://new-avatar.jpg",
    });

    const patchArg = ctx.db.patch.mock.calls[0][1];
    expect(patchArg.email).toBe("new@example.com");
    expect(patchArg.firstName).toBe("New");
    expect(patchArg.lastName).toBe("User");
    expect(patchArg.avatarUrl).toBe("https://new-avatar.jpg");
    expect(patchArg.updatedAt).toBe(new Date("2026-01-15T12:00:00Z").getTime());
  });
});
