/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import {
  createActivatedSetupFixture,
  createDraftSetupFixture,
  createReadySetupFixture,
} from "../../tests/helpers/evidence-library-setup-fixture";

describe("development Evidence Library teardown", () => {
  beforeEach(() => {
    vi.stubEnv("EL_ALLOW_DEVELOPMENT_TEARDOWN", "true");
    vi.stubEnv("EL_COOLIFY_ENVIRONMENT", "development");
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("requires the Owner to enter the exact library name", async () => {
    const fixture = await createReadySetupFixture("teardown_confirmation");

    await expect(
      fixture.admin.mutation(
        api.evidenceLibraries.teardown.requestDevelopmentTeardown,
        {
          libraryId: fixture.created.libraryId,
          confirmationName: "Climate",
        },
      ),
    ).rejects.toThrow(/full library name/i);
  });

  it("queues one teardown and removes only the library records in bounded batches", async () => {
    const fixture = await createReadySetupFixture("teardown_records");
    await fixture.t.run(async (ctx) => {
      const requestId = await ctx.storage.store(new Blob(["{}"]));
      await ctx.db.insert("evidenceLibraryDigestJobs", {
        libraryId: fixture.created.libraryId,
        editionId: "5e9558ce-ed55-4dc4-a44b-d1cbd3f9af64",
        requestId,
        status: "pending",
        startedAt: 1,
      });
      await ctx.db.insert("evidenceLibrarySourceStatus", {
        libraryId: fixture.created.libraryId,
        observedAt: 1,
        sources: [],
      });
    });
    const requested = await fixture.admin.mutation(
      api.evidenceLibraries.teardown.requestDevelopmentTeardown,
      {
        libraryId: fixture.created.libraryId,
        confirmationName: "Climate Evidence",
      },
    );
    expect(requested.status).toBe("queued");
    await expect(
      fixture.admin.query(
        api.evidenceLibraries.teardown.getDevelopmentTeardownStatus,
        { operationId: requested.operationId },
      ),
    ).resolves.toMatchObject({
      libraryId: fixture.created.libraryId,
      status: "queued",
    });
    const claim = await fixture.t.mutation(
      internal.evidenceLibraries.teardown.prepareDevelopmentTeardown,
      {
        libraryId: fixture.created.libraryId,
        operationId: requested.operationId,
      },
    );
    const attemptToken = claim.claimed ? claim.attemptToken : "";

    let complete = false;
    for (let batch = 0; batch < 20 && !complete; batch += 1) {
      ({ complete } = await fixture.t.mutation(
        internal.evidenceLibraries.teardown.deleteDevelopmentTeardownBatch,
        {
          libraryId: fixture.created.libraryId,
          operationId: requested.operationId,
          attemptToken,
        },
      ));
    }
    expect(complete).toBe(true);
    await expect(
      fixture.t.run((ctx) => ctx.db.get(fixture.created.libraryId)),
    ).resolves.toBeNull();
    await expect(
      fixture.t.run(async (ctx) => ({
        jobs: await ctx.db.query("evidenceLibraryDigestJobs").collect(),
        files: await ctx.db.system.query("_storage").collect(),
        sourceStatus: await ctx.db.query("evidenceLibrarySourceStatus").collect(),
      })),
    ).resolves.toEqual({ jobs: [], files: [], sourceStatus: [] });
    await expect(
      fixture.t.run((ctx) => ctx.db.get(fixture.organizationId)),
    ).resolves.toMatchObject({ state: "active" });
    await expect(
      fixture.t.run((ctx) => ctx.db.get(fixture.membershipId)),
    ).resolves.toMatchObject({ state: "active" });
    await expect(
      fixture.admin.query(
        api.evidenceLibraries.teardown.getDevelopmentTeardownStatus,
        { operationId: requested.operationId },
      ),
    ).resolves.toEqual({ status: "complete" });
  });

  it("deletes a draft whose setup never started", async () => {
    const fixture = await createDraftSetupFixture("teardown_draft");
    await expect(
      fixture.t.run((ctx) => ctx.db.get(fixture.created.setupOperationId)),
    ).resolves.toMatchObject({ status: "queued", attemptCount: 0 });

    const requested = await fixture.admin.mutation(
      api.evidenceLibraries.teardown.requestDevelopmentTeardown,
      {
        libraryId: fixture.created.libraryId,
        confirmationName: "Climate Evidence",
      },
    );
    expect(requested.status).toBe("queued");
    const claim = await fixture.t.mutation(
      internal.evidenceLibraries.teardown.prepareDevelopmentTeardown,
      {
        libraryId: fixture.created.libraryId,
        operationId: requested.operationId,
      },
    );
    const attemptToken = claim.claimed ? claim.attemptToken : "";
    let complete = false;
    for (let batch = 0; batch < 20 && !complete; batch += 1) {
      ({ complete } = await fixture.t.mutation(
        internal.evidenceLibraries.teardown.deleteDevelopmentTeardownBatch,
        {
          libraryId: fixture.created.libraryId,
          operationId: requested.operationId,
          attemptToken,
        },
      ));
    }
    expect(complete).toBe(true);
    await expect(
      fixture.t.run((ctx) => ctx.db.get(fixture.created.libraryId)),
    ).resolves.toBeNull();
    await expect(
      fixture.t.run((ctx) => ctx.db.get(fixture.created.setupOperationId)),
    ).resolves.toBeNull();
  });

  it("still refuses while setup is running after activation was requested", async () => {
    const fixture = await createActivatedSetupFixture("teardown_activated");
    await expect(
      fixture.t.run((ctx) => ctx.db.get(fixture.created.setupOperationId)),
    ).resolves.toMatchObject({ status: "running" });

    await expect(
      fixture.admin.mutation(
        api.evidenceLibraries.teardown.requestDevelopmentTeardown,
        {
          libraryId: fixture.created.libraryId,
          confirmationName: "Climate Evidence",
        },
      ),
    ).rejects.toThrow(/wait for the current library operation/i);
  });

  it("still refuses a queued setup that already ran and is waiting to retry", async () => {
    const fixture = await createActivatedSetupFixture("teardown_retry_wait");
    await fixture.t.run((ctx) =>
      ctx.db.patch(fixture.created.setupOperationId, { status: "queued" }),
    );

    await expect(
      fixture.admin.mutation(
        api.evidenceLibraries.teardown.requestDevelopmentTeardown,
        {
          libraryId: fixture.created.libraryId,
          confirmationName: "Climate Evidence",
        },
      ),
    ).rejects.toThrow(/wait for the current library operation/i);
  });

  it("rejects deletion when the development-only switch is off", async () => {
    const fixture = await createReadySetupFixture("teardown_disabled");
    vi.stubEnv("EL_ALLOW_DEVELOPMENT_TEARDOWN", "false");

    await expect(
      fixture.admin.mutation(
        api.evidenceLibraries.teardown.requestDevelopmentTeardown,
        {
          libraryId: fixture.created.libraryId,
          confirmationName: "Climate Evidence",
        },
      ),
    ).rejects.toThrow(/not enabled/i);
  });
});
