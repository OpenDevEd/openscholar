/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { seedOrganizationFeatures } from "./organizationFeatures.test-support";

const modules = import.meta.glob("/convex/**/*.ts");
const denied = { authors: false, extraction: false, evidenceLibraries: false };

describe("organization feature access", () => {
  test("unions every active membership without using active organization claims", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        clerkId: "member",
        email: "member@example.org",
        state: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await seedOrganizationFeatures(ctx, ["member"], { authors: true });
      await seedOrganizationFeatures(ctx, ["member"], {
        evidenceLibraries: true,
        extraction: true,
      });
    });
    for (const identity of [
      { subject: "member" },
      { subject: "member", o: { id: "unrelated", rol: "org:member" } },
    ]) {
      expect(
        await t.withIdentity(identity).query(api.organizationFeatures.get, {}),
      ).toEqual({ authors: true, evidenceLibraries: true, extraction: true });
    }
  });

  test("revocation, disabled features and deleted organizations immediately remove grants", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        clerkId: "member",
        email: "member@example.org",
        state: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      return seedOrganizationFeatures(ctx, ["member"], {
        authors: true,
        evidenceLibraries: true,
        extraction: true,
      });
    });
    const user = t.withIdentity({ subject: "member" });
    await t.run((ctx) =>
      ctx.db.patch("organizations", id, { authorsEnabled: false }),
    );
    expect(await user.query(api.organizationFeatures.get, {})).toEqual({
      authors: false,
      extraction: true,
      evidenceLibraries: true,
    });
    await t.run((ctx) =>
      ctx.db.patch("organizations", id, { state: "deleted" }),
    );
    expect(await user.query(api.organizationFeatures.get, {})).toEqual(denied);
    await t.run(async (ctx) => {
      await ctx.db.patch("organizations", id, { state: "active" });
      const membership = await ctx.db.query("organizationMemberships").first();
      await ctx.db.patch("organizationMemberships", membership!._id, {
        state: "revoked",
      });
    });
    expect(await user.query(api.organizationFeatures.get, {})).toEqual(denied);
    await expect(
      user.mutation(api.authors.profiles.create, { name: "Someone" }),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  test("does not expose another user's features to anonymous or unaffiliated accounts", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const clerkId of ["member", "outsider"])
        await ctx.db.insert("users", {
          clerkId,
          email: `${clerkId}@example.org`,
          state: "active",
          createdAt: 1,
          updatedAt: 1,
        });
      await seedOrganizationFeatures(ctx, ["member"], { authors: true });
    });
    expect(await t.query(api.organizationFeatures.get, {})).toEqual(denied);
    const outsider = t.withIdentity({
      subject: "outsider",
      o: { id: "forged", rol: "org:admin" },
    });
    expect(await outsider.query(api.organizationFeatures.get, {})).toEqual(
      denied,
    );
    await expect(
      outsider.query(api.authors.profiles.list, {
        search: "",
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow(/FORBIDDEN/);
  });
});

test("the creation picker and authorization use the same eligible organizations", async () => {
  const t = convexTest(schema, modules);
  const [first, second, memberOnly, disabled, foreign] = await t.run(
    async (ctx) => {
      await ctx.db.insert("users", {
        clerkId: "owner",
        email: "owner@example.org",
        state: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const ids = [];
      for (const name of [
        "Alpha",
        "Beta",
        "Member only",
        "Disabled",
        "Foreign",
      ]) {
        const id = await seedOrganizationFeatures(
          ctx,
          name === "Foreign" ? ["someone-else"] : ["owner"],
          { evidenceLibraries: name !== "Disabled" },
        );
        await ctx.db.patch("organizations", id, { name });
        const membership = await ctx.db
          .query("organizationMemberships")
          .withIndex("by_organizationId_and_state", (q) =>
            q.eq("organizationId", id).eq("state", "active"),
          )
          .unique();
        await ctx.db.patch("organizationMemberships", membership!._id, {
          role: name === "Member only" ? "org:member" : "org:admin",
        });
        ids.push(id);
      }
      return ids;
    },
  );
  const owner = t.withIdentity({
    subject: "owner",
    o: { id: "unrelated", rol: "org:member" },
  });
  expect(
    (await owner.query(api.organizationFeatures.libraryOrganizations, {})).map(
      (org) => org.id,
    ),
  ).toEqual([first, second]);
  const { requireLibraryOrganization } = await import("./organizationFeatures");
  const { createEvidenceLibrarySetup } =
    await import("./evidenceLibraries/mutations");
  const created = await owner.run((ctx) =>
    createEvidenceLibrarySetup(ctx, {
      organizationId: second!,
      name: "Chosen library",
      slug: "chosen-library",
      publicAddress: "https://chosen.example.org",
    }),
  );
  expect(
    await t.run((ctx) => ctx.db.get("evidenceLibraries", created.libraryId)),
  ).toMatchObject({ organizationId: second });
  for (const id of [memberOnly, disabled, foreign])
    await expect(
      owner.run((ctx) => requireLibraryOrganization(ctx, id!)),
    ).rejects.toThrow(/FORBIDDEN/);
  await t.run((ctx) =>
    ctx.db.patch("organizations", second!, { evidenceLibrariesEnabled: false }),
  );
  expect(
    (await owner.query(api.organizationFeatures.libraryOrganizations, {})).map(
      (org) => org.id,
    ),
  ).toEqual([first]);
  await expect(
    owner.run((ctx) => requireLibraryOrganization(ctx, second!)),
  ).rejects.toThrow(/FORBIDDEN/);
});
