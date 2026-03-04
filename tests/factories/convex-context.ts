import { vi } from "vitest";
import type { QueryCtx, MutationCtx, ActionCtx } from "../../convex/_generated/server";

// ---------------------------------------------------------------------------
// DeepPartial helper for selective overrides
// ---------------------------------------------------------------------------

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// ---------------------------------------------------------------------------
// Simple deep merge (overrides win, no array merging)
// ---------------------------------------------------------------------------

function deepMerge<T extends Record<string, unknown>>(
  base: T,
  overrides: DeepPartial<T>,
): T {
  const result = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(overrides)) {
    const baseVal = result[key];
    const overVal = (overrides as Record<string, unknown>)[key];
    if (
      baseVal !== null &&
      overVal !== null &&
      typeof baseVal === "object" &&
      typeof overVal === "object" &&
      !Array.isArray(baseVal) &&
      !Array.isArray(overVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overVal as DeepPartial<Record<string, unknown>>,
      );
    } else {
      result[key] = overVal;
    }
  }
  return result as T;
}

// ---------------------------------------------------------------------------
// QueryCtx factory
// ---------------------------------------------------------------------------

export function createMockQueryCtx(overrides?: DeepPartial<QueryCtx>): QueryCtx {
  const base = {
    db: {
      query: vi.fn().mockReturnValue({
        withIndex: vi.fn().mockReturnValue({
          unique: vi.fn().mockResolvedValue(null),
          order: vi.fn().mockReturnValue({
            collect: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      get: vi.fn().mockResolvedValue(null),
    },
    auth: {
      getUserIdentity: vi.fn().mockResolvedValue(null),
    },
  };

  if (overrides) {
    return deepMerge(
      base as unknown as Record<string, unknown>,
      overrides as DeepPartial<Record<string, unknown>>,
    ) as unknown as QueryCtx;
  }

  return base as unknown as QueryCtx;
}

// ---------------------------------------------------------------------------
// MutationCtx factory
// ---------------------------------------------------------------------------

export function createMockMutationCtx(overrides?: DeepPartial<MutationCtx>): MutationCtx {
  const base = {
    db: {
      query: vi.fn().mockReturnValue({
        withIndex: vi.fn().mockReturnValue({
          unique: vi.fn().mockResolvedValue(null),
          order: vi.fn().mockReturnValue({
            collect: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      get: vi.fn().mockResolvedValue(null),
      insert: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      replace: vi.fn(),
    },
    auth: {
      getUserIdentity: vi.fn().mockResolvedValue(null),
    },
    scheduler: {
      runAfter: vi.fn(),
      runAt: vi.fn(),
    },
  };

  if (overrides) {
    return deepMerge(
      base as unknown as Record<string, unknown>,
      overrides as DeepPartial<Record<string, unknown>>,
    ) as unknown as MutationCtx;
  }

  return base as unknown as MutationCtx;
}

// ---------------------------------------------------------------------------
// ActionCtx factory
// ---------------------------------------------------------------------------

export function createMockActionCtx(overrides?: DeepPartial<ActionCtx>): ActionCtx {
  const base = {
    runMutation: vi.fn(),
    runAction: vi.fn(),
    scheduler: {
      runAfter: vi.fn(),
      runAt: vi.fn(),
    },
    auth: {
      getUserIdentity: vi.fn().mockResolvedValue(null),
    },
  };

  if (overrides) {
    return deepMerge(
      base as unknown as Record<string, unknown>,
      overrides as DeepPartial<Record<string, unknown>>,
    ) as unknown as ActionCtx;
  }

  return base as unknown as ActionCtx;
}

// ---------------------------------------------------------------------------
// Clerk identity factory
// ---------------------------------------------------------------------------

interface MockIdentityOverrides {
  subject?: string;
  email?: string;
  givenName?: string;
  familyName?: string;
  pictureUrl?: string;
  [key: string]: unknown;
}

export function createMockIdentity(overrides?: MockIdentityOverrides) {
  return {
    subject: "clerk_test_123",
    email: "test@example.com",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Convex server module mock (for vi.mock factories)
// ---------------------------------------------------------------------------

export function createMockMutationDef() {
  return {
    mutation: <T>(def: T): T => def,
    query: <T>(def: T): T => def,
    action: <T>(def: T): T => def,
    internalMutation: <T>(def: T): T => def,
    internalQuery: <T>(def: T): T => def,
    internalAction: <T>(def: T): T => def,
  };
}
