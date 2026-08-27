/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import { createActivatedSetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

describe("listTeam", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("EL_COOLIFY_ENVIRONMENT", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists organisation admins as owners and members as editors with name and email", async () => {
    const fixture = await createActivatedSetupFixture("team");
    const libraryId = fixture.created.libraryId;
    await fixture.t.run(async (ctx) => {
      const organizationId = (await ctx.db.get("evidenceLibraries", libraryId))!.organizationId;
      const stamp = { clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 };
      await ctx.db.insert("users", {
        clerkId: "user_team",
        email: "ada@example.org",
        firstName: "Ada",
        lastName: "Lovelace",
        state: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("users", {
        clerkId: "user_editor",
        email: "grace@example.org",
        firstName: "Grace",
        state: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("organizationMemberships", {
        organizationId,
        clerkMembershipId: "orgmem_editor",
        clerkUserId: "user_editor",
        role: "org:member",
        state: "active",
        ...stamp,
      });
      await ctx.db.insert("organizationMemberships", {
        organizationId,
        clerkMembershipId: "orgmem_gone",
        clerkUserId: "user_gone",
        role: "org:member",
        state: "revoked",
        ...stamp,
      });
      await ctx.db.insert("organizationMemberships", {
        organizationId,
        clerkMembershipId: "orgmem_new",
        clerkUserId: "user_new",
        role: "org:member",
        state: "active",
        ...stamp,
      });
    });

    await expect(
      fixture.admin.query(api.evidenceLibraries.queries.listTeam, { libraryId }),
    ).resolves.toEqual({
      organizationName: "Team team",
      owners: [{ clerkUserId: "user_team", name: "Ada Lovelace", email: "ada@example.org" }],
      editors: [
        { clerkUserId: "user_new", name: "", email: "" },
        { clerkUserId: "user_editor", name: "Grace", email: "grace@example.org" },
      ],
    });
  });

  it("refuses a library from another organisation", async () => {
    const fixture = await createActivatedSetupFixture("team_other");
    const stranger = fixture.t.withIdentity({
      subject: "user_stranger",
      o: { id: "org_elsewhere", rol: "org:admin" },
    });
    await expect(
      stranger.query(api.evidenceLibraries.queries.listTeam, {
        libraryId: fixture.created.libraryId,
      }),
    ).rejects.toThrow();
  });
});
