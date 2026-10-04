// A person's wallet keys, read a page at a time by state (#424), with the counts their pages total from.
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

type Test = ReturnType<typeof convexTest>;

const seedUser = (t: Test, clerkId: string) =>
  t.run((ctx) => ctx.db.insert("users", { libraryItemCount: 0, clerkId, email: `${clerkId}@test.local`, state: "active" as const, createdAt: 1, updatedAt: 1 }));
const addKey = (t: Test, userId: Id<"users">, appName: string) =>
  t.mutation(internal.wallet.internal.insertKey, { userId, hashedKey: `hash_${appName}`, keyPrefix: `sk_${appName}`, appName, redirectOrigin: "manual" });

describe("wallet key list", () => {
  it("pages a person's active and revoked keys newest first, counts each, and leaves out a key still being made and other people's", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, "clerk_keys");
    const me = t.withIdentity({ subject: "clerk_keys" });
    const keys: Id<"walletKeys">[] = [];
    for (const app of ["one", "two", "three"]) keys.push(await addKey(t, userId, app));
    // The consent page makes a key that waits for its hash; it's in neither list.
    await me.mutation(api.wallet.mutations.approveConnection, { appName: "waiting", redirectOrigin: "manual" });
    await addKey(t, await seedUser(t, "clerk_other"), "theirs");

    const names = async (active: boolean, cursor: string | null = null) => {
      const read = await me.query(api.wallet.queries.listKeys, { active, paginationOpts: { cursor, numItems: 2 } });
      return { names: read.page.map((key) => key.appName), next: read.continueCursor };
    };
    const first = await names(true);
    expect(first.names).toEqual(["three", "two"]);
    expect((await names(true, first.next)).names).toEqual(["one"]);
    expect(await me.query(api.wallet.queries.countKeys, {})).toEqual({ active: 3, revoked: 0 });

    await me.mutation(api.wallet.mutations.revokeKey, { walletKeyId: keys[1] });
    expect((await names(true)).names).toEqual(["three", "one"]);
    expect((await names(false)).names).toEqual(["two"]);
    expect(await me.query(api.wallet.queries.countKeys, {})).toEqual({ active: 2, revoked: 1 });
  });
});
