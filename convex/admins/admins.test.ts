import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

async function seedUser(t: ReturnType<typeof convexTest>, clerkId: string, email: string) {
  return await t.run((ctx) =>
    ctx.db.insert("users", { libraryItemCount: 0, clerkId, email, state: "active" as const, createdAt: 1, updatedAt: 1 }),
  );
}

async function setup() {
  const t = convexTest(schema);
  const adminId = await seedUser(t, "clerk_admin", "admin@test.local");
  const memberId = await seedUser(t, "clerk_member", "member@test.local");
  await t.mutation(internal.admins.mutations.grant, { email: "Admin@test.local" });
  return {
    t,
    adminId,
    memberId,
    admin: t.withIdentity({ subject: "clerk_admin" }),
    member: t.withIdentity({ subject: "clerk_member" }),
  };
}

describe("admin access", () => {
  it("lets admins change switches and the model list, and refuses everyone else", async () => {
    const { t, admin, member } = await setup();
    const modelId = await t.run((ctx) =>
      ctx.db.insert("models", {
        modelId: "acme/fast", name: "Acme: Fast", provider: "acme", inputPricePerMillion: 1, outputPricePerMillion: 2,
        isServed: false, costMarkup: 1, sortOrder: 0, syncedAt: 1, createdAt: 1, updatedAt: 1,
      }),
    );

    await expect(member.mutation(api.featureFlags.admin.setEnabled, { key: "credits.topups", enabled: false })).rejects.toThrow(/Admins only/);
    await expect(member.mutation(api.models.admin.setOffered, { modelId, on: false })).rejects.toThrow(/Admins only/);
    await expect(member.query(api.admins.queries.list, {})).rejects.toThrow(/Admins only/);
    expect(await member.query(api.admins.queries.amI, {})).toBe(false);

    await admin.mutation(api.featureFlags.admin.setEnabled, { key: "credits.topups", enabled: false });
    await admin.mutation(api.models.admin.setOffered, { modelId, on: false });
    const flag = await t.run((ctx) => ctx.db.query("featureFlags").withIndex("by_key", (q) => q.eq("key", "credits.topups")).unique());
    expect(flag?.enabled).toBe(false);
    // A hidden model leaves users' pickers.
    expect((await t.query(api.models.queries.listCatalogOptions, {})).map((m) => m.modelId)).not.toContain("acme/fast");
  });

  it("adds an existing user, and never lets an admin remove themselves", async () => {
    const { admin, member, memberId } = await setup();
    await admin.mutation(api.admins.mutations.addUser, { userId: memberId });
    expect(await member.query(api.admins.queries.amI, {})).toBe(true);

    const rows = await admin.query(api.admins.queries.list, {});
    const me = rows.find((r) => r.you)!;
    await expect(admin.mutation(api.admins.mutations.remove, { adminId: me._id })).rejects.toThrow(/yourself/);
    const other = rows.find((r) => !r.you)!;
    await admin.mutation(api.admins.mutations.remove, { adminId: other._id });
    expect(await member.query(api.admins.queries.amI, {})).toBe(false);
  });

  it("makes an invited email an admin only once its owner has verified it", async () => {
    const { t, admin } = await setup();
    await admin.mutation(internal.admins.mutations.prepareInvite, { email: "New.Person@test.local" });
    expect((await admin.query(api.admins.queries.list, {})).find((r) => r.email === "new.person@test.local")?.joined).toBe(false);
    const signUp = (eventId: string, occurredAt: number, verifiedEmails: string[]) =>
      t.mutation(internal.users.internal.upsertUserFromClerk, {
        clerkId: "clerk_new",
        email: "new.person@test.local",
        verifiedEmails,
        eventId,
        eventType: "user.updated",
        instanceId: "ins_1",
        occurredAt,
        payloadSha256: eventId.padEnd(64, "a"),
      });
    const newcomer = t.withIdentity({ subject: "clerk_new" });

    // Clerk reports the address before it's verified: no admin access yet.
    await signUp("evt_1", 1, []);
    expect(await newcomer.query(api.admins.queries.amI, {})).toBe(false);

    await signUp("evt_2", 2, ["new.person@test.local"]);
    expect(await newcomer.query(api.admins.queries.amI, {})).toBe(true);
  });
});
