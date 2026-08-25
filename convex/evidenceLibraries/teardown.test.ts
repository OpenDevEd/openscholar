/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

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
    await fixture.t.mutation(
      internal.evidenceLibraries.teardown.prepareDevelopmentTeardown,
      {
        libraryId: fixture.created.libraryId,
        operationId: requested.operationId,
      },
    );

    let complete = false;
    for (let batch = 0; batch < 20 && !complete; batch += 1) {
      ({ complete } = await fixture.t.mutation(
        internal.evidenceLibraries.teardown.deleteDevelopmentTeardownBatch,
        {
          libraryId: fixture.created.libraryId,
          operationId: requested.operationId,
        },
      ));
    }
    expect(complete).toBe(true);
    await expect(
      fixture.t.run((ctx) => ctx.db.get(fixture.created.libraryId)),
    ).resolves.toBeNull();
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
