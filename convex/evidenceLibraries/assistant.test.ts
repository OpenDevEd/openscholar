// An Evidence Library's draft as the assistant works it (#329): the configuration page's own reads
// and save, run as the person the assistant acts for, with an undo for every change it makes unasked.
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import { createDraftSetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";
import { organizationWorkspaceOf } from "../workspaces/personal";
import { evidenceLibraryUploadPrefix } from "../../lib/evidence-libraries/configuration/uploads";

async function setup() {
  const { t, clerkUserId, created, organizationId } = await createDraftSetupFixture("drafts");
  const userId = (await t.run((ctx) => ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId)).unique()))!._id;
  const workspaceId = await t.run((ctx) => organizationWorkspaceOf(ctx, organizationId));
  return { t, as: { userId, workspaceId }, libraryId: created.libraryId };
}

describe("an Evidence Library's draft, for the assistant", () => {
  it("lists the workspace's libraries and reads one's draft as its owner", async () => {
    const { t, as, libraryId } = await setup();
    expect(await t.query(internal.evidenceLibraries.assistant.librariesForAssistant, as)).toEqual([expect.objectContaining({ libraryId, editable: true })]);
    const draft = await t.query(internal.evidenceLibraries.assistant.draftForAssistant, { ...as, libraryId, sections: ["identity"] });
    expect(draft).toMatchObject({ libraryId, editable: true, sections: [{ sectionKey: "identity" }] });
  });

  it("saves a section unasked with an undo that puts it back, keeps the library's uploads, and asks before a change nothing undoes", async () => {
    const { t, as, libraryId } = await setup();
    const read = () => t.query(internal.evidenceLibraries.assistant.draftForAssistant, { ...as, libraryId, sections: ["identity"] });
    const before = await read();
    const identity = before.sections[0].payload as Record<string, unknown>;
    const save = (sections: Array<{ sectionKey: "identity" | "analytics"; payload: unknown }>, expectedEditVersion: number, approved?: true) =>
      t.mutation(internal.evidenceLibraries.assistant.saveSectionsForAssistant, { ...as, libraryId, sections, expectedEditVersion, ...(approved ? { approved } : {}) });

    const saved = await save([{ sectionKey: "identity", payload: { ...identity, name: "Renamed library" } }], before.editVersion);
    expect((await read()).sections[0].payload).toMatchObject({ name: "Renamed library" });
    expect(saved.undo).toMatchObject({ path: "evidenceLibraries/assistant:saveSections", args: { libraryId, sections: [{ sectionKey: "identity", payload: identity }], expectedEditVersion: saved.editVersion } });
    await t.mutation(internal.evidenceLibraries.assistant.saveSectionsForAssistant, { ...as, ...saved.undo!.args, approved: true });
    expect((await read()).sections[0].payload).toEqual(identity);

    // A logo or a photo is uploaded on the page, which deletes the file it replaces.
    const after = await read();
    const upload = `https://storage.example.test/openscholar/${evidenceLibraryUploadPrefix(libraryId)}logo.png`;
    await expect(save([{ sectionKey: "identity", payload: { ...identity, logo: upload } }], after.editVersion)).rejects.toThrow(/uploaded files/);
    // A section the draft hasn't got can't be taken back out, so it's asked about first.
    await expect(save([{ sectionKey: "analytics", payload: {} }], after.editVersion)).rejects.toThrow(/say first/);
  });
});
