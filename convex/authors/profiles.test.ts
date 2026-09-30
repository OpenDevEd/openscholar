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
      const listed = async () => (await editor.query(api.authors.invitations.listMine, {})).length;
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
    expect(await editor.query(api.authors.invitations.listMine, {profileId})).toEqual([{invitationId, profileId, name: content.name}]);
    expect(await owner.query(api.authors.invitations.listMine, {profileId})).toEqual([]);
    await expect(editor.mutation(internal.authors.invitations.respondVerified, {invitationId, emails: [], accept: true})).rejects.toThrow();
    await editor.mutation(internal.authors.invitations.respondVerified, {invitationId, emails: ["editor@example.org"], accept: true});
    expect(await editor.query(api.authors.invitations.listMine, {profileId})).toEqual([]);
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
