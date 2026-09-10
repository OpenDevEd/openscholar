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
  it("sends profile invitations from the profile identity and platform contact address", async () => {
    vi.stubEnv("EL_SMTP_HOST", "smtp.example.org");
    vi.stubEnv("EL_SMTP_FROM", "contact@platform.example");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.org");
    try {
      const {owner, profileId} = await setup();
      await owner.action(api.authors.invitationActions.invite, {profileId, email: "editor@example.org"});
      expect(mail.sendMail.mock.lastCall?.[0]).toMatchObject({from: {name: "Caitlin Mills via OpenScholar", address: "contact@platform.example"}, replyTo: "contact@platform.example", to: "editor@example.org"});
    } finally { vi.unstubAllEnvs(); }
  });
  it("keeps profile ownership separate from organization roles", async () => {
    const {t, owner, editor, profileId} = await setup();
    await expect(t.mutation(api.authors.profiles.create, {name: content.name})).rejects.toThrow();
    const duplicate = await editor.mutation(api.authors.profiles.create, {name: content.name});
    await owner.mutation(api.authors.profiles.update, {profileId, expectedRevision: 1, content});
    await editor.mutation(api.authors.profiles.update, {profileId: duplicate, expectedRevision: 1, content});
    expect((await t.query(api.authors.profiles.get, {profileId}))?.bio).toBe(content.bio);
    expect((await editor.query(api.authors.profiles.get, {profileId}))?.role).toBeNull();
    await expect(editor.mutation(api.authors.profiles.update, {profileId, expectedRevision: 2, content: {...content, bio: "Overwrite"}})).rejects.toThrow();
  });

  it("requires the invited address, restricts access management to the owner and revokes editing immediately", async () => {
    const {t, owner, editor, ids, profileId} = await setup();
    const invitationId = await owner.mutation(internal.authors.invitations.prepare, {profileId, email: "Editor@example.org"});
    await expect(editor.mutation(internal.authors.invitations.respondVerified, {invitationId, emails: [], accept: true})).rejects.toThrow();
    await editor.mutation(internal.authors.invitations.respondVerified, {invitationId, emails: ["editor@example.org"], accept: true});
    expect((await editor.query(api.authors.profiles.get, {profileId}))?.role).toBe("editor");
    await editor.mutation(api.authors.profiles.update, {profileId, expectedRevision: 1, content});
    await expect(editor.mutation(internal.authors.invitations.prepare, {profileId, email: "third@example.org"})).rejects.toThrow();
    await expect(editor.mutation(api.authors.members.remove, {profileId, userId: ids.owner})).rejects.toThrow();
    await owner.mutation(api.authors.members.remove, {profileId, userId: ids.editor});
    await expect(editor.mutation(api.authors.profiles.update, {profileId, expectedRevision: 2, content})).rejects.toThrow();
    expect((await t.query(api.authors.profiles.get, {profileId}))?.bio).toBe(content.bio);
  });

  it("rejects cancelled invitations and concurrent overwrites", async () => {
    const {owner, editor, profileId} = await setup();
    const invitationId = await owner.mutation(internal.authors.invitations.prepare, {profileId, email: "editor@example.org"});
    await owner.mutation(api.authors.invitations.cancel, {invitationId});
    await expect(editor.mutation(internal.authors.invitations.respondVerified, {invitationId, emails: ["editor@example.org"], accept: true})).rejects.toThrow();
    await owner.mutation(api.authors.profiles.update, {profileId, expectedRevision: 1, content});
    await expect(owner.mutation(api.authors.profiles.update, {profileId, expectedRevision: 1, content: {...content, bio: "Stale edit"}})).rejects.toThrow();
    expect((await owner.query(api.authors.profiles.get, {profileId}))?.bio).toBe(content.bio);
  });
  it("stores a photo without allowing stale saves to delete the current file", async () => {
    const {t, owner, editor, profileId} = await setup();
    const photo = "data:image/png;base64,iVBORw0KGgo=";
    await owner.action(api.authors.photos.save, {profileId, expectedRevision: 1, content, photo});
    const saved = await t.query(api.authors.profiles.get, {profileId});
    expect(saved?.photo).toMatch(/^https?:/);
    const stored = await t.run(ctx => ctx.db.get("authorProfiles", profileId));
    expect(stored?.photoId).toBeDefined();
    await expect(owner.action(api.authors.photos.save, {profileId, expectedRevision: 1, content, photo})).rejects.toThrow();
    await expect(editor.action(api.authors.photos.save, {profileId, expectedRevision: 2, content, photo: ""})).rejects.toThrow();
    expect(await t.run(async ctx => Boolean(await ctx.storage.get(stored!.photoId!)))).toBe(true);
    await owner.action(api.authors.photos.save, {profileId, expectedRevision: 2, content, photo: ""});
    expect((await t.query(api.authors.profiles.get, {profileId}))?.photo).toBeNull();
    expect(await t.run(async ctx => Boolean(await ctx.storage.get(stored!.photoId!)))).toBe(false);
  });

});
