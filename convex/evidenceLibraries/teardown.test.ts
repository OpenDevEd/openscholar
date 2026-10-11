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

  it("keeps an organization on its plan while it has a library, and lets an Owner delete one the plan no longer covers", async () => {
    const fixture = await createReadySetupFixture("teardown_no_plan");
    const { libraryId } = fixture.created;
    const workspaceId = await fixture.t.run(async (ctx) => (await ctx.db.get("evidenceLibraries", libraryId))!.workspaceId);
    const summary = () => fixture.admin.query(api.organizations.queries.summary, { workspaceId });

    // Free has no Evidence Libraries, so the organization isn't moved there with one: it couldn't be opened to delete afterwards.
    await expect(fixture.admin.action(api.billing.actions.moveToFree, { workspaceId })).rejects.toThrow(/Move or delete its Evidence Libraries first/);
    // While the plan covers it, it's deleted from its own page: the organization's settings offer nothing.
    expect(await summary()).not.toHaveProperty("removable");

    // The plan stops covering it without the organization asking, as when its payment lapses.
    await fixture.t.run(async (ctx) => {
      const account = (await ctx.db.query("billingAccounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique())!;
      await ctx.db.patch("billingAccounts", account._id, { features: [] });
    });
    // Managing it is shut: its Owner reads its settings, and the organization's settings offer the one thing left, deleting it.
    expect(await fixture.admin.query(api.evidenceLibraries.queries.getDraft, { libraryId })).toMatchObject({ role: "owner", editable: false });
    expect(await summary()).toMatchObject({ library: "Climate Evidence", removable: { _id: libraryId, name: "Climate Evidence", state: "held" } });
    const requested = await fixture.admin.mutation(api.evidenceLibraries.teardown.requestDevelopmentTeardown, { libraryId, confirmationName: "Climate Evidence" });
    expect(requested.status).toBe("queued");
    await expect(fixture.admin.query(api.evidenceLibraries.teardown.getDevelopmentTeardownStatus, { operationId: requested.operationId })).resolves.toMatchObject({ libraryId, status: "queued" });
    expect(await summary()).toMatchObject({ removable: { state: "deleting" } });

    // A deletion that stops part-way is tried again from the same row: the libraries' list, where it is otherwise, is shut with the plan.
    await fixture.t.run((ctx) => ctx.db.patch("evidenceLibraryConfigOperations", requested.operationId, { status: "failed" }));
    expect(await summary()).toMatchObject({ removable: { state: "failed" } });
    await expect(fixture.admin.mutation(api.evidenceLibraries.teardown.restartDevelopmentTeardown, { libraryId })).resolves.toEqual({ status: "queued" });
    expect(await summary()).toMatchObject({ removable: { state: "deleting" } });
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
      await ctx.db.insert("evidenceLibraryApprovedQueries", {
        libraryId: fixture.created.libraryId,
        version: "v1",
        fingerprint: "{}",
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
        approvedQueries: await ctx.db.query("evidenceLibraryApprovedQueries").collect(),
      })),
    ).resolves.toEqual({ jobs: [], files: [], sourceStatus: [], approvedQueries: [] });
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

  it("still refuses a retry waiting behind many queued operations that never started", async () => {
    const fixture = await createActivatedSetupFixture("teardown_retry_crowd");
    await fixture.t.run(async (ctx) => {
      const { _id, _creationTime, ...setup } = (await ctx.db.get(fixture.created.setupOperationId))!;
      await ctx.db.patch(fixture.created.setupOperationId, { status: "queued", updatedAt: 10_000 });
      for (let i = 0; i < 150; i++) {
        await ctx.db.insert("evidenceLibraryConfigOperations", { ...setup, status: "queued", attemptCount: 0, startedAt: undefined, idempotencyKey: `untouched-${i}`, updatedAt: i });
      }
    });

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
