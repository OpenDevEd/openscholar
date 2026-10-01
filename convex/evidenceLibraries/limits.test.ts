// The limits the team page and library list rely on are enforced where people and
// libraries are added (#357).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import { MAX_LIBRARIES_PER_ORGANIZATION, MAX_LIBRARY_MEMBERS } from "../lib/queryBounds";
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

  it("refuses another library once an organization has the most it can make", async () => {
    const fixture = await createDraftSetupFixture("library_limit");
    const template = await fixture.t.run(async (ctx) => (await ctx.db.get("evidenceLibraries", fixture.created.libraryId))!);
    const { _id, _creationTime, ...library } = template;
    await insertMany(fixture.t, "evidenceLibraries", Array.from({ length: MAX_LIBRARIES_PER_ORGANIZATION - 1 }, (_, i) => ({ ...library, name: `Library ${i}`, slug: `library-limit-${i}` })), 100);
    await expect(reserveLibraryAddressByName(fixture.admin, "One More", template.organizationId)).rejects.toThrow(/up to 200 libraries/);
  });
});
