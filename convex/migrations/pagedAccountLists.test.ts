// The backfill that counts wallet keys and admins saved before their lists paged (#424).
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { runUntriggered } from "../../tests/convex-test-with-limits";

it("counts the keys and admins saved before, once however often it runs, and reports what's left", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    // As rows saved before the counts: written without the triggers that keep them.
    await runUntriggered(t, async (ctx) => {
      const userId = await ctx.db.insert("users", { libraryItemCount: 0, clerkId: "clerk_before", email: "before@test.local", state: "active" as const, createdAt: 1, updatedAt: 1 });
      const key = { userId, keyPrefix: "sk_", appName: "app", redirectOrigin: "manual", createdAt: 1 };
      await ctx.db.insert("walletKeys", { ...key, hashedKey: "a", isActive: true });
      await ctx.db.insert("walletKeys", { ...key, hashedKey: "b", isActive: true });
      await ctx.db.insert("walletKeys", { ...key, hashedKey: "c", isActive: false });
      await ctx.db.insert("walletKeys", { ...key, hashedKey: "__pending__", isActive: true });
      await ctx.db.insert("admins", { email: "before@test.local", userId, createdAt: 1 });
      await ctx.db.insert("admins", { email: "invited@test.local", createdAt: 1 });
    });
    const me = t.withIdentity({ subject: "clerk_before" });
    expect(await t.action(internal.migrations.pagedAccountLists.verify, {})).toBe(5);
    expect(await me.query(api.wallet.queries.countKeys, {})).toEqual({ active: 0, revoked: 0 });

    for (let runs = 0; runs < 2; runs++) {
      await t.mutation(internal.migrations.pagedAccountLists.run, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    }

    expect(await t.action(internal.migrations.pagedAccountLists.verify, {})).toBe(0);
    expect(await me.query(api.wallet.queries.countKeys, {})).toEqual({ active: 2, revoked: 1 });
    expect(await me.query(api.admins.queries.countAdmins, {})).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});
