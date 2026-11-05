/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { EVIDENCE_LIBRARIES_FEATURE } from "../../lib/billing/plans";
import { api, internal } from "../_generated/api";
import { seedCreditsForTest } from "../billing/billing.test-support";
import schema from "../schema";
import { MAX_PROFILE_RECORDS } from "./validators";

const modules = import.meta.glob("/convex/**/*.ts");
const content = { name: "Susan Athey", headline: "", affiliation: "", bio: "", website: "", linkedin: "", orcid: "", openalex: "" };

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const fields = { state: "active" as const, createdAt: 1, updatedAt: 1 };
    for (const clerkId of ["ada", "ben"]) {
      const userId = await ctx.db.insert("users", { ...fields, clerkId, email: `${clerkId}@example.org` });
      await seedCreditsForTest(ctx, { userId, features: [EVIDENCE_LIBRARIES_FEATURE] });
    }
  });
  return { t, ada: t.withIdentity({ subject: "ada" }), ben: t.withIdentity({ subject: "ben" }) };
}

describe("a profile's author records", () => {
  it("claims a record as a new profile's main one, which then finds the profile, by any ID the person goes by", async () => {
    const { t, ada } = await setup();
    const profileId = await ada.mutation(api.authors.links.claim, { authorId: "https://openalex.org/a5001211242", name: "Susan Athey" });
    expect(await t.run((ctx) => ctx.db.get("authorProfiles", profileId))).toMatchObject({ name: "Susan Athey", openalex: "A5001211242" });
    expect(await t.query(api.authors.links.records, { profileId })).toEqual(["A5001211242"]);
    expect(await t.query(api.authors.links.profileFor, { ids: ["OSA1", "A5001211242"] })).toBe(profileId);
    expect(await t.query(api.authors.links.profileFor, { ids: ["OSA1"] })).toBeNull();
  });

  it("refuses a claim when another profile holds any ID the person goes by", async () => {
    const { t, ada, ben } = await setup();
    const held = await ada.mutation(api.authors.links.claim, { authorId: "OSA2", name: "Susan Athey" });
    await expect(ben.mutation(api.authors.links.claim, { authorId: "A1", knownAs: ["A1", "OSA2"], name: "Someone" })).rejects.toThrow(/another profile/);
    expect(await t.query(api.authors.links.profileFor, { ids: ["A1"] })).toBeNull();
    expect(await t.query(api.authors.links.profileFor, { ids: ["A1", "OSA2"] })).toBe(held);
  });

  it("links more of the person's records, each to one profile at most, and up to its cap", async () => {
    const { t, ada, ben } = await setup();
    const profileId = await ada.mutation(api.authors.links.claim, { authorId: "A1", name: "Susan Athey" });
    await ada.mutation(api.authors.links.add, { profileId, authorId: "OSA2" });
    await ada.mutation(api.authors.links.add, { profileId, authorId: "OSA2" });
    expect((await t.query(api.authors.links.records, { profileId })).sort()).toEqual(["A1", "OSA2"]);

    await expect(ben.mutation(api.authors.links.claim, { authorId: "OSA2", name: "Someone" })).rejects.toThrow(/another profile/);
    const other = await ben.mutation(api.authors.links.claim, { authorId: "OSA3", name: "Someone" });
    await expect(ben.mutation(api.authors.links.add, { profileId: other, authorId: "A1" })).rejects.toThrow(/another profile/);
    await expect(ben.mutation(api.authors.links.add, { profileId, authorId: "OSA9" })).rejects.toThrow(/permission/);
    await expect(ada.mutation(api.authors.links.add, { profileId, authorId: "not an author" })).rejects.toThrow(/author record/);

    for (let n = 10; n < 10 + MAX_PROFILE_RECORDS - 2; n++) await ada.mutation(api.authors.links.add, { profileId, authorId: `OSA${n}` });
    await expect(ada.mutation(api.authors.links.add, { profileId, authorId: "OSA99" })).rejects.toThrow(/at most/);
  });

  it("takes a record off, but the main one changes with the profile", async () => {
    const { t, ada } = await setup();
    const profileId = await ada.mutation(api.authors.links.claim, { authorId: "A1", name: "Susan Athey" });
    await ada.mutation(api.authors.links.add, { profileId, authorId: "OSA2" });
    await expect(ada.mutation(api.authors.links.remove, { profileId, authorId: "A1" })).rejects.toThrow(/main record/);
    await ada.mutation(api.authors.links.remove, { profileId, authorId: "OSA2" });
    expect(await t.query(api.authors.links.records, { profileId })).toEqual(["A1"]);
  });

  it("moves the link when the profile's main record changes, and refuses one another profile holds", async () => {
    const { t, ada, ben } = await setup();
    const profileId = await ada.mutation(api.authors.links.claim, { authorId: "A1", name: "Susan Athey" });
    await ben.mutation(api.authors.links.claim, { authorId: "A9", name: "Someone" });
    await ada.action(api.authors.photos.save, { profileId, expectedRevision: 1, content: { ...content, openalex: "A2" } });
    expect(await t.query(api.authors.links.records, { profileId })).toEqual(["A2"]);
    await expect(ada.action(api.authors.photos.save, { profileId, expectedRevision: 2, content: { ...content, openalex: "A9" } })).rejects.toThrow(/another profile/);
    await ada.action(api.authors.photos.save, { profileId, expectedRevision: 2, content });
    expect(await t.query(api.authors.links.records, { profileId })).toEqual([]);
  });

  it("treats a main record from before links as held, so no one can take it before the move runs", async () => {
    const { t, ben } = await setup();
    const held = await t.run((ctx) => ctx.db.insert("authorProfiles", { ...content, openalex: "A1", revision: 1, updatedAt: 1 }));
    await expect(ben.mutation(api.authors.links.claim, { authorId: "A1", name: "Someone" })).rejects.toThrow(/another profile/);
    expect(await t.query(api.authors.links.profileFor, { ids: ["A1"] })).toBe(held);
  });

  it("changes the main record of a profile at its cap", async () => {
    const { t, ada } = await setup();
    const profileId = await ada.mutation(api.authors.links.claim, { authorId: "A1", name: "Susan Athey" });
    for (let n = 10; n < 10 + MAX_PROFILE_RECORDS - 1; n++) await ada.mutation(api.authors.links.add, { profileId, authorId: `OSA${n}` });
    await ada.action(api.authors.photos.save, { profileId, expectedRevision: 1, content: { ...content, openalex: "A2" } });
    const records = await t.query(api.authors.links.records, { profileId });
    expect(records).toHaveLength(MAX_PROFILE_RECORDS);
    expect(records).toContain("A2");
    expect(records).not.toContain("A1");
  });

  it("moves today's values across once, leaving a record two profiles name with the first", async () => {
    const { t } = await setup();
    const [first, second, none] = await t.run(async (ctx) =>
      Promise.all(["A1", "A1", ""].map((openalex) => ctx.db.insert("authorProfiles", { ...content, openalex, revision: 1, updatedAt: 1 }))),
    );
    expect(await t.action(internal.migrations.authorRecordLinks.run, {})).toEqual({ linked: 1, taken: 1 });
    expect(await t.action(internal.migrations.authorRecordLinks.run, {})).toEqual({ linked: 0, taken: 1 });
    expect(await t.query(api.authors.links.records, { profileId: first })).toEqual(["A1"]);
    expect(await t.query(api.authors.links.records, { profileId: second })).toEqual([]);
    expect(await t.query(api.authors.links.records, { profileId: none })).toEqual([]);
  });
});
