import { describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";
import { requireAuth } from "../convex/lib/auth";

/**
 * Build a mock AuthContext for requireAuth.
 * requireAuth calls ctx.auth.getUserIdentity() and then
 * ctx.db.query("users").withIndex("by_clerk_id", ...).unique()
 */
function createMockCtx(identity: any, user: any) {
  return {
    auth: {
      getUserIdentity: vi.fn().mockResolvedValue(identity),
    },
    db: {
      query: vi.fn().mockReturnValue({
        withIndex: vi.fn().mockReturnValue({
          unique: vi.fn().mockResolvedValue(user),
        }),
      }),
    },
  };
}

const mockIdentity = { subject: "clerk_123" };

describe("requireAuth / assertActiveUser", () => {
  it("allows active user through", async () => {
    const user = {
      _id: "user1",
      state: "active",
      clerkId: "clerk_123",
      email: "test@example.com",
    };
    const ctx = createMockCtx(mockIdentity, user);

    const result = await requireAuth(ctx as any);
    expect(result).toEqual(user);
  });

  it("throws FORBIDDEN for suspended user", async () => {
    const user = {
      _id: "user1",
      state: "suspended",
      clerkId: "clerk_123",
      email: "test@example.com",
    };
    const ctx = createMockCtx(mockIdentity, user);

    try {
      await requireAuth(ctx as any);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      const convexErr = err as ConvexError<{ code: string; message: string }>;
      expect(convexErr.data.code).toBe("FORBIDDEN");
      expect(convexErr.data.message).toBe("Account suspended");
    }
  });

  it("throws FORBIDDEN for deleted user", async () => {
    const user = {
      _id: "user1",
      state: "deleted",
      clerkId: "clerk_123",
      email: "test@example.com",
    };
    const ctx = createMockCtx(mockIdentity, user);

    try {
      await requireAuth(ctx as any);
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
      await requireAuth(ctx as any);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      const convexErr = err as ConvexError<{ code: string }>;
      expect(convexErr.data.code).toBe("UNAUTHENTICATED");
    }
  });

  it("throws UNAUTHENTICATED when user not found", async () => {
    const ctx = createMockCtx(mockIdentity, null);

    try {
      await requireAuth(ctx as any);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      const convexErr = err as ConvexError<{ code: string }>;
      expect(convexErr.data.code).toBe("UNAUTHENTICATED");
    }
  });

  it('throws UNAUTHENTICATED with "User not synced yet" when allowSyncing and user not found', async () => {
    const ctx = createMockCtx(mockIdentity, null);

    try {
      await requireAuth(ctx as any, true);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      const convexErr = err as ConvexError<{ code: string; message: string }>;
      expect(convexErr.data.code).toBe("UNAUTHENTICATED");
      expect(convexErr.data.message).toBe("User not synced yet");
    }
  });
});
