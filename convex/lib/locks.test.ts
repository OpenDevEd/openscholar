import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import schema from "../schema";
import { BATCH_LOCK_TTL_MS } from "./locks";

async function seedUser(
  t: ReturnType<typeof convexTest>,
  clerkId = "u_lock_test",
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("users", {
      libraryItemCount: 0,
      clerkId,
      email: `${clerkId}@t`,
      state: "active",
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

describe("acquireBatchLock", () => {
  it("inserts a row with TTL when no active lock exists", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const before = Date.now();

    const lockId = await t.mutation(internal.lib.locks.acquireBatchLock, {
      userId,
      kind: "batch_screening",
      ttlMs: BATCH_LOCK_TTL_MS,
    });

    const row = await t.run(async (ctx) => ctx.db.get(lockId));
    expect(row?.userId).toBe(userId);
    expect(row?.kind).toBe("batch_screening");
    expect(row?.acquiredAt).toBeGreaterThanOrEqual(before);
    expect(row?.expiresAt).toBeGreaterThanOrEqual(
      (row?.acquiredAt ?? 0) + BATCH_LOCK_TTL_MS,
    );
  });

  it("throws BATCH_ACTION_ALREADY_RUNNING when an active lock exists for the same (userId, kind)", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);

    await t.mutation(internal.lib.locks.acquireBatchLock, {
      userId,
      kind: "batch_screening",
      ttlMs: BATCH_LOCK_TTL_MS,
    });

    const err = await t
      .mutation(internal.lib.locks.acquireBatchLock, {
        userId,
        kind: "batch_screening",
        ttlMs: BATCH_LOCK_TTL_MS,
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConvexError);
    const data = (err as ConvexError<{ code: string; kind?: string }>).data;
    expect(data.code).toBe("BATCH_ACTION_ALREADY_RUNNING");
    expect(data.kind).toBe("batch_screening");
  });

  it("garbage-collects expired locks for the same (userId, kind) before inserting", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);

    const expiredLockId = await t.run(async (ctx) =>
      ctx.db.insert("userResourceLocks", {
        userId,
        kind: "batch_screening",
        acquiredAt: Date.now() - 30 * 60 * 1000,
        expiresAt: Date.now() - 1_000, // already expired
      }),
    );

    const newLockId = await t.mutation(
      internal.lib.locks.acquireBatchLock,
      { userId, kind: "batch_screening", ttlMs: BATCH_LOCK_TTL_MS },
    );

    const expiredRow = await t.run(async (ctx) => ctx.db.get(expiredLockId));
    expect(expiredRow).toBeNull();

    const newRow = await t.run(async (ctx) => ctx.db.get(newLockId));
    expect(newRow).not.toBeNull();
    expect(newRow?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("allows acquisition for a different kind when one kind is held by the same user", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);

    await t.mutation(internal.lib.locks.acquireBatchLock, {
      userId,
      kind: "batch_screening",
      ttlMs: BATCH_LOCK_TTL_MS,
    });

    const translationLockId = await t.mutation(
      internal.lib.locks.acquireBatchLock,
      { userId, kind: "batch_translation", ttlMs: BATCH_LOCK_TTL_MS },
    );

    const translationRow = await t.run(async (ctx) =>
      ctx.db.get(translationLockId),
    );
    expect(translationRow?.kind).toBe("batch_translation");
  });

  it("allows acquisition by a different user even when one user holds the same kind", async () => {
    const t = convexTest(schema);
    const userA = await seedUser(t, "u_a");
    const userB = await seedUser(t, "u_b");

    await t.mutation(internal.lib.locks.acquireBatchLock, {
      userId: userA,
      kind: "batch_screening",
      ttlMs: BATCH_LOCK_TTL_MS,
    });

    const userBLockId = await t.mutation(
      internal.lib.locks.acquireBatchLock,
      { userId: userB, kind: "batch_screening", ttlMs: BATCH_LOCK_TTL_MS },
    );

    const userBRow = await t.run(async (ctx) => ctx.db.get(userBLockId));
    expect(userBRow?.userId).toBe(userB);
    expect(userBRow?.kind).toBe("batch_screening");
  });
});

describe("releaseBatchLock", () => {
  it("deletes the lock row by id", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);

    const lockId = await t.mutation(internal.lib.locks.acquireBatchLock, {
      userId,
      kind: "batch_screening",
      ttlMs: BATCH_LOCK_TTL_MS,
    });

    await t.mutation(internal.lib.locks.releaseBatchLock, { lockId });

    const row = await t.run(async (ctx) => ctx.db.get(lockId));
    expect(row).toBeNull();
  });

  it("is idempotent — calling twice does not throw", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);

    const lockId = await t.mutation(internal.lib.locks.acquireBatchLock, {
      userId,
      kind: "batch_translation",
      ttlMs: BATCH_LOCK_TTL_MS,
    });

    await t.mutation(internal.lib.locks.releaseBatchLock, { lockId });
    // Second call must be a clean no-op, not throw.
    await expect(
      t.mutation(internal.lib.locks.releaseBatchLock, { lockId }),
    ).resolves.toBeNull();
  });

  it("allows re-acquisition for the same (userId, kind) after release", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);

    const firstLockId = await t.mutation(
      internal.lib.locks.acquireBatchLock,
      { userId, kind: "batch_screening", ttlMs: BATCH_LOCK_TTL_MS },
    );
    await t.mutation(internal.lib.locks.releaseBatchLock, {
      lockId: firstLockId,
    });

    const secondLockId = await t.mutation(
      internal.lib.locks.acquireBatchLock,
      { userId, kind: "batch_screening", ttlMs: BATCH_LOCK_TTL_MS },
    );

    expect(secondLockId).not.toBe(firstLockId);
    const secondRow = await t.run(async (ctx) => ctx.db.get(secondLockId));
    expect(secondRow?.userId).toBe(userId);
    expect(secondRow?.kind).toBe("batch_screening");
  });
});
