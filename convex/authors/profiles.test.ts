import { seedOrganizationFeatures } from "../organizationFeatures.test-support";
import { seedCreditsForTest } from "../billing/billing.test-support";
import { EVIDENCE_LIBRARIES_FEATURE } from "../../lib/billing/plans";
/// <reference types="vite/client" />
import { register as registerPresence } from "@convex-dev/presence/test";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { personalWorkspaceOf } from "../workspaces/personal";
import { grantLibraryRole } from "../evidenceLibraries/team.test-support";
const modules = import.meta.glob("/convex/**/*.ts");
const mail = vi.hoisted(() => ({sendMail: vi.fn().mockResolvedValue({}), close: vi.fn()}));
vi.mock("nodemailer", () => ({default: {createTransport: () => mail}}));
const content = {name: "Caitlin Mills", headline: "Learning scientist", affiliation: "University of Minnesota", bio: "Research on attention and learning.", website: "", linkedin: "", orcid: "0000-0002-1825-0097", openalex: "A123456"};

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const fields = {state: "active" as const, createdAt: 1, updatedAt: 1};
    const ids = {
      owner: await ctx.db.insert("users", {...fields, clerkId: "owner", email: "owner@example.org"}),
      editor: await ctx.db.insert("users", {...fields, clerkId: "editor", email: "editor@example.org"}),
    };
    // A profile is made where the workspace's plan includes Evidence Libraries: here, each one's own.
    for (const userId of Object.values(ids)) await seedCreditsForTest(ctx, {userId, features: [EVIDENCE_LIBRARIES_FEATURE]});
    return ids;
  });
  const owner = t.withIdentity({subject: "owner"});
  const editor = t.withIdentity({subject: "editor"});
  const profileId = await owner.mutation(api.authors.profiles.create, {name: content.name});
  return {t, owner, editor, ids, profileId};
}

describe("author profiles", () => {
  it("keep their Activity for the workspace that owns them, where its members see who has one open", async () => {
    const t = convexTest(schema, modules);
    registerPresence(t);
    const lab = await t.run(async ctx => {
      const fields = {state: "active" as const, createdAt: 1, updatedAt: 1};
      for (const clerkId of ["maker", "member", "outsider"]) await ctx.db.insert("users", {...fields, clerkId, firstName: clerkId, email: `${clerkId}@example.org`});
      const organizationId = await seedOrganizationFeatures(ctx, ["maker", "member"], { evidenceLibraries: true });
      // The maker runs the lab, whose admins make its profiles.
      const maker = await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_clerkUserId_and_state", q => q.eq("organizationId", organizationId).eq("clerkUserId", "maker").eq("state", "active")).unique();
      await ctx.db.patch("organizationMemberships", maker!._id, {role: "org:admin"});
      return (await ctx.db.query("workspaces").withIndex("by_organizationId", q => q.eq("organizationId", organizationId)).unique())!._id;
    });
    const as = (subject: string) => t.withIdentity({subject});
    const profileId = await as("maker").mutation(api.authors.profiles.create, {workspaceId: lab, name: "Lab author"});
    const saved = await as("maker").mutation(internal.authors.profiles.saveWithPhoto, {profileId, expectedRevision: 1, content: {...content, name: "Lab author"}});
    await as("maker").mutation(internal.authors.profiles.saveWithPhoto, {profileId, expectedRevision: saved.revision, content});
    const maker = (await t.run(ctx => ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", "maker")).unique()))!._id;
    const invite = () => t.mutation(internal.sharing.invitations.prepare, {userId: maker, workspaceId: lab, author: "user", kind: "author", id: profileId, email: "outsider@example.org", role: "editor"});
    await invite();
    // Sending the invitation again is no new change.
    await invite();
    const item = {workspaceId: lab, kind: "author" as const, id: profileId};
    const page = {paginationOpts: {cursor: null, numItems: 10}};
    expect((await as("member").query(api.activity.queries.list, {...item, ...page})).page.map(({by, happened, detail}) => ({by: by.name, happened, detail}))).toEqual([
      {by: "maker", happened: "shared", detail: "outsider@example.org"},
      {by: "maker", happened: "renamed", detail: "Lab author"},
      {by: "maker", happened: "edited", detail: undefined},
      {by: "maker", happened: "created", detail: "Lab author"},
    ]);
    // The profile's read says who is of the workspace that owns it: they are shown its Activity.
    expect(await Promise.all(["maker", "member", "outsider"].map(async subject => (await as(subject).query(api.authors.profiles.get, {profileId}))?.member))).toEqual([true, true, false]);
    // A member with it open is named to the others, and nobody outside the lab joins its room.
    await as("member").mutation(api.presence.heartbeat, {...item, sessionId: "member-tab"});
    expect((await as("maker").query(api.presence.here, {...item, ...page})).page.map(person => person.name)).toEqual(["member"]);
    await expect(as("outsider").mutation(api.presence.heartbeat, {...item, sessionId: "outsider-tab"})).rejects.toThrow();

    // The lab is deleted. The profile stays public, in no workspace, and nobody is left invited to edit it.
    const organizationId = await t.run(async ctx => {
      const workspace = await ctx.db.get("workspaces", lab);
      if (workspace?.kind !== "organization") throw new Error("The lab is an organization's workspace");
      await ctx.db.patch("organizations", workspace.organizationId, {state: "deleted"});
      return workspace.organizationId;
    });
    vi.useFakeTimers();
    try {
      await t.mutation(internal.workspaces.purge.purgeOrganization, {organizationId});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally { vi.useRealTimers(); }
    expect((await t.run(ctx => ctx.db.get("authorProfiles", profileId)))?.workspaceId).toBeUndefined();
    expect(await t.run(ctx => ctx.db.query("itemInvitations").collect())).toEqual([]);
  });

  it("are owned by the workspace they were made in, by its admins; their maker who doesn't run it edits them, as anyone invited does", async () => {
    const t = convexTest(schema, modules);
    const lab = await t.run(async ctx => {
      const fields = {state: "active" as const, createdAt: 1, updatedAt: 1};
      for (const clerkId of ["admin", "maker", "member", "outsider"]) await ctx.db.insert("users", {...fields, clerkId, email: `${clerkId}@example.org`});
      const organizationId = await seedOrganizationFeatures(ctx, ["admin", "maker", "member"], { evidenceLibraries: true });
      const admin = await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_clerkUserId_and_state", q => q.eq("organizationId", organizationId).eq("clerkUserId", "admin").eq("state", "active")).unique();
      await ctx.db.patch("organizationMemberships", admin!._id, {role: "org:admin"});
      const workspaceId = (await ctx.db.query("workspaces").withIndex("by_organizationId", q => q.eq("organizationId", organizationId)).unique())!._id;
      // The maker edits one of the lab's communities, which lets them make its profiles.
      const libraryId = await ctx.db.insert("evidenceLibraries", {workspaceId, name: "Lab Evidence", slug: "lab-evidence", state: "active", createdByClerkUserId: "admin", updatedByClerkUserId: "admin", createdAt: 1, updatedAt: 1} as never);
      await grantLibraryRole(ctx, libraryId, "maker", "editor");
      return workspaceId;
    });
    const as = (subject: string) => t.withIdentity({subject});
    // A colleague who runs the lab or edits one of its communities makes them; any other member doesn't.
    await expect(as("member").mutation(api.authors.profiles.create, {workspaceId: lab, name: "Not theirs"})).rejects.toThrow(/owners and admins/);
    const profileId = await as("maker").mutation(api.authors.profiles.create, {workspaceId: lab, name: "Lab author"});
    expect(await t.run(ctx => ctx.db.get("authorProfiles", profileId))).toMatchObject({workspaceId: lab});
    const role = async (subject: string) => (await as(subject).query(api.authors.profiles.get, {profileId}))?.role;
    // The lab's admin owns it; its maker, who doesn't run the lab, edits it.
    expect([await role("admin"), await role("maker"), await role("member")]).toEqual(["owner", "editor", null]);
    const members = await as("admin").query(api.authors.members.list, {profileId});
    expect(members.members.map(member => [member.email, member.role]).sort()).toEqual([["admin@example.org", "owner"], ["maker@example.org", "editor"]]);
    // Sharing it is its owners' alone: an editor, its maker included, invites nobody to it.
    const userOf = async (clerkId: string) => (await t.run(ctx => ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", clerkId)).unique()))!._id;
    const invite = async (by: string, email: string) => t.mutation(internal.sharing.invitations.prepare, {userId: await userOf(by), workspaceId: lab, author: "user", kind: "author", id: profileId, email, role: "editor"});
    await expect(invite("maker", "friend@example.org")).rejects.toThrow(/Only an owner or admin of its workspace/);
    const invited = await invite("admin", "member@example.org");
    await t.mutation(internal.sharing.invitations.respondVerified, {userId: await userOf("member"), invitationId: invited, emails: ["member@example.org"], accept: true});
    expect(await role("member")).toBe("editor");
    // Someone outside the lab can't make one there.
    await expect(as("outsider").mutation(api.authors.profiles.create, {workspaceId: lab, name: "Not mine"})).rejects.toThrow(/Workspace not found/);
    // An organization without author profiles takes none, whatever another of its members' organizations has.
    const plain = await t.run(async ctx => {
      const organizationId = await seedOrganizationFeatures(ctx, ["admin"], {});
      const admin = await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_clerkUserId_and_state", q => q.eq("organizationId", organizationId).eq("clerkUserId", "admin").eq("state", "active")).unique();
      await ctx.db.patch("organizationMemberships", admin!._id, {role: "org:admin"});
      return (await ctx.db.query("workspaces").withIndex("by_organizationId", q => q.eq("organizationId", organizationId)).unique())!._id;
    });
    await expect(as("admin").mutation(api.authors.profiles.create, {workspaceId: plain, name: "Elsewhere"})).rejects.toThrow('"code":"FORBIDDEN"');
  });

  it("is shared to edit only, by invitation as any item is", async () => {
    vi.stubEnv("EL_SMTP_HOST", "smtp.example.org");
    vi.stubEnv("EL_SMTP_FROM", "contact@platform.example");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.org");
    try {
      const {t, owner, profileId} = await setup();
      const workspaceId = (await t.run(ctx => ctx.db.get("authorProfiles", profileId)))!.workspaceId!;
      const item = {workspaceId, kind: "author" as const, id: profileId, email: "editor@example.org"};
      // A profile is public: there's nothing to share but editing it.
      await expect(owner.action(api.sharing.invitations.invite, {...item, role: "viewer"})).rejects.toThrow(/shared to edit only/);
      await owner.action(api.sharing.invitations.invite, {...item, role: "editor"});
      const invitation = (await t.run(ctx => ctx.db.query("itemInvitations").collect()))[0]!;
      expect(invitation).toMatchObject({kind: "author", item: profileId, email: "editor@example.org", role: "editor", state: "pending"});
      expect(mail.sendMail.mock.lastCall?.[0]).toMatchObject({to: "editor@example.org"});
      expect(mail.sendMail.mock.lastCall?.[0].text).toContain(`https://app.example.org/shared/${invitation._id}`);
      expect(mail.sendMail.mock.lastCall?.[0].text).toContain("author profile");
    } finally { vi.unstubAllEnvs(); }
  });

  it("keeps profile ownership separate from organization roles", async () => {
    const {t, owner, editor, profileId} = await setup();
    await expect(t.mutation(api.authors.profiles.create, {name: content.name})).rejects.toThrow();
    const duplicate = await editor.mutation(api.authors.profiles.create, {name: content.name});
    await owner.action(api.authors.photos.save, {profileId, expectedRevision: 1, content});
    await editor.action(api.authors.photos.save, {profileId: duplicate, expectedRevision: 1, content: {...content, openalex: ""}});
    expect((await t.query(api.authors.profiles.get, {profileId}))?.bio).toBe(content.bio);
    expect((await editor.query(api.authors.profiles.get, {profileId}))?.role).toBeNull();
    await expect(editor.action(api.authors.photos.save, {profileId, expectedRevision: 2, content: {...content, bio: "Overwrite"}})).rejects.toThrow();
  });

  it("allows profile members without an organization, requires the invited address and revokes editing immediately", async () => {
    const {t, owner, editor, ids, profileId} = await setup();
    const workspaceId = (await t.run(ctx => ctx.db.get("authorProfiles", profileId)))!.workspaceId!;
    const item = {workspaceId, kind: "author" as const, id: profileId};
    // A plan that no longer includes Evidence Libraries makes no more profiles; the profile it has is still its owner's to edit, and the directory is public.
    await t.run(async ctx => {
      for (const account of await ctx.db.query("billingAccounts").collect()) await ctx.db.patch("billingAccounts", account._id, {features: []});
    });
    await expect(owner.mutation(api.authors.profiles.create, {name: "Another profile"})).rejects.toThrow('"code":"FORBIDDEN"');
    for (const reader of [owner, t]) expect((await reader.query(api.authors.profiles.list, {search: "", paginationOpts: {numItems: 10, cursor: null}})).page.map(profile => profile._id)).toEqual([profileId]);
    await owner.action(api.authors.photos.save, {profileId, expectedRevision: 1, content});
    const invitationId = await t.mutation(internal.sharing.invitations.prepare, {userId: ids.owner, author: "user", ...item, email: "Editor@example.org", role: "editor"});
    const waiting = async (person: typeof editor) => (await person.query(api.authors.invitations.listInvitations, {})).page;
    expect(await waiting(editor)).toEqual([{invitationId, profileId, name: content.name}]);
    expect(await waiting(owner)).toEqual([]);
    // Its owner sees it waiting, and it holds a guest's place.
    expect((await owner.query(api.authors.members.list, {profileId})).invitations).toEqual([{_id: invitationId, email: "editor@example.org", delivery: "queued"}]);
    await expect(t.mutation(internal.sharing.invitations.respondVerified, {userId: ids.editor, invitationId, emails: [], accept: true})).rejects.toThrow();
    await t.mutation(internal.sharing.invitations.respondVerified, {userId: ids.editor, invitationId, emails: ["editor@example.org"], accept: true});
    expect(await waiting(editor)).toEqual([]);
    // An editor edits it from wherever they are, sees who has it, and gives it to nobody: sharing it is its workspace's.
    expect((await editor.query(api.authors.profiles.get, {profileId}))?.role).toBe("editor");
    await editor.action(api.authors.photos.save, {profileId, expectedRevision: 2, content: {...content, bio: "Edited by a profile collaborator"}});
    expect((await editor.query(api.authors.members.list, {profileId})).members.map(member => [member.email, member.role])).toEqual([["owner@example.org", "owner"], ["editor@example.org", "editor"]]);
    const editorOwn = await t.run(ctx => personalWorkspaceOf(ctx, ids.editor));
    await expect(t.mutation(internal.sharing.invitations.prepare, {userId: ids.editor, workspaceId: editorOwn, author: "user", kind: "author", id: profileId, email: "third@example.org", role: "editor"})).rejects.toThrow();
    await expect(editor.mutation(api.sharing.guests.remove, {...item, workspaceId: editorOwn, guest: {userId: ids.owner}})).rejects.toThrow();
    // It shows among what's shared with them, and removing them ends their editing at once.
    expect((await editor.query(api.sharing.shared.list, {workspaceId: editorOwn, sort: "recent", paginationOpts: {cursor: null, numItems: 5}})).page).toMatchObject([{kind: "author", id: profileId, name: content.name, role: "editor"}]);
    await owner.mutation(api.sharing.guests.remove, {...item, guest: {userId: ids.editor}});
    await expect(editor.action(api.authors.photos.save, {profileId, expectedRevision: 3, content})).rejects.toThrow();
    expect((await t.query(api.authors.profiles.get, {profileId}))?.bio).toBe("Edited by a profile collaborator");
  });

  it("rejects cancelled invitations and concurrent overwrites", async () => {
    const {t, owner, ids, profileId} = await setup();
    const workspaceId = (await t.run(ctx => ctx.db.get("authorProfiles", profileId)))!.workspaceId!;
    const item = {workspaceId, kind: "author" as const, id: profileId};
    const invitationId = await t.mutation(internal.sharing.invitations.prepare, {userId: ids.owner, author: "user", ...item, email: "editor@example.org", role: "editor"});
    await owner.mutation(api.sharing.guests.remove, {...item, guest: {email: "editor@example.org"}});
    await expect(t.mutation(internal.sharing.invitations.respondVerified, {userId: ids.editor, invitationId, emails: ["editor@example.org"], accept: true})).rejects.toThrow();
    await owner.action(api.authors.photos.save, {profileId, expectedRevision: 1, content});
    await expect(owner.action(api.authors.photos.save, {profileId, expectedRevision: 1, content: {...content, bio: "Stale edit"}})).rejects.toThrow();
    expect((await owner.query(api.authors.profiles.get, {profileId}))?.bio).toBe(content.bio);
  });

  it("stores a photo without allowing stale saves to delete the current file", async () => {
    const {t, owner, editor, profileId} = await setup();
    const photo = "data:image/png;base64,iVBORw0KGgo=";
    const result = await owner.action(api.authors.photos.save, {profileId, expectedRevision: 1, content: {...content, website: "https://example.org"}, photo});
    expect(result).toMatchObject({revision: 2, website: "https://example.org/", photo: expect.stringMatching(/^https?:/)});
    const saved = await t.query(api.authors.profiles.get, {profileId});
    expect(saved?.photo).toMatch(/^https?:/);
    const stored = await t.run(ctx => ctx.db.get("authorProfiles", profileId));
    expect(stored?.photoId).toBeDefined();
    await expect(owner.action(api.authors.photos.save, {profileId, expectedRevision: 1, content, photo})).rejects.toThrow();
    await expect(editor.action(api.authors.photos.save, {profileId, expectedRevision: 2, content, photo: ""})).rejects.toThrow();
    expect(await t.run(async ctx => Boolean(await ctx.storage.get(stored!.photoId!)))).toBe(true);
    const removed = await owner.action(api.authors.photos.save, {profileId, expectedRevision: 2, content, photo: ""});
    expect(removed).toMatchObject({revision: 3, photo: null});
    expect((await t.query(api.authors.profiles.get, {profileId}))?.photo).toBeNull();
    expect(await t.run(async ctx => Boolean(await ctx.storage.get(stored!.photoId!)))).toBe(false);
  });

});
