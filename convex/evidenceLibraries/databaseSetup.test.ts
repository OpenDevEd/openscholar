/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { decrypt } from "../lib/crypto";
import { createActivatedSetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";
import {
  AI_MODELS,
  AI_PROVIDER,
  PLATFORM_EMBEDDING_KEY_MISSING_MESSAGE,
} from "../../lib/evidence-libraries/configuration/ai";

const ENCRYPTION_KEY = "11".repeat(32);

async function claim(
  fixture: Awaited<ReturnType<typeof createActivatedSetupFixture>>,
  attemptToken: string,
) {
  return await fixture.t.mutation(
    internal.evidenceLibraries.setupOperation.claimSetupOperation,
    {
      libraryId: fixture.created.libraryId,
      operationId: fixture.created.setupOperationId,
      attemptToken,
    },
  );
}

describe("Evidence Library database setup", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY);
    vi.stubEnv(
      "EL_DATABASE_PROVISIONER_URL",
      "https://database-provisioner.example.test",
    );
    vi.stubEnv("EL_DATABASE_PROVISIONER_TOKEN", "service-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("keeps one encrypted password across database and later-step retries", async () => {
    const fixture = await createActivatedSetupFixture("database-secret");

    const first = await fixture.t.mutation(
      internal.evidenceLibraries.databaseSetup.prepareDatabaseSetup,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: fixture.attemptToken,
        attemptCount: fixture.attemptCount,
        candidateEncryptedPassword: "encrypted-password-1",
      },
    );
    const repeated = await fixture.t.mutation(
      internal.evidenceLibraries.databaseSetup.prepareDatabaseSetup,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: fixture.attemptToken,
        attemptCount: fixture.attemptCount,
        candidateEncryptedPassword: "encrypted-password-2",
      },
    );
    expect(first.encryptedPassword).toBe("encrypted-password-1");
    expect(repeated.encryptedPassword).toBe("encrypted-password-1");

    await fixture.t.mutation(
      internal.evidenceLibraries.setupOperation.failSetupOperation,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: fixture.attemptToken,
        attemptCount: fixture.attemptCount,
        expectedStage: "database",
        error: { code: "DATABASE_UNAVAILABLE", message: "Try again" },
      },
    );
    await claim(fixture, "attempt-2");
    const retried = await fixture.t.mutation(
      internal.evidenceLibraries.databaseSetup.prepareDatabaseSetup,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: "attempt-2",
        attemptCount: 2,
        candidateEncryptedPassword: "encrypted-password-3",
      },
    );
    expect(retried.encryptedPassword).toBe("encrypted-password-1");

    const completed = await fixture.t.mutation(
      internal.evidenceLibraries.databaseSetup.completeDatabaseSetup,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: "attempt-2",
        attemptCount: 2,
        encryptedDatabaseUrl: "encrypted-database-url",
        outcome: "updated",
        databaseName: "el_123",
        loginName: "el_123_user",
      },
    );
    expect(completed).toMatchObject({ nextStep: "storage", status: "running" });

    const saved = await fixture.t.run(async (ctx) => ({
      credential: await ctx.db
        .query("evidenceLibraryCredentials")
        .withIndex("by_libraryId_and_credentialKey", (query) =>
          query
            .eq("libraryId", fixture.created.libraryId)
            .eq("credentialKey", "/services/database/url"),
        )
        .unique(),
      operation: await ctx.db.get(fixture.created.setupOperationId),
      scheduledFunctions: await ctx.db.system
        .query("_scheduled_functions")
        .collect(),
    }));
    expect(saved.credential).toMatchObject({
      encryptedValue: "encrypted-database-url",
      validationState: "valid",
    });
    expect(saved.operation).toMatchObject({
      setupEncryptedDatabasePassword: "encrypted-password-1",
      setupReceipts: {
        database: {
          databaseName: "el_123",
          loginName: "el_123_user",
          outcome: "updated",
        },
      },
      stage: "storage",
    });
    expect(
      saved.scheduledFunctions.filter((scheduled) =>
        scheduled.name.includes("runStorageSetup"),
      ),
    ).toHaveLength(1);
    expect(
      await fixture.admin.query(api.evidenceLibraries.queries.getSetupDraft, {
        libraryId: fixture.created.libraryId,
      }),
    ).not.toHaveProperty("setupOperation.setupEncryptedDatabasePassword");

    await expect(
      fixture.t.mutation(
        internal.evidenceLibraries.databaseSetup.completeDatabaseSetup,
        {
          libraryId: fixture.created.libraryId,
          operationId: fixture.created.setupOperationId,
          attemptToken: fixture.attemptToken,
          attemptCount: fixture.attemptCount,
          encryptedDatabaseUrl: "stale-url",
          outcome: "updated",
          databaseName: "el_123",
          loginName: "el_123_user",
        },
      ),
    ).rejects.toThrow(/no longer active|running storage/);
    expect(
      await fixture.t.run((ctx) =>
        ctx.db.get("evidenceLibraryCredentials", saved.credential!._id),
      ),
    ).toMatchObject({ encryptedValue: "encrypted-database-url" });

    await fixture.t.mutation(
      internal.evidenceLibraries.setupOperation.failSetupOperation,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: "attempt-2",
        attemptCount: 2,
        expectedStage: "storage",
        error: { code: "STORAGE_FAILED", message: "Try storage again" },
      },
    );
    await claim(fixture, "attempt-3");
    const laterStepRetry = await fixture.t.mutation(
      internal.evidenceLibraries.databaseSetup.prepareDatabaseSetup,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: "attempt-3",
        attemptCount: 3,
        candidateEncryptedPassword: "encrypted-password-4",
      },
    );
    expect(laterStepRetry.encryptedPassword).toBe("encrypted-password-1");
  });

  it("creates nothing when AI answers are on and the platform has no embedding key", async () => {
    vi.stubEnv("EL_EMBEDDING_OPENROUTER_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fixture = await createActivatedSetupFixture("database-embedder", {
      features: { ai: true },
      ai: {
        providers: [
          { provider: AI_PROVIDER, enabled: true,
            models: [AI_MODELS[0]], defaultModel: AI_MODELS[0], },
        ],
      },
    });
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      throw new Error("The provisioner must not be called");
    });

    expect(
      await fixture.t.action(
        internal.evidenceLibraries.databaseSetupActions.runDatabaseSetup,
        {
          libraryId: fixture.created.libraryId,
          operationId: fixture.created.setupOperationId,
          attemptToken: fixture.attemptToken,
          attemptCount: fixture.attemptCount,
        },
      ),
    ).toEqual({ status: "failed" });
    expect(calls).toBe(0);
    const failed = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.created.setupOperationId),
    );
    expect(failed).toMatchObject({
      error: {
        code: "PLATFORM_EMBEDDING_KEY_MISSING",
        message: PLATFORM_EMBEDDING_KEY_MISSING_MESSAGE,
        stage: "database",
      },
      status: "failed",
    });
    // Nothing was created: no database credential, no receipt.
    const credentials = await fixture.t.run((ctx) =>
      ctx.db
        .query("evidenceLibraryCredentials")
        .withIndex("by_libraryId", (query) =>
          query.eq("libraryId", fixture.created.libraryId),
        )
        .collect(),
    );
    expect(
      credentials.map((row) => row.credentialKey),
    ).not.toContain("/services/database/url");
    expect(failed?.setupReceipts?.database).toBeUndefined();
    expect(failed?.setupReceipts?.storage).toBeUndefined();
  });

  it("still creates the database when AI answers are off", async () => {
    vi.stubEnv("EL_EMBEDDING_OPENROUTER_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fixture = await createActivatedSetupFixture("database-no-ai");
    vi.stubGlobal("fetch", async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { password: string };
      return new Response(
        JSON.stringify({
          libraryId: fixture.created.libraryId,
          outcome: "created",
          databaseName: "el_789",
          loginName: "el_789_user",
          databaseUrl: `postgresql://el_789_user:${encodeURIComponent(body.password)}@postgres:5432/el_789`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    expect(
      await fixture.t.action(
        internal.evidenceLibraries.databaseSetupActions.runDatabaseSetup,
        {
          libraryId: fixture.created.libraryId,
          operationId: fixture.created.setupOperationId,
          attemptToken: fixture.attemptToken,
          attemptCount: fixture.attemptCount,
        },
      ),
    ).toMatchObject({ nextStep: "storage", status: "running" });
  });

  it("sends a bounded request and records a safe failure before retrying", async () => {
    const fixture = await createActivatedSetupFixture("database-action");
    const passwords: string[] = [];
    let shouldFail = true;
    vi.stubGlobal(
      "fetch",
      async (input: URL | RequestInfo, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          libraryId: string;
          password: string;
        };
        passwords.push(body.password);
        expect(String(input)).toBe(
          "https://database-provisioner.example.test/v1/library-databases/reconcile",
        );
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("content-type")).toBe(
          "application/json",
        );
        expect(body.libraryId).toBe(fixture.created.libraryId);
        expect(Object.keys(body).sort()).toEqual(["libraryId", "password"]);
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer service-token",
        );
        if (shouldFail) {
          return new Response(
            JSON.stringify({
              error: {
                code: "database_owner_conflict",
                message: `leaked password: ${body.password}`,
              },
            }),
            { status: 503, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            libraryId: body.libraryId,
            outcome: "updated",
            databaseName: "el_456",
            loginName: "el_456_user",
            databaseUrl: `postgresql://el_456_user:${encodeURIComponent(body.password)}@postgres:5432/el_456`,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );

    expect(
      await fixture.t.action(
        internal.evidenceLibraries.databaseSetupActions.runDatabaseSetup,
        {
          libraryId: fixture.created.libraryId,
          operationId: fixture.created.setupOperationId,
          attemptToken: fixture.attemptToken,
          attemptCount: fixture.attemptCount,
        },
      ),
    ).toEqual({ status: "failed" });
    const failed = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.created.setupOperationId),
    );
    expect(failed).toMatchObject({
      error: {
        code: "database_owner_conflict",
        message: "The library database is owned by another login.",
        stage: "database",
      },
      status: "failed",
    });
    expect(JSON.stringify(failed)).not.toContain("service-token");
    expect(JSON.stringify(failed)).not.toContain(passwords[0]);

    await claim(fixture, "attempt-2");
    shouldFail = false;
    expect(
      await fixture.t.action(
        internal.evidenceLibraries.databaseSetupActions.runDatabaseSetup,
        {
          libraryId: fixture.created.libraryId,
          operationId: fixture.created.setupOperationId,
          attemptToken: "attempt-2",
          attemptCount: 2,
        },
      ),
    ).toMatchObject({ nextStep: "storage", status: "running" });
    expect(passwords[1]).toBe(passwords[0]);

    const saved = await fixture.t.run(async (ctx) => ({
      credential: await ctx.db
        .query("evidenceLibraryCredentials")
        .withIndex("by_libraryId_and_credentialKey", (query) =>
          query
            .eq("libraryId", fixture.created.libraryId)
            .eq("credentialKey", "/services/database/url"),
        )
        .unique(),
      operation: await ctx.db.get(fixture.created.setupOperationId),
    }));
    expect(saved.credential).not.toBeNull();
    expect(decrypt(saved.credential!.encryptedValue, ENCRYPTION_KEY)).toContain(
      "postgresql://el_456_user:",
    );
    expect(
      decodeURIComponent(
        new URL(decrypt(saved.credential!.encryptedValue, ENCRYPTION_KEY))
          .password,
      ),
    ).toBe(passwords[0]);
    expect(saved.operation).toMatchObject({ stage: "storage" });
    expect(saved.operation).toHaveProperty(
      "setupEncryptedDatabasePassword",
      expect.any(String),
    );
  });
});
