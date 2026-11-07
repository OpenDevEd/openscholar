// An Evidence Library's draft as the assistant works it (#329): the configuration page's own reads
// and save, run as the person the assistant acts for, with an undo for every change it makes unasked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { createActivatedSetupFixture, createDraftSetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";
import { ensureWorkspace } from "../workspaces/create";
import { organizationWorkspaceOf, personalWorkspaceOf } from "../workspaces/personal";
import { evidenceLibraryUploadPrefix } from "../../lib/evidence-libraries/configuration/uploads";
import { AI_PROVIDER, AI_PROVIDER_KEY_PATH } from "../../lib/evidence-libraries/configuration/ai";
import { TEST_AI_MODELS } from "../../lib/evidence-libraries/configuration/test-models";
import { seedFeatureUser } from "../organizationFeatures.test-support";

const mail = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => mail } }));

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
  it("lists the workspace's libraries and reads one's draft as its owner, and none from a chat in another workspace", async () => {
    const { t, as, libraryId } = await setup();
    expect(await t.query(internal.evidenceLibraries.assistant.librariesForAssistant, as)).toEqual({ libraries: [expect.objectContaining({ libraryId, editable: true })] });
    const draft = await t.query(internal.evidenceLibraries.assistant.draftForAssistant, { ...as, libraryId, sections: ["identity"] });
    expect(draft).toMatchObject({ libraryId, editable: true, sections: [{ sectionKey: "identity" }] });
    // From their own workspace's chat, the organization's library isn't there: its people don't read that chat.
    const own = { userId: as.userId, workspaceId: await t.run((ctx) => personalWorkspaceOf(ctx, as.userId)) };
    expect(await t.query(internal.evidenceLibraries.assistant.librariesForAssistant, own)).toEqual({ libraries: [] });
    await expect(t.query(internal.evidenceLibraries.assistant.draftForAssistant, { ...own, libraryId })).rejects.toThrow(/not found/);
    await expect(t.query(internal.evidenceLibraries.assistant.teamForAssistant, { ...own, libraryId })).rejects.toThrow(/not found/);
  });

  it("changes values unasked with an undo that puts them back, two undone in turn, and keeps uploads and prototypes out of reach", async () => {
    const { t, as, libraryId, admin } = await setup();
    const read = () => t.query(internal.evidenceLibraries.assistant.draftForAssistant, { ...as, libraryId, sections: ["identity"] });
    type Change = { sectionKey: "identity" | "analytics" | "localization"; path: Array<string | number>; value?: unknown };
    const edit = (changes: Change[], check: { expectedEditVersion: number } | { unchanged: string }, approved?: true) =>
      t.mutation(internal.evidenceLibraries.assistant.editDraftForAssistant, { ...as, libraryId, changes, ...check, ...(approved ? { approved } : {}) });
    const undo = (result: Awaited<ReturnType<typeof edit>>) => edit(result.undo!.args.changes as Change[], { unchanged: result.undo!.args.unchanged }, true);
    const before = await read();
    const identity = before.sections[0].payload as Record<string, unknown>;

    expect(before.problems).toEqual([]);
    // A change the page would flag comes back with what it flags, so the assistant sees what it left wanting.
    const flagged = await edit([{ sectionKey: "localization", path: ["defaultLocale"], value: "fr" }], { expectedEditVersion: before.editVersion });
    expect(flagged.problems).toEqual([{ card: "languages", problem: "languages" }]);
    expect((await read()).problems).toEqual(flagged.problems);
    await undo(flagged);
    const first = await edit([{ sectionKey: "identity", path: ["name"], value: "Renamed library" }], { expectedEditVersion: (await read()).editVersion });
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

  it("tells an owner why the last attempt to put the draft live failed, and nothing of a teardown's", async () => {
    const { t, as, libraryId } = await setup();
    const read = async () => (await t.query(internal.evidenceLibraries.assistant.draftForAssistant, { ...as, libraryId })).failed;
    const fail = (kind: "publish" | "teardown", after: number) =>
      t.run((ctx) => ctx.db.insert("evidenceLibraryConfigOperations", { libraryId, kind, idempotencyKey: `${kind}-failed`, status: "failed", stage: "validating", attemptCount: 1, error: { code: "CONFIGURATION_INVALID", message: "The configuration has problems.", stage: "validating" }, issues: [{ pointer: "/contact/email", message: "Enter a contact email." }], requestedByClerkUserId: "user_drafts", createdAt: Date.now() + after, updatedAt: Date.now() + after }));
    await fail("publish", 1_000);
    expect(await read()).toEqual({ kind: "publish", error: "The configuration has problems.", issues: [{ pointer: "/contact/email", message: "Enter a contact email." }] });
    await fail("teardown", 2_000);
    expect(await read()).toBeUndefined();
  });

  it("says the AI card wants a key only while none is stored, as the page does", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "44".repeat(32));
    const { t, admin, as, libraryId } = await setup();
    const read = async () => (await t.query(internal.evidenceLibraries.assistant.draftForAssistant, { ...as, libraryId })).problems.map(({ problem }) => problem);
    const { editVersion } = await t.query(internal.evidenceLibraries.assistant.draftForAssistant, { ...as, libraryId });
    await t.mutation(internal.evidenceLibraries.assistant.editDraftForAssistant, { ...as, libraryId, changes: [{ sectionKey: "features", path: [], value: { ai: true } }, { sectionKey: "ai", path: [], value: { providers: [{ provider: AI_PROVIDER, enabled: true, models: [TEST_AI_MODELS[0]], defaultModel: TEST_AI_MODELS[0] }] } }], expectedEditVersion: editVersion, approved: true });
    expect(await read()).toContain("aiKey");
    await admin.action(api.evidenceLibraries.credentialActions.writeCredential, { libraryId, concretePath: AI_PROVIDER_KEY_PATH, instanceKey: AI_PROVIDER, value: `sk-or-v1-${"0".repeat(48)}` });
    expect(await read()).not.toContain("aiKey");
    vi.unstubAllEnvs();
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
    await expect(t.mutation(internal.evidenceLibraries.assistant.addMemberForAssistant, { ...allowed, email: "stranger@example.org", role: "editor" })).rejects.toThrow(/No member of the community's organization/);
  });
});

describe("a library's invitations, its start and the running library, for the assistant", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("EL_COOLIFY_ENVIRONMENT", "development");
    vi.stubEnv("EL_SMTP_HOST", "smtp.example.test");
    vi.stubEnv("EL_SMTP_FROM", "libraries@example.test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
    vi.stubEnv("CLERK_SECRET_KEY", "test-clerk-key");
    mail.sendMail.mockReset().mockResolvedValue({});
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ email_addresses: [{ email_address: "outside@example.org", verification: { status: "verified" } }] })));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function activated() {
    const { t, clerkUserId, created, organizationId } = await createActivatedSetupFixture("assistant-invitations");
    const ownerId = (await t.run((ctx) => ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId)).unique()))!._id;
    const owner = { userId: ownerId, workspaceId: await t.run((ctx) => organizationWorkspaceOf(ctx, organizationId)) };
    const ownerAlone = { userId: ownerId, workspaceId: await t.run((ctx) => ensureWorkspace(ctx, { kind: "personal", userId: ownerId })) };
    const outsideId = await t.run((ctx) => ctx.db.insert("users", { clerkId: "outside", email: "outside@example.org", state: "active", createdAt: 1, updatedAt: 1 }));
    const outside = { userId: outsideId, workspaceId: await t.run((ctx) => ensureWorkspace(ctx, { kind: "personal", userId: outsideId })) };
    return { t, owner, ownerAlone, outside, libraryId: created.libraryId };
  }

  it("invites by email as the owner, changes the invitation, and lets the invited person answer it in their own workspace", async () => {
    const { t, owner, ownerAlone, outside, libraryId } = await activated();
    const assistant = internal.evidenceLibraries.assistant;
    await t.action(assistant.inviteForAssistant, { ...owner, libraryId, email: "Outside@example.org", role: "creator", approved: true });
    expect(mail.sendMail.mock.calls[0][0]).toMatchObject({ to: "outside@example.org" });
    // Not from a chat in a workspace the library isn't in.
    await expect(t.action(assistant.inviteForAssistant, { ...ownerAlone, libraryId, email: "other@example.org", role: "editor", approved: true })).rejects.toThrow(/not found/);

    const [invitation] = await t.query(assistant.invitationsForAssistant, outside);
    expect(invitation).toMatchObject({ libraryId, role: "creator" });
    await t.mutation(assistant.changeInvitationForAssistant, { ...owner, invitationId: invitation.invitationId, role: "editor", approved: true });
    // An invitation is answered where what's offered to someone is: their own workspace.
    await expect(t.action(assistant.answerInvitationForAssistant, { ...owner, invitationId: invitation.invitationId, accept: true, approved: true })).rejects.toThrow(/own workspace/);
    await t.action(assistant.answerInvitationForAssistant, { ...outside, invitationId: invitation.invitationId, accept: true, approved: true });
    expect(await t.run((ctx) => ctx.db.query("itemAccess").withIndex("by_item_and_user", (q) => q.eq("item", libraryId).eq("userId", outside.userId)).unique())).toMatchObject({ role: "editor" });
    expect(await t.query(assistant.invitationsForAssistant, outside)).toEqual([]);
    // Shared with them, the library is theirs to read in their own workspace.
    expect((await t.query(assistant.librariesForAssistant, outside)).libraries).toEqual([expect.objectContaining({ libraryId, editable: false })]);
  });

  it("starts a community only where the person may create one, and reads the running library only from its workspace", async () => {
    const { t, owner, ownerAlone, libraryId } = await activated();
    const assistant = internal.evidenceLibraries.assistant;
    // Their own workspace, with Evidence Communities off for it.
    await expect(t.action(assistant.startLibraryForAssistant, { ...ownerAlone, name: "Tutoring evidence", approved: true })).rejects.toThrow(/FORBIDDEN/);
    // What would refuse a change is found before the person is asked about it.
    const refusal = (where: typeof owner, path: string, input: object) => t.query(internal.assistant.asking.check, { ...where, path: `evidenceLibraries/assistant:${path}`, input: JSON.stringify(input) });
    expect(await refusal(ownerAlone, "startLibrary", { name: "Tutoring evidence" })).toMatch(/once Evidence Communities are on for it/);
    expect(await refusal(ownerAlone, "invite", { libraryId, email: "other@example.org", role: "editor" })).toMatch(/not found/);
    expect(await refusal(owner, "answerInvitation", { invitationId: "x", accept: true })).toMatch(/own workspace/);
    expect(await refusal(owner, "syncSource", { libraryId, sourceKey: "openalex" })).toBeNull();
    // One that isn't running yet has nothing to list, and says so.
    expect(await t.action(assistant.runningCollectionsForAssistant, { ...owner, libraryId })).toMatchObject({ reason: "not-set-up", page: [] });
    expect(await t.query(assistant.sourcesForAssistant, { ...owner, libraryId })).toBeNull();
    await expect(t.action(assistant.syncSourceForAssistant, { ...ownerAlone, libraryId, sourceKey: "openalex", approved: true })).rejects.toThrow(/not found/);
    // A retry the library can't run fails, never reads as done.
    await expect(t.action(assistant.syncSourceForAssistant, { ...owner, libraryId, sourceKey: "openalex", approved: true })).rejects.toThrow(/isn't running yet/);
  });
});
