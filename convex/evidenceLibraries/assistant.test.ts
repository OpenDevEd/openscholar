// An Evidence Library's draft as the assistant works it (#329): the configuration page's own reads
// and save, run as the person the assistant acts for, with an undo for every change it makes unasked.
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import { createDraftSetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";
import { organizationWorkspaceOf } from "../workspaces/personal";
import { evidenceLibraryUploadPrefix } from "../../lib/evidence-libraries/configuration/uploads";
import { seedFeatureUser } from "../organizationFeatures.test-support";

async function setup() {
  const { t, admin, clerkUserId, created, organizationId } = await createDraftSetupFixture("drafts");
  // A colleague in the library's organization, with no role on it yet.
  await t.run(async (ctx) => {
    await seedFeatureUser(ctx, "user_colleague");
    await ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: "orgmem_colleague", clerkUserId: "user_colleague", role: "org:member", state: "active", searchText: "user_colleague@example.org", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
  });
  const userId = (await t.run((ctx) => ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId)).unique()))!._id;
  const workspaceId = await t.run((ctx) => organizationWorkspaceOf(ctx, organizationId));
  return { t, admin, as: { userId, workspaceId }, libraryId: created.libraryId };
}

describe("an Evidence Library's draft, for the assistant", () => {
  it("lists the workspace's libraries and reads one's draft as its owner", async () => {
    const { t, as, libraryId } = await setup();
    expect(await t.query(internal.evidenceLibraries.assistant.librariesForAssistant, as)).toEqual([expect.objectContaining({ libraryId, editable: true })]);
    const draft = await t.query(internal.evidenceLibraries.assistant.draftForAssistant, { ...as, libraryId, sections: ["identity"] });
    expect(draft).toMatchObject({ libraryId, editable: true, sections: [{ sectionKey: "identity" }] });
  });

  it("changes values unasked with an undo that puts them back, two undone in turn, and keeps uploads and prototypes out of reach", async () => {
    const { t, as, libraryId, admin } = await setup();
    const read = () => t.query(internal.evidenceLibraries.assistant.draftForAssistant, { ...as, libraryId, sections: ["identity"] });
    type Change = { sectionKey: "identity" | "analytics"; path: Array<string | number>; value?: unknown };
    const edit = (changes: Change[], check: { expectedEditVersion: number } | { unchanged: string }, approved?: true) =>
      t.mutation(internal.evidenceLibraries.assistant.editDraftForAssistant, { ...as, libraryId, changes, ...check, ...(approved ? { approved } : {}) });
    const undo = (result: Awaited<ReturnType<typeof edit>>) => edit(result.undo!.args.changes as Change[], { unchanged: result.undo!.args.unchanged }, true);
    const before = await read();
    const identity = before.sections[0].payload as Record<string, unknown>;

    const first = await edit([{ sectionKey: "identity", path: ["name"], value: "Renamed library" }], { expectedEditVersion: before.editVersion });
    const second = await edit([{ sectionKey: "identity", path: ["name"], value: "Renamed again" }, { sectionKey: "identity", path: ["description"], value: "About tutoring" }], { expectedEditVersion: first.editVersion });
    expect((await t.query(internal.evidenceLibraries.assistant.draftForAssistant, { ...as, libraryId, sections: ["identity"], path: ["name"] })).sections[0].payload).toBe("Renamed again");
    // One reply's changes are undone newest first: each still finds what its edit left.
    await undo(second);
    await undo(first);
    expect((await read()).sections[0].payload).toEqual(identity);
    // Not over a value changed since.
    const third = await edit([{ sectionKey: "identity", path: ["name"], value: "Third" }], { expectedEditVersion: (await read()).editVersion });
    await edit([{ sectionKey: "identity", path: ["name"], value: "Fourth" }], { expectedEditVersion: third.editVersion });
    await expect(undo(third)).rejects.toThrow(/changed there since/);

    // A logo uploaded on the page stays where it is: not replaced, not moved, and none written in.
    const upload = `https://storage.example.test/storage/v1/object/public/openscholar/${evidenceLibraryUploadPrefix(libraryId)}image-12345678.png`;
    const now = await read();
    const assets = { ...(identity.assets as Record<string, unknown>), logoDark: upload };
    await admin.mutation(api.evidenceLibraries.mutations.saveDraftSections, { libraryId, sections: [{ sectionKey: "identity", payload: { ...(now.sections[0].payload as object), assets } }], expectedEditVersion: now.editVersion });
    const version = (await read()).editVersion;
    await expect(edit([{ sectionKey: "identity", path: ["assets", "logoDark"], value: "https://example.test/other.png" }], { expectedEditVersion: version })).rejects.toThrow(/Uploaded files/);
    await expect(edit([{ sectionKey: "identity", path: ["description"], value: upload }], { expectedEditVersion: version })).rejects.toThrow(/Uploaded files/);
    await expect(edit([{ sectionKey: "identity", path: [], value: identity }], { expectedEditVersion: version })).rejects.toThrow(/Uploaded files/);
    // A path reaches settings, never an object's prototype.
    await expect(edit([{ sectionKey: "identity", path: ["__proto__", "polluted"], value: true }], { expectedEditVersion: version })).rejects.toThrow(/has no \W+__proto__/);
    // A section the draft hasn't got can't be taken back out, so it's asked about first.
    await expect(edit([{ sectionKey: "analytics", path: [], value: {} }], { expectedEditVersion: version })).rejects.toThrow(/say first/);
  });

  it("changes a library's team as its owner, once the person allows it: a colleague by email, then their role, then not at all", async () => {
    const { t, as, libraryId } = await setup();
    const team = () => t.query(internal.evidenceLibraries.assistant.teamForAssistant, { ...as, libraryId });
    const allowed = { ...as, libraryId, approved: true as const };
    await t.mutation(internal.evidenceLibraries.assistant.addMemberForAssistant, { ...allowed, email: "USER_colleague@example.org", role: "editor" });
    expect((await team()).editors.map((person) => person.clerkUserId)).toEqual(["user_colleague"]);
    await t.mutation(internal.evidenceLibraries.assistant.changeRoleForAssistant, { ...allowed, clerkUserId: "user_colleague", role: "creator" });
    expect((await team()).creators.map((person) => person.clerkUserId)).toEqual(["user_colleague"]);
    await t.mutation(internal.evidenceLibraries.assistant.removeMemberForAssistant, { ...allowed, clerkUserId: "user_colleague" });
    expect([...(await team()).editors, ...(await team()).creators]).toEqual([]);
    // Someone outside the organization is invited on the library's page.
    await expect(t.mutation(internal.evidenceLibraries.assistant.addMemberForAssistant, { ...allowed, email: "stranger@example.org", role: "editor" })).rejects.toThrow(/No member of the library's organization/);
  });
});
