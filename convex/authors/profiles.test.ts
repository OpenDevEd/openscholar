import { seedOrganizationFeatures } from "../organizationFeatures.test-support";
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
const modules = import.meta.glob("/convex/**/*.ts");
const mail = vi.hoisted(() => ({sendMail: vi.fn().mockResolvedValue({}), close: vi.fn()}));
vi.mock("nodemailer", () => ({default: {createTransport: () => mail}}));
const content = {name: "Caitlin Mills", headline: "Learning scientist", affiliation: "University of Minnesota", bio: "Research on attention and learning.", website: "", linkedin: "", orcid: "0000-0002-1825-0097", openalex: "A123456"};

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    await seedOrganizationFeatures(ctx, ["owner", "editor"], { authors: true });
    const fields = {state: "active" as const, createdAt: 1, updatedAt: 1};
    return {
      owner: await ctx.db.insert("users", {...fields, clerkId: "owner", email: "owner@example.org"}),
      editor: await ctx.db.insert("users", {...fields, clerkId: "editor", email: "editor@example.org"}),
    };
  });
  const owner = t.withIdentity({subject: "owner"});
  const editor = t.withIdentity({subject: "editor"});
  const profileId = await owner.mutation(api.authors.profiles.create, {name: content.name});
  return {t, owner, editor, ids, profileId};
}

describe("author profiles", () => {
  it("are owned by the workspace they were made in: by their maker and its admins, and edited by others only when invited", async () => {
    const t = convexTest(schema, modules);
    const lab = await t.run(async ctx => {
      const fields = {state: "active" as const, createdAt: 1, updatedAt: 1};
      for (const clerkId of ["admin", "maker", "member", "outsider"]) await ctx.db.insert("users", {...fields, clerkId, email: `${clerkId}@example.org`});
      const organizationId = await seedOrganizationFeatures(ctx, ["admin", "maker", "member"], {authors: true});
      const admin = await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_clerkUserId_and_state", q => q.eq("organizationId", organizationId).eq("clerkUserId", "admin").eq("state", "active")).unique();
      await ctx.db.patch("organizationMemberships", admin!._id, {role: "org:admin"});
      return (await ctx.db.query("workspaces").withIndex("by_organizationId", q => q.eq("organizationId", organizationId)).unique())!._id;
    });
    const as = (subject: string) => t.withIdentity({subject});
    const profileId = await as("maker").mutation(api.authors.profiles.create, {workspaceId: lab, name: "Lab author"});
    expect(await t.run(ctx => ctx.db.get("authorProfiles", profileId))).toMatchObject({workspaceId: lab});
    const role = async (subject: string) => (await as(subject).query(api.authors.profiles.get, {profileId}))?.role;
    expect(await role("maker")).toBe("owner");
    expect(await role("admin")).toBe("owner");
    expect(await role("member")).toBeNull();
    // Its people list the maker and the lab's admin as owners; an owner isn't removed as an editor would be.
    const members = await as("maker").query(api.authors.members.list, {profileId});
    // The one reading it is marked, for their You chip.
    expect(members.members.map(member => [member.email, member.role, member.you])).toEqual([["maker@example.org", "owner", true], ["admin@example.org", "owner", false]]);
    const adminId = members.members.find(member => member.email === "admin@example.org")!.userId;
    await expect(as("maker").mutation(api.authors.members.remove, {profileId, userId: adminId})).rejects.toThrow(/owns the profile/);
    // Someone outside the lab can't make one there.
    await expect(as("outsider").mutation(api.authors.profiles.create, {workspaceId: lab, name: "Not mine"})).rejects.toThrow(/Workspace not found/);
    // An organization without author profiles takes none, whatever another of its members' organizations has.
    const plain = await t.run(async ctx => {
      const organizationId = await seedOrganizationFeatures(ctx, ["maker"], {});
      return (await ctx.db.query("workspaces").withIndex("by_organizationId", q => q.eq("organizationId", organizationId)).unique())!._id;
    });
    await expect(as("maker").mutation(api.authors.profiles.create, {workspaceId: plain, name: "Elsewhere"})).rejects.toThrow(/doesn't include author profiles/);
    // Its maker who leaves the lab no longer owns it.
    await t.run(async ctx => {
      for (const row of await ctx.db.query("organizationMemberships").collect()) if (row.clerkUserId === "maker") await ctx.db.patch("organizationMemberships", row._id, {state: "revoked"});
    });
    expect(await role("maker")).toBeNull();
    // Invited back, they edit it as anyone invited does.
    const invitationId = await as("admin").mutation(internal.authors.invitations.prepare, {profileId, email: "maker@example.org"});
    await as("maker").mutation(internal.authors.invitations.respondVerified, {invitationId, emails: ["maker@example.org"], accept: true});
    expect(await role("maker")).toBe("editor");
  });

  it("sends profile invitations with the profile identity and a direct invitation link", async () => {
    vi.stubEnv("EL_SMTP_HOST", "smtp.example.org");
    vi.stubEnv("EL_SMTP_FROM", "contact@platform.example");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.org");
    try {
      const {owner, profileId} = await setup();
      await owner.action(api.authors.invitationActions.invite, {profileId, email: "editor@example.org"});
      expect(mail.sendMail.mock.lastCall?.[0]).toMatchObject({from: {name: "Caitlin Mills via OpenScholar", address: "contact@platform.example"}, replyTo: "contact@platform.example", to: "editor@example.org"});
      expect(mail.sendMail.mock.lastCall?.[0].text).toContain(`https://app.example.org/authors/${profileId}/invitation`);
      expect(mail.sendMail.mock.lastCall?.[0].html).toContain(`href="https://app.example.org/authors/${profileId}/invitation"`);
    } finally { vi.unstubAllEnvs(); }
  });
  it("expires a profile invitation when its time is up, and never one that was answered", async () => {
    const {t, owner, editor, profileId} = await setup();
    vi.useFakeTimers();
    try {
      const day = 86_400_000;
      const invite = () => owner.mutation(internal.authors.invitations.prepare, {profileId, email: "editor@example.org"});
      const listed = async () => (await editor.query(api.authors.invitations.listInvitations, {})).page.length;
      await invite();
      vi.advanceTimersByTime(3 * day);
      await invite();
      // The first send's expiry runs at day 7 and leaves the re-sent invitation pending.
      vi.advanceTimersByTime(5 * day);
      await t.finishInProgressScheduledFunctions();
      expect(await listed()).toBe(1);
      expect((await owner.query(api.authors.members.list, {profileId})).invitations).toHaveLength(1);
      vi.advanceTimersByTime(3 * day);
      await t.finishInProgressScheduledFunctions();
      expect(await listed()).toBe(0);
      expect((await owner.query(api.authors.members.list, {profileId})).invitations).toHaveLength(0);
      // An invitation cancelled before its time stays cancelled when its expiry runs.
      const cancelled = await invite();
      await owner.mutation(api.authors.invitations.cancel, {invitationId: cancelled});
      vi.advanceTimersByTime(8 * day);
      await t.finishInProgressScheduledFunctions();
      expect((await t.run(ctx => ctx.db.get("authorProfileInvitations", cancelled)))?.state).toBe("cancelled");
    } finally { vi.useRealTimers(); }
  });

  it("refuses an invitation to an address that already has a page of them waiting, and still sends one of those again", async () => {
    const {t, owner, ids, profileId} = await setup();
    const [other, third] = [await owner.mutation(api.authors.profiles.create, {name: "Another profile"}), await owner.mutation(api.authors.profiles.create, {name: "A third profile"})];
    const invite = (email: string) => owner.mutation(internal.authors.invitations.prepare, {profileId, email});
    const first = await invite("busy@example.org");
    await t.run(async ctx => {
      for (let waiting = 1; waiting < 100; waiting++) await ctx.db.insert("authorProfileInvitations", {profileId: other, email: "busy@example.org", invitedBy: ids.owner, expiresAt: Date.now() + 86_400_000, state: "pending", delivery: "sent"});
    });
    await expect(owner.mutation(internal.authors.invitations.prepare, {profileId: third, email: "busy@example.org"})).rejects.toThrow(/too many invitations waiting/);
    expect(await invite("busy@example.org")).toBe(first);
  });

  it("refuses an invitation from a profile with a page of them waiting, and an acceptance into a profile with a page of editors", async () => {
    const {t, owner, editor, ids, profileId} = await setup();
    const invitationId = await owner.mutation(internal.authors.invitations.prepare, {profileId, email: "editor@example.org"});
    await t.run(async ctx => {
      for (let waiting = 1; waiting < 100; waiting++) await ctx.db.insert("authorProfileInvitations", {profileId, email: `waiting-${waiting}@example.org`, invitedBy: ids.owner, expiresAt: Date.now() + 86_400_000, state: "pending", delivery: "sent"});
    });
    await expect(owner.mutation(internal.authors.invitations.prepare, {profileId, email: "one-more@example.org"})).rejects.toThrow(/100 invitations waiting/);
    expect((await owner.query(api.authors.members.list, {profileId})).invitations).toHaveLength(100);

    await t.run(async ctx => {
      for (let members = 0; members < 100; members++) await ctx.db.insert("authorProfileMembers", {profileId, userId: ids.owner});
    });
    await expect(editor.mutation(internal.authors.invitations.respondVerified, {invitationId, emails: ["editor@example.org"], accept: true})).rejects.toThrow(/up to 100 editors/);

    // A deleted account's place is given up, so the next person can accept.
    await t.run(async ctx => {
      const gone = await ctx.db.insert("users", {state: "deleted", createdAt: 1, updatedAt: 1, clerkId: "gone", email: "gone@example.org"});
      const place = (await ctx.db.query("authorProfileMembers").withIndex("by_profileId_and_userId", q => q.eq("profileId", profileId)).first())!;
      await ctx.db.patch(place._id, {userId: gone});
    });
    await editor.mutation(internal.authors.invitations.respondVerified, {invitationId, emails: ["editor@example.org"], accept: true});
    expect((await editor.query(api.authors.profiles.get, {profileId}))?.role).toBe("editor");
  });

  it("keeps profile ownership separate from organization roles", async () => {
    const {t, owner, editor, profileId} = await setup();
    await expect(t.mutation(api.authors.profiles.create, {name: content.name})).rejects.toThrow();
    const duplicate = await editor.mutation(api.authors.profiles.create, {name: content.name});
    await owner.action(api.authors.photos.save, {profileId, expectedRevision: 1, content});
    await editor.action(api.authors.photos.save, {profileId: duplicate, expectedRevision: 1, content});
    expect((await t.query(api.authors.profiles.get, {profileId}))?.bio).toBe(content.bio);
    expect((await editor.query(api.authors.profiles.get, {profileId}))?.role).toBeNull();
    await expect(editor.action(api.authors.photos.save, {profileId, expectedRevision: 2, content: {...content, bio: "Overwrite"}})).rejects.toThrow();
  });

  it("allows profile members without an organization, requires the invited address and revokes editing immediately", async () => {
    const {t, owner, editor, ids, profileId} = await setup();
    await t.run(async ctx => {
      for (const membership of await ctx.db.query("organizationMemberships").collect()) {
        await ctx.db.delete("organizationMemberships", membership._id);
      }
    });
    await expect(owner.mutation(api.authors.profiles.create, {name: "Another profile"})).rejects.toThrow('"code":"FORBIDDEN"');
    await expect(owner.query(api.authors.profiles.list, {search: "", paginationOpts: {numItems: 10, cursor: null}})).rejects.toThrow('"code":"FORBIDDEN"');
    await owner.action(api.authors.photos.save, {profileId, expectedRevision: 1, content});
    const invitationId = await owner.mutation(internal.authors.invitations.prepare, {profileId, email: "Editor@example.org"});
    const waiting = async (person: typeof editor) => (await person.query(api.authors.invitations.listInvitations, {profileId})).page;
    expect(await waiting(editor)).toEqual([{invitationId, profileId, name: content.name}]);
    expect(await waiting(owner)).toEqual([]);
    await expect(editor.mutation(internal.authors.invitations.respondVerified, {invitationId, emails: [], accept: true})).rejects.toThrow();
    await editor.mutation(internal.authors.invitations.respondVerified, {invitationId, emails: ["editor@example.org"], accept: true});
    expect(await waiting(editor)).toEqual([]);
    expect((await editor.query(api.authors.profiles.get, {profileId}))?.role).toBe("editor");
    await editor.action(api.authors.photos.save, {profileId, expectedRevision: 2, content: {...content, bio: "Edited by a profile collaborator"}});
    await expect(editor.mutation(internal.authors.invitations.prepare, {profileId, email: "third@example.org"})).rejects.toThrow();
    await expect(editor.mutation(api.authors.members.remove, {profileId, userId: ids.owner})).rejects.toThrow();
    await owner.mutation(api.authors.members.remove, {profileId, userId: ids.editor});
    await expect(editor.action(api.authors.photos.save, {profileId, expectedRevision: 3, content})).rejects.toThrow();
    expect((await t.query(api.authors.profiles.get, {profileId}))?.bio).toBe("Edited by a profile collaborator");
  });

  it("rejects cancelled invitations and concurrent overwrites", async () => {
    const {owner, editor, profileId} = await setup();
    const invitationId = await owner.mutation(internal.authors.invitations.prepare, {profileId, email: "editor@example.org"});
    await owner.mutation(api.authors.invitations.cancel, {invitationId});
    await expect(editor.mutation(internal.authors.invitations.respondVerified, {invitationId, emails: ["editor@example.org"], accept: true})).rejects.toThrow();
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
