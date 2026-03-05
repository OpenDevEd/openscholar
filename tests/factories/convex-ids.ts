import type { Id, Doc, TableNames } from "../../convex/_generated/dataModel";
import type { SystemTableNames } from "convex/server";

// ---------------------------------------------------------------------------
// Branded Id factory
// ---------------------------------------------------------------------------

/**
 * Create a mock Convex `Id<TableName>` without unsafe casts.
 *
 * Usage:
 *   mockId("users")           // => "mock_users_1" typed as Id<"users">
 *   mockId("users", "alice")  // => "mock_users_alice" typed as Id<"users">
 */
export function mockId<T extends TableNames | SystemTableNames>(table: T, suffix = "1"): Id<T> {
  return `mock_${table}_${suffix}` as unknown as Id<T>;
}

// ---------------------------------------------------------------------------
// Doc<"users"> factory
// ---------------------------------------------------------------------------

type UserOverrides = Partial<Omit<Doc<"users">, "_id" | "_creationTime">> & {
  _id?: Id<"users">;
  _creationTime?: number;
};

export function createMockUser(overrides?: UserOverrides): Doc<"users"> {
  const now = Date.now();
  return {
    _id: mockId("users"),
    _creationTime: now,
    clerkId: "clerk_test_123",
    email: "test@example.com",
    state: "active" as const,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as unknown as Doc<"users">;
}

// ---------------------------------------------------------------------------
// Doc<"subscriptions"> factory
// ---------------------------------------------------------------------------

type SubscriptionOverrides = Partial<Omit<Doc<"subscriptions">, "_id" | "_creationTime">> & {
  _id?: Id<"subscriptions">;
  _creationTime?: number;
};

export function createMockSubscription(overrides?: SubscriptionOverrides): Doc<"subscriptions"> {
  const now = Date.now();
  return {
    _id: mockId("subscriptions"),
    _creationTime: now,
    userId: mockId("users"),
    plan: "free" as const,
    status: "active" as const,
    creditsPerMonth: 0,
    seats: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as unknown as Doc<"subscriptions">;
}

