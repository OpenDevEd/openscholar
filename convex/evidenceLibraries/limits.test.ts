// The limits the team page and library list rely on are enforced where people and
// libraries are added (#357).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { MAX_CREDENTIALS_PER_LIBRARY, MAX_FEATURE_FLAGS, MAX_LIBRARIES_PER_ORGANIZATION, MAX_LIBRARY_GRANTS_PER_PERSON, MAX_LIBRARY_MEMBERS, MAX_PENDING_INVITATIONS_PER_EMAIL, MAX_PENDING_INVITATIONS_PER_LIBRARY, SETUP_CREDENTIALS_RESERVED } from "../lib/queryBounds";
import { assertCredentialRoom, writeEvidenceLibraryCredentialRecord } from "./credentials";
import { insertMany } from "../lib/maxSize.test-support";
import { createDraftSetupFixture, createReadySetupFixture, reserveLibraryAddressByName } from "../../tests/helpers/evidence-library-setup-fixture";

describe("Evidence Library limits", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("EL_COOLIFY_ENVIRONMENT", "development");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuses another person once a library has the most it can grant", async () => {
    const fixture = await createReadySetupFixture("member_limit");
    const libraryId = fixture.created.libraryId;
    const organizationId = await fixture.t.run(async (ctx) => (await ctx.db.get("evidenceLibraries", libraryId))!.organizationId);
    await insertMany(fixture.t, "evidenceLibraryMembers", Array.from({ length: MAX_LIBRARY_MEMBERS }, (_, i) => ({ libraryId, clerkUserId: `user_full_${i}`, role: "editor", grantedBy: "owner", grantedAt: 1 })));
    await fixture.t.run((ctx) => ctx.db.insert("organizationMemberships", { organizationId, clerkMembershipId: "orgmem_next", clerkUserId: "user_next", role: "org:member", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 }));
    await expect(fixture.admin.mutation(api.evidenceLibraries.team.addOrganizationMember, { libraryId, clerkUserId: "user_next", role: "editor" })).rejects.toThrow(/up to 1,000 people/);
  });

  it("refuses a grant to someone who already has the most libraries one person can be granted (#427)", async () => {
    const fixture = await createReadySetupFixture("grant_limit");
    const libraryId = fixture.created.libraryId;
    const template = await fixture.t.run(async (ctx) => (await ctx.db.get("evidenceLibraries", libraryId))!);
    const { _id, _creationTime, ...library } = template;
    // Their grants are to other libraries; this one has plenty of room.
    const others = await fixture.t.run(async (ctx) => {
      const ids = [];
      for (let i = 0; i < 5; i++) ids.push(await ctx.db.insert("evidenceLibraries", { ...library, name: `Other ${i}`, slug: `grant-limit-${i}` }));
      return ids;
    });
    await insertMany(fixture.t, "evidenceLibraryMembers", Array.from({ length: MAX_LIBRARY_GRANTS_PER_PERSON }, (_, i) => ({ libraryId: others[i % others.length], clerkUserId: "user_everywhere", role: "editor", grantedBy: "owner", grantedAt: 1 })));
    await fixture.t.run((ctx) => ctx.db.insert("organizationMemberships", { organizationId: template.organizationId, clerkMembershipId: "orgmem_everywhere", clerkUserId: "user_everywhere", role: "org:member", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 }));
    await expect(fixture.admin.mutation(api.evidenceLibraries.team.addOrganizationMember, { libraryId, clerkUserId: "user_everywhere", role: "editor" })).rejects.toThrow(/already has access to 200 libraries/);
  });

  it("takes away every grant in an organization someone leaves, however many grants they hold (#427)", async () => {
    const fixture = await createReadySetupFixture("revoke_all");
    const libraryId = fixture.created.libraryId;
    const { organization, elsewhere } = await fixture.t.run(async (ctx) => {
      const { _id, _creationTime, ...library } = (await ctx.db.get("evidenceLibraries", libraryId))!;
      const organization = (await ctx.db.get("organizations", library.organizationId))!;
      const { _id: _organizationId, _creationTime: _made, ...other } = organization;
      const otherOrganization = await ctx.db.insert("organizations", { ...other, clerkOrganizationId: "org_elsewhere", slug: "elsewhere" });
      return { organization, elsewhere: await ctx.db.insert("evidenceLibraries", { ...library, organizationId: otherOrganization, name: "Elsewhere", slug: "revoke-all-elsewhere" }) };
    });
    // From before grants were capped: more than one read holds, with this organization's grant last.
    await insertMany(fixture.t, "evidenceLibraryMembers", [
      ...Array.from({ length: MAX_LIBRARY_GRANTS_PER_PERSON + 20 }, () => ({ libraryId: elsewhere, clerkUserId: "user_leaving", role: "editor", grantedBy: "owner", grantedAt: 1 })),
      { libraryId, clerkUserId: "user_leaving", role: "editor", grantedBy: "owner", grantedAt: 1 },
    ]);
    const grantsHere = () => fixture.t.run(async (ctx) => (await ctx.db.query("evidenceLibraryMembers").withIndex("by_libraryId_and_clerkUserId", (q) => q.eq("libraryId", libraryId).eq("clerkUserId", "user_leaving")).take(2)).length);
    expect(await grantsHere()).toBe(1);

    vi.useFakeTimers();
    await fixture.t.mutation(internal.webhooks.projections.applyOrganizationMembershipEvent, {
      eventId: "msg_leaving", eventType: "organizationMembership.deleted", instanceId: "ins_test", occurredAt: Date.now(), payloadSha256: "a".repeat(64),
      action: "delete",
      membership: {
        clerkMembershipId: "orgmem_leaving", clerkUserId: "user_leaving", role: "org:member", state: "revoked", clerkCreatedAt: 1, clerkUpdatedAt: 2,
        organization: { clerkOrganizationId: organization.clerkOrganizationId, name: organization.name, slug: organization.slug, evidenceLibrariesEnabled: organization.evidenceLibrariesEnabled, authorsEnabled: organization.authorsEnabled ?? false, extractionEnabled: organization.extractionEnabled ?? false, clerkCreatedAt: organization.clerkCreatedAt, clerkUpdatedAt: organization.clerkUpdatedAt },
      },
    });
    // A grant made after they left, by a later invitation, isn't the sweep's to take.
    vi.setSystemTime(Date.now() + 1_000);
    await fixture.t.run((ctx) => ctx.db.insert("evidenceLibraryMembers", { libraryId, clerkUserId: "user_leaving", role: "creator", grantedBy: "owner", grantedAt: Date.now() }));
    await fixture.t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
    expect(await fixture.t.run(async (ctx) => (await ctx.db.query("evidenceLibraryMembers").withIndex("by_libraryId_and_clerkUserId", (q) => q.eq("libraryId", libraryId).eq("clerkUserId", "user_leaving")).take(2)).map((grant) => grant.role))).toEqual(["creator"]);
  });

  it("refuses another invitation once a library, or an address, has the most waiting (#427)", async () => {
    const fixture = await createReadySetupFixture("invite_limit");
    const libraryId = fixture.created.libraryId;
    const elsewhere = await fixture.t.run(async (ctx) => {
      const { _id, _creationTime, ...library } = (await ctx.db.get("evidenceLibraries", libraryId))!;
      return await ctx.db.insert("evidenceLibraries", { ...library, name: "Elsewhere", slug: "invite-limit-elsewhere" });
    });
    const waiting = (to: typeof libraryId, email: (i: number) => string, count: number) => insertMany(fixture.t, "evidenceLibraryInvitations", Array.from({ length: count }, (_, i) => ({ libraryId: to, email: email(i), role: "editor", invitedBy: "owner", expiresAt: Date.now() + 86_400_000, state: "pending", delivery: "sent" })));
    const invite = (email: string) => fixture.admin.mutation(internal.evidenceLibraries.invitations.prepare, { libraryId, email, role: "editor" });

    await waiting(elsewhere, () => "popular@example.org", MAX_PENDING_INVITATIONS_PER_EMAIL);
    await expect(invite("popular@example.org")).rejects.toThrow(/too many invitations waiting/);

    await waiting(libraryId, (i) => `person${i}@example.org`, MAX_PENDING_INVITATIONS_PER_LIBRARY);
    await expect(invite("one-more@example.org")).rejects.toThrow(/500 invitations waiting/);
    // An invitation already waiting here is renewed, not counted again.
    await expect(invite("person0@example.org")).resolves.toBeDefined();
  });

  it("refuses another stored credential, and another feature flag, past their limits (#427)", async () => {
    const fixture = await createReadySetupFixture("credential_limit");
    const libraryId = fixture.created.libraryId;
    const stored = await fixture.t.run(async (ctx) => (await ctx.db.query("evidenceLibraryCredentials").withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId)).take(MAX_CREDENTIALS_PER_LIBRARY)).length);
    const room = MAX_CREDENTIALS_PER_LIBRARY - SETUP_CREDENTIALS_RESERVED;
    await insertMany(fixture.t, "evidenceLibraryCredentials", Array.from({ length: room - stored }, (_, i) => ({ libraryId, credentialKey: `sources.filler.${i}`, encryptedValue: "x", validationState: "untested", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 })));
    await expect(fixture.t.run((ctx) => assertCredentialRoom(ctx, libraryId))).rejects.toThrow(/up to 480 credentials/);
    // The library's own setup still stores what it needs.
    await expect(fixture.t.run((ctx) => writeEvidenceLibraryCredentialRecord(ctx as never, { libraryId, concretePath: "/services/storage/serviceRoleKey", encryptedValue: "x", clerkUserId: "owner", validationState: "valid" }))).resolves.toBeDefined();

    await insertMany(fixture.t, "featureFlags", Array.from({ length: MAX_FEATURE_FLAGS }, (_, i) => ({ key: `filler.${i}`, enabled: false, updatedAt: 1 })));
    await expect(fixture.t.mutation(internal.featureFlags.internal.upsert, { key: "one.more", enabled: true })).rejects.toThrow(/already 200 feature flags/);
    // A flag that exists can still be changed.
    await expect(fixture.t.mutation(internal.featureFlags.internal.upsert, { key: "filler.0", enabled: true })).resolves.toBeNull();
  });

  it("refuses another library once an organization has the most it can make", async () => {
    const fixture = await createDraftSetupFixture("library_limit");
    const template = await fixture.t.run(async (ctx) => (await ctx.db.get("evidenceLibraries", fixture.created.libraryId))!);
    const { _id, _creationTime, ...library } = template;
    await insertMany(fixture.t, "evidenceLibraries", Array.from({ length: MAX_LIBRARIES_PER_ORGANIZATION - 1 }, (_, i) => ({ ...library, name: `Library ${i}`, slug: `library-limit-${i}` })), 100);
    await expect(reserveLibraryAddressByName(fixture.admin, "One More", template.organizationId)).rejects.toThrow(/up to 200 libraries/);
  });
});
