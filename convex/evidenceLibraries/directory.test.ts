// The public directory of communities (#1090): what a card shows is kept on the community's row
// when it goes live, the directory lists the live ones its owners haven't unlisted, sorted and
// searched on the server, and only an owner unlists one.
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";
import { backfillCard, noteLive } from "./directory";
import { grantLibraryRole } from "./team.test-support";

type Fixture = Awaited<ReturnType<typeof createReadySetupFixture>>;

async function live(suffix: string) {
  const fixture = await createReadySetupFixture(suffix);
  const library = (await fixture.t.run((ctx) => ctx.db.get("evidenceLibraries", fixture.created.libraryId)))!;
  return { fixture, library, workspaceId: library.workspaceId };
}

/** Another live community in the same workspace, with what its card would hold. */
const another = (fixture: Fixture, workspaceId: Id<"workspaces">, name: string, extra: { liveAt: number; records?: number; tagline?: string; description?: string; shortName?: string }) =>
  fixture.t.run((ctx) => ctx.db.insert("evidenceLibraries", {
    workspaceId, name, slug: name.toLowerCase().replaceAll(" ", "-"), state: "active", createdByClerkUserId: "someone", updatedByClerkUserId: "someone", createdAt: 1, updatedAt: 1,
    liveAt: extra.liveAt, ...(extra.records === undefined ? {} : { records: extra.records }), card: { name, nameKey: name.toLowerCase(), ...(extra.shortName ? { shortName: extra.shortName } : {}), ...(extra.tagline ? { tagline: extra.tagline } : {}), ...(extra.description ? { description: extra.description } : {}) },
  }));

// Read signed out: the directory is everyone's (#1090).
const list = (fixture: Fixture, sort: "newest" | "name" | "records", search?: string) =>
  fixture.t.query(api.evidenceLibraries.directory.directory, { sort, ...(search ? { search } : {}), paginationOpts: { cursor: null, numItems: 10 } }).then((page) => page.page);

describe("the public directory", () => {
  it("keeps a community's card on its row once it goes live, and its record count once it says it", async () => {
    const { fixture, library } = await live("directory_card");
    expect(library.card).toEqual({ name: "Climate Evidence", nameKey: "climate evidence", shortName: "Climate", accentColor: "#005A9C", faviconUrl: "https://assets.example.test/favicon.ico" });
    expect(library.liveAt).toEqual(expect.any(Number));
    // Its card's time is when its owners last put their settings live: a software update leaves it, a publish moves it.
    expect(library.publishedAt).toBe(library.liveAt);
    const putLive = (at: number, published: boolean) => fixture.t.run(async (ctx) => {
      await noteLive(ctx, (await ctx.db.get("evidenceLibraries", library._id))!, library.activeRevisionId!, at, published);
      return (await ctx.db.get("evidenceLibraries", library._id))?.publishedAt;
    });
    expect(await putLive(library.liveAt! + 60_000, false)).toBe(library.liveAt);
    expect(await putLive(library.liveAt! + 120_000, true)).toBe(library.liveAt! + 120_000);
    await fixture.t.mutation(internal.evidenceLibraries.directory.setRecords, { libraryId: library._id, records: 1234 });
    expect(await fixture.t.run((ctx) => ctx.db.get("evidenceLibraries", library._id))).toMatchObject({ records: 1234, recordsAt: expect.any(Number) });
  });

  it("keeps the countries a community names and counts the people working on it: its owners and everyone given a role", async () => {
    const { fixture, library, workspaceId } = await live("directory_facts");
    await fixture.t.mutation(internal.evidenceLibraries.directory.setRecords, { libraryId: library._id, records: 10, countries: ["KE", "ug", "tz", "in", "bd", "np"] });
    // An older runtime names no countries: the ones kept stay.
    await fixture.t.mutation(internal.evidenceLibraries.directory.setRecords, { libraryId: library._id, records: 12 });
    const people = async () => {
      await fixture.t.mutation(internal.evidenceLibraries.directory.recountPeople, { libraryId: library._id });
      return (await list(fixture, "name", "climate"))[0];
    };
    // The organization's one admin owns it.
    expect(await people()).toMatchObject({ records: 12, countries: ["ke", "ug", "tz", "in", "bd"], people: 1 });
    await fixture.t.run(async (ctx) => {
      await ctx.db.insert("users", { clerkId: "user_editor", email: "editor@example.org", state: "active", createdAt: 1, updatedAt: 1 });
      await grantLibraryRole(ctx, library._id, "user_editor", "editor");
    });
    // The grant itself asked for the count again (./peopleCount.ts).
    expect((await fixture.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).map((job) => job.name)).toContain("evidenceLibraries/directory:recountPeople");
    expect(await people()).toMatchObject({ people: 2 });
  });

  it("lists the live ones by each sort, searched on the server, and leaves out the unlisted", async () => {
    const { fixture, library, workspaceId } = await live("directory_list");
    await fixture.t.mutation(internal.evidenceLibraries.directory.setRecords, { libraryId: library._id, records: 50 });
    await another(fixture, workspaceId, "Water Evidence", { liveAt: library.liveAt! + 1, records: 900, tagline: "Sanitation programmes", shortName: "WASH QA" });
    await another(fixture, workspaceId, "Agriculture Evidence", { liveAt: library.liveAt! - 1, description: "Crop yields in smallholder farms" });
    // Not live yet: not listed.
    await fixture.t.run((ctx) => ctx.db.insert("evidenceLibraries", { workspaceId, name: "Draft", slug: "draft", state: "provisioning", createdByClerkUserId: "someone", updatedByClerkUserId: "someone", createdAt: 1, updatedAt: 1 }));

    const names = async (sort: "newest" | "name" | "records", search?: string) => (await list(fixture, sort, search)).map((card) => card.name);
    expect(await names("newest")).toEqual(["Water Evidence", "Climate Evidence", "Agriculture Evidence"]);
    expect(await names("name")).toEqual(["Agriculture Evidence", "Climate Evidence", "Water Evidence"]);
    // By name whatever its case: one in lower case sorts among the rest, not after them.
    const lower = await another(fixture, workspaceId, "bees evidence", { liveAt: 1 });
    expect(await names("name")).toEqual(["Agriculture Evidence", "bees evidence", "Climate Evidence", "Water Evidence"]);
    await fixture.t.run((ctx) => ctx.db.delete("evidenceLibraries", lower));
    // Most first; one not counted yet goes last.
    expect(await names("records")).toEqual(["Water Evidence", "Climate Evidence", "Agriculture Evidence"]);
    expect(await names("name", "sanitation")).toEqual(["Water Evidence"]);
    // By the short name its site's header shows, which people call it by.
    expect(await names("name", "wash qa")).toEqual(["Water Evidence"]);
    // One with no tagline shows its description, and is found by it.
    expect((await list(fixture, "name", "smallholder"))[0]).toMatchObject({ name: "Agriculture Evidence", tagline: "Crop yields in smallholder farms" });
    expect(await names("name", "team directory_list")).toHaveLength(3);
    expect((await list(fixture, "name", "climate"))[0]).toMatchObject({
      _id: library._id, accentColor: "#005A9C", faviconUrl: "https://assets.example.test/favicon.ico", records: 50,
      address: "https://climate-evidence-lib.libraries.example.test", owner: { name: "Team directory_list", kind: "organization", workspaceId },
    });

    // A new name saved in its draft isn't public until it's published: the card keeps the one its site runs with.
    await fixture.t.run((ctx) => ctx.db.patch("evidenceLibraries", library._id, { name: "Renamed in the draft" }));
    expect(await names("name")).toEqual(["Agriculture Evidence", "Climate Evidence", "Water Evidence"]);
    expect(await names("name", "renamed")).toEqual([]);

    // A site that doesn't answer the record check is out of the directory, and back the first time it does.
    await fixture.t.mutation(internal.evidenceLibraries.directory.noteUnreachable, { libraryId: library._id });
    expect(await names("name")).toEqual(["Agriculture Evidence", "Water Evidence"]);
    await fixture.t.mutation(internal.evidenceLibraries.directory.setRecords, { libraryId: library._id, records: 50 });
    expect(await names("name")).toHaveLength(3);

    // Unlisted by an owner: out of the directory, and back once public again.
    await fixture.admin.mutation(api.evidenceLibraries.assistant.setVisibility, { workspaceId, libraryId: library._id, visibility: "unlisted" });
    expect(await names("name")).toEqual(["Agriculture Evidence", "Water Evidence"]);
    await fixture.admin.mutation(api.evidenceLibraries.assistant.setVisibility, { workspaceId, libraryId: library._id, visibility: "public" });
    expect(await names("name")).toHaveLength(3);
  });

  it("names a person who owns a community by their name, never their email", async () => {
    const { fixture, workspaceId } = await live("directory_person");
    const personal = await fixture.t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { clerkId: "user_person", email: "private@example.org", state: "active", createdAt: 1, updatedAt: 1 });
      return (await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", userId)).unique())!._id;
    });
    await another(fixture, personal, "Solo Evidence", { liveAt: 1 });
    const solo = (await list(fixture, "name", "solo"))[0];
    expect(solo.owner).toEqual({ name: null, kind: "person", imageUrl: null, workspaceId: personal, colour: null });
    expect(JSON.stringify(await list(fixture, "name"))).not.toContain("private@example.org");
  });

  it("lets only an owner unlist a community", async () => {
    const { fixture, library, workspaceId } = await live("directory_owner");
    await fixture.t.run(async (ctx) => {
      await ctx.db.insert("users", { clerkId: "user_member", email: "member@example.org", state: "active", createdAt: 1, updatedAt: 1 });
      const workspace = await ctx.db.get("workspaces", workspaceId);
      if (workspace?.kind !== "organization") throw new Error("not an organization");
      await ctx.db.insert("organizationMemberships", { organizationId: workspace.organizationId, clerkMembershipId: "m_member", clerkUserId: "user_member", role: "org:member", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
    });
    const member = fixture.t.withIdentity({ subject: "user_member" });
    await expect(member.mutation(api.evidenceLibraries.assistant.setVisibility, { workspaceId, libraryId: library._id, visibility: "unlisted" })).rejects.toThrow(/FORBIDDEN/);
    expect((await fixture.t.run((ctx) => ctx.db.get("evidenceLibraries", library._id)))?.unlisted).toBeUndefined();
  });

  it("gives a community whose row doesn't say so its card, when it went live and when its owners last put their settings live", async () => {
    const { fixture, library } = await live("directory_backfill");
    const setup = (await fixture.t.run((ctx) => ctx.db.query("evidenceLibraryConfigOperations").withIndex("by_libraryId_and_kind_and_createdAt", (q) => q.eq("libraryId", library._id).eq("kind", "setup")).first()))!;
    // It went live with its first settings.
    const first = (await fixture.t.run((ctx) => ctx.db.query("evidenceLibraryConfigRevisions").withIndex("by_libraryId_and_revisionNumber", (q) => q.eq("libraryId", library._id)).first()))!;
    // Since then, a software update put the same settings live again, and its time was taken for a publish.
    const later = setup.completedAt! + 60_000;
    await fixture.t.run(async (ctx) => {
      const { _id, _creationTime, ...operation } = setup;
      await ctx.db.insert("evidenceLibraryConfigOperations", { ...operation, kind: "publish", idempotencyKey: "runtime-update", activationEditVersion: undefined, createdAt: later, completedAt: later, runtimeUpdate: { from: "a", to: "b", fromImage: "a", toImage: "b" } });
      // An activation of theirs that failed doesn't count either.
      await ctx.db.insert("evidenceLibraryConfigOperations", { ...operation, kind: "publish", status: "failed", idempotencyKey: "failed-publish", activationEditVersion: 2, createdAt: later, completedAt: later });
      await ctx.db.patch("evidenceLibraries", library._id, { card: undefined, liveAt: undefined, publishedAt: later });
    });
    await fixture.t.run(async (ctx) => backfillCard(ctx, (await ctx.db.get("evidenceLibraries", library._id))!));
    expect(await fixture.t.run((ctx) => ctx.db.get("evidenceLibraries", library._id))).toMatchObject({ card: { accentColor: "#005A9C" }, liveAt: first.createdAt, publishedAt: setup.completedAt });
  });
});
