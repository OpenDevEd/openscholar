/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import { decrypt } from "../lib/crypto";
import { createActivatedSetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

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
      "EVIDENCE_LIBRARY_DATABASE_PROVISIONER_URL",
      "https://database-provisioner.example.test",
    );
    vi.stubEnv("EVIDENCE_LIBRARY_DATABASE_PROVISIONER_TOKEN", "service-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("keeps one encrypted password across database and later-step retries", async () => {
    const fixture = await createActivatedSetupFixture("database-secret");
    await claim(fixture, "attempt-1");

    const first = await fixture.t.mutation(
      internal.evidenceLibraries.databaseSetup.prepareDatabaseSetup,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: "attempt-1",
        attemptCount: 1,
        candidateEncryptedPassword: "encrypted-password-1",
      },
    );
    const repeated = await fixture.t.mutation(
      internal.evidenceLibraries.databaseSetup.prepareDatabaseSetup,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: "attempt-1",
        attemptCount: 1,
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
        attemptToken: "attempt-1",
        attemptCount: 1,
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

    await expect(
      fixture.t.mutation(
        internal.evidenceLibraries.databaseSetup.completeDatabaseSetup,
        {
          libraryId: fixture.created.libraryId,
          operationId: fixture.created.setupOperationId,
          attemptToken: "attempt-1",
          attemptCount: 1,
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
  });

  it("sends a bounded request and records a safe failure before retrying", async () => {
    const fixture = await createActivatedSetupFixture("database-action");
    await claim(fixture, "attempt-1");
    const passwords: string[] = [];
    let shouldFail = true;
    vi.stubGlobal("fetch", async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        libraryId: string;
        password: string;
      };
      passwords.push(body.password);
      expect(body.libraryId).toBe(fixture.created.libraryId);
      expect(Object.keys(body).sort()).toEqual(["libraryId", "password"]);
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer service-token",
      );
      if (shouldFail) {
        return new Response(
          JSON.stringify({
            error: { code: "DATABASE_BUSY", message: "PostgreSQL is busy" },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          outcome: "updated",
          databaseName: "el_456",
          loginName: "el_456_user",
          databaseUrl: "postgresql://el_456_user:secret@postgres:5432/el_456",
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
          attemptToken: "attempt-1",
          attemptCount: 1,
        },
      ),
    ).toEqual({ status: "failed" });
    const failed = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.created.setupOperationId),
    );
    expect(failed).toMatchObject({
      error: {
        code: "DATABASE_BUSY",
        message: "PostgreSQL is busy",
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
    expect(
      decrypt(saved.credential!.encryptedValue, ENCRYPTION_KEY),
    ).toBe("postgresql://el_456_user:secret@postgres:5432/el_456");
    expect(saved.operation).toMatchObject({ stage: "storage" });
    expect(saved.operation).toHaveProperty(
      "setupEncryptedDatabasePassword",
      expect.any(String),
    );
  });
});
