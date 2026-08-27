/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import { createDeployedSetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

describe("Evidence Library move candidates", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("offers the numbered addresses and never the one in use", async () => {
    const fixture = await createDeployedSetupFixture("move-candidates");

    const plan = await fixture.t.query(
      internal.evidenceLibraries.addressRecovery.readPlatformMoveCandidates,
      { libraryId: fixture.created.libraryId },
    );

    expect(plan.currentAddress).toBe(fixture.created.publicAddress);
    expect(
      plan.candidates.map((candidate) => candidate.publicAddress),
    ).not.toContain(fixture.created.publicAddress);
    expect(plan.candidates[0]).toEqual({
      publicAddress: "https://climate-evidence-2-lib.libraries.example.test",
      slug: "climate-evidence-2",
    });
  });

  it("skips an address another library already holds", async () => {
    const fixture = await createDeployedSetupFixture("move-candidates-taken");
    await fixture.t.run(async (ctx) => {
      const other = await ctx.db.insert("evidenceLibraries", {
        organizationId: fixture.organizationId,
        name: "Other library",
        slug: "other-library",
        state: "active",
        createdByClerkUserId: fixture.clerkUserId,
        updatedByClerkUserId: fixture.clerkUserId,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("evidenceLibraryRuntimeBindings", {
        libraryId: other,
        targetBaseUrl: "https://climate-evidence-2-lib.libraries.example.test",
        state: "pending",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const plan = await fixture.t.query(
      internal.evidenceLibraries.addressRecovery.readPlatformMoveCandidates,
      { libraryId: fixture.created.libraryId },
    );

    expect(plan.candidates[0]).toEqual({
      publicAddress: "https://climate-evidence-3-lib.libraries.example.test",
      slug: "climate-evidence-3",
    });
  });

  it("refuses to read candidates for a library the owner cannot manage", async () => {
    const fixture = await createDeployedSetupFixture("move-candidates-access");
    const stranger = fixture.t.withIdentity({ subject: "user_stranger" });

    await expect(
      stranger.query(
        internal.evidenceLibraries.addressRecovery.readOwnerMoveCandidates,
        { libraryId: fixture.created.libraryId },
      ),
    ).rejects.toThrow(/access denied/i);
  });
});
