import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

const ISSUER = "https://clerk.example.test";

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const person = (clerkId: string, email: string) =>
      ctx.db.insert("users", { clerkId, email, state: "active", createdAt: now, updatedAt: now, lastLoginAt: now });
    const ada = await person("ada", "ada@example.test");
    const owner = await person("owner", "owner@example.test");
    const appId = await ctx.db.insert("developerApps", {
      ownerId: owner,
      name: "BeeWriter",
      website: "https://beewriter.app",
      redirectUris: ["https://beewriter.app/callback"],
      kind: "server",
      clientId: "client_bee",
      clerkApplicationId: "oauth_app_bee",
    });
    return { ada, appId };
  });
}

/** Ada on Openscholar's own pages, and Ada through an app's OAuth token. */
const onOpenscholar = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: "ada", issuer: ISSUER });
const throughApp = (t: ReturnType<typeof convexTest>, clientId = "client_bee") => t.withIdentity({ subject: "ada", issuer: ISSUER, client_id: clientId });

describe("developer apps acting for a person", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("accepts a token only from an app someone made on Openscholar", async () => {
    const t = convexTest(schema);
    await seed(t);
    expect((await throughApp(t).query(api.users.queries.me, {}))?.clerkId).toBe("ada");
    await expect(throughApp(t, "client_unknown").query(api.users.queries.me, {})).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
    await expect(throughApp(t, "client_unknown").mutation(api.users.mutations.ensureUser, {})).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
  });

  it("lists a site once it changes something, not when it only reads", async () => {
    const t = convexTest(schema);
    await seed(t);
    const page = { paginationOpts: { numItems: 10, cursor: null } };
    await throughApp(t).query(api.users.queries.me, {});
    expect((await onOpenscholar(t).query(api.developerApps.sites.listSites, page)).page).toEqual([]);
    await throughApp(t).mutation(api.users.mutations.ensureUser, {});
    const sites = (await onOpenscholar(t).query(api.developerApps.sites.listSites, page)).page;
    expect(sites).toMatchObject([{ name: "BeeWriter", website: "https://beewriter.app" }]);
    expect(sites[0]!.disconnectedAt).toBeUndefined();
  });

  it("refuses a disconnected site until the person allows it again", async () => {
    const t = convexTest(schema);
    await seed(t);
    await throughApp(t).mutation(api.users.mutations.ensureUser, {});
    const [site] = (await onOpenscholar(t).query(api.developerApps.sites.listSites, { paginationOpts: { numItems: 10, cursor: null } })).page;

    await onOpenscholar(t).mutation(api.developerApps.sites.setDisconnected, { siteId: site!._id, disconnected: true });
    await expect(throughApp(t).query(api.users.queries.me, {})).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(throughApp(t).mutation(api.users.mutations.ensureUser, {})).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    // The site can't undo it for itself.
    await expect(throughApp(t).mutation(api.developerApps.sites.setDisconnected, { siteId: site!._id, disconnected: false })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });

    await onOpenscholar(t).mutation(api.developerApps.sites.setDisconnected, { siteId: site!._id, disconnected: false });
    expect((await throughApp(t).query(api.users.queries.me, {}))?.clerkId).toBe("ada");
  });

  it("refuses what's on the can't-do list, which the person still does on Openscholar", async () => {
    const t = convexTest(schema);
    await seed(t);
    await expect(throughApp(t).mutation(api.users.mutations.updateProfile, { firstName: "Mallory" })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(throughApp(t).query(api.developerApps.apps.listApps, { paginationOpts: { numItems: 10, cursor: null } })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await onOpenscholar(t).mutation(api.users.mutations.updateProfile, { firstName: "Ada" });
    expect((await onOpenscholar(t).query(api.users.queries.me, {}))?.firstName).toBe("Ada");
  });

  it("stops an app's tokens as soon as its owner deletes it, and clears it from people's lists", async () => {
    const t = convexTest(schema);
    const { appId } = await seed(t);
    await throughApp(t).mutation(api.users.mutations.ensureUser, {});
    await t.mutation(internal.developerApps.apps.remove, { appId });
    await expect(throughApp(t).query(api.users.queries.me, {})).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.query("developerAppGrants").take(1))).toEqual([]);
  });

  it("lists the site on a person's first sign-in through it, when the call makes their account", async () => {
    const t = convexTest(schema);
    await seed(t);
    const newcomer = t.withIdentity({ subject: "newcomer", issuer: ISSUER, client_id: "client_bee", email: "new@example.test" });
    await newcomer.mutation(api.users.mutations.ensureUser, {});
    const sites = await t.withIdentity({ subject: "newcomer", issuer: ISSUER }).query(api.developerApps.sites.listSites, { paginationOpts: { numItems: 10, cursor: null } });
    expect(sites.page).toMatchObject([{ name: "BeeWriter" }]);
  });

  it("stops an app as soon as its owner's account is suspended", async () => {
    const t = convexTest(schema);
    await seed(t);
    await t.run(async (ctx) => {
      const owner = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", "owner")).unique();
      await ctx.db.patch("users", owner!._id, { state: "suspended" });
    });
    await expect(throughApp(t).query(api.users.queries.me, {})).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
  });

  it("removes a deleted account's sites and its own apps", async () => {
    const t = convexTest(schema);
    await seed(t);
    await throughApp(t).mutation(api.users.mutations.ensureUser, {});
    const longAgo = Date.now() - 40 * 24 * 60 * 60 * 1000;
    await t.run(async (ctx) => {
      for (const clerkId of ["ada", "owner"]) {
        const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId)).unique();
        await ctx.db.patch("users", user!._id, { state: "deleted", updatedAt: longAgo });
      }
    });
    // One account per run.
    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});
    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});
    expect(await t.run((ctx) => ctx.db.query("developerApps").take(1))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("developerAppGrants").take(1))).toEqual([]);
  });
});
