/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { createActivatedSetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

describe("library overviews", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("EL_ALLOW_DEVELOPMENT_TEARDOWN", "true");
    vi.stubEnv("EL_COOLIFY_ENVIRONMENT", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("previews the address a name would get, skipping one that is taken", async () => {
    const fixture = await createActivatedSetupFixture("overview_preview");

    await expect(
      fixture.admin.query(api.evidenceLibraries.queries.previewSetupIdentity, {
        name: "   ",
      }),
    ).resolves.toBeNull();
    await expect(
      fixture.admin.query(api.evidenceLibraries.queries.previewSetupIdentity, {
        name: "Climate Evidence",
      }),
    ).resolves.toEqual({
      name: "Climate Evidence",
      shortName: "Climate Evidence",
      slug: "climate-evidence-2",
      publicAddress: "https://climate-evidence-2-lib.libraries.example.test",
    });
  });

  it("reports each library's status, address and accent colour", async () => {
    const fixture = await createActivatedSetupFixture("overview_status");
    const libraryId = fixture.created.libraryId;

    const settingUp = await fixture.admin.query(
      api.evidenceLibraries.queries.listLibraryOverviews,
      {},
    );
    expect(settingUp).toEqual([
      {
        _id: libraryId,
        name: "Climate Evidence",
        publicAddress: "https://climate-evidence-lib.libraries.example.test",
        status: "setting_up",
        setupStage: "database",
        teardownStage: null,
        lastActivatedAt: null,
        accentColor: "#005A9C",
      },
    ]);

    await fixture.t.mutation(
      internal.evidenceLibraries.setupOperation.failSetupOperation,
      {
        libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: fixture.attemptToken,
        attemptCount: fixture.attemptCount,
        expectedStage: "database",
        error: { code: "DATABASE_UNAVAILABLE", message: "No database." },
      },
    );
    const failed = await fixture.admin.query(
      api.evidenceLibraries.queries.listLibraryOverviews,
      {},
    );
    expect(failed[0]).toMatchObject({ status: "setup_failed", setupStage: "database" });

    await fixture.admin.mutation(
      api.evidenceLibraries.teardown.requestDevelopmentTeardown,
      { libraryId, confirmationName: "Climate Evidence" },
    );
    const deleting = await fixture.admin.query(
      api.evidenceLibraries.queries.listLibraryOverviews,
      {},
    );
    expect(deleting[0]).toMatchObject({
      status: "deleting",
      setupStage: null,
      teardownStage: "coolify",
    });
  });

  it("lists a fresh draft as a draft with no address facts beyond its own", async () => {
    const fixture = await createActivatedSetupFixture("overview_draft");
    const draft = await fixture.admin.mutation(
      api.evidenceLibraries.mutations.createSetupDraft,
      { name: "Second Library" },
    );
    const overviews = await fixture.admin.query(
      api.evidenceLibraries.queries.listLibraryOverviews,
      {},
    );
    expect(overviews.find((row) => row._id === draft.libraryId)).toEqual({
      _id: draft.libraryId,
      name: "Second Library",
      publicAddress: "https://second-library-lib.libraries.example.test",
      status: "draft",
      setupStage: null,
      teardownStage: null,
      lastActivatedAt: null,
      accentColor: null,
    });
  });
});
