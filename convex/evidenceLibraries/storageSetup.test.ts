/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { decrypt } from "../lib/crypto";
import { createActivatedSetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";
import { createLibraryStorageBucketNames } from "./storageSetupClient";

const ENCRYPTION_KEY = "22".repeat(32);
const SERVICE_ROLE_KEY = "storage-service-role-key";

describe("Evidence Library storage setup", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY);
    vi.stubEnv("EL_STORAGE_URL", "https://storage.example.test");
    vi.stubEnv("EL_STORAGE_SERVICE_KEY", SERVICE_ROLE_KEY);
    vi.stubEnv("EL_STORAGE_MAX_PDF_BYTES", "52428800");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("stores the storage credential and queues application setup atomically", async () => {
    const fixture = await createActivatedSetupFixture("storage-completion");
    await fixture.t.mutation(
      internal.evidenceLibraries.databaseSetup.completeDatabaseSetup,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: fixture.attemptToken,
        attemptCount: fixture.attemptCount,
        encryptedDatabaseUrl: "encrypted-database-url",
        outcome: "created",
        databaseName: "el_storage",
        loginName: "el_storage_user",
      },
    );

    const completed = await fixture.t.mutation(
      internal.evidenceLibraries.storageSetup.completeStorageSetup,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: fixture.attemptToken,
        attemptCount: fixture.attemptCount,
        encryptedServiceRoleKey: "encrypted-storage-key",
        outcome: "updated",
        privateBucket: "el-private-123",
        publicBucket: "el-public-123",
      },
    );
    expect(completed).toMatchObject({
      nextStep: "application",
      status: "running",
    });

    const saved = await fixture.t.run(async (ctx) => ({
      credential: await ctx.db
        .query("evidenceLibraryCredentials")
        .withIndex("by_libraryId_and_credentialKey", (query) =>
          query
            .eq("libraryId", fixture.created.libraryId)
            .eq("credentialKey", "/services/storage/serviceRoleKey"),
        )
        .unique(),
      operation: await ctx.db.get(fixture.created.setupOperationId),
      scheduledFunctions: await ctx.db.system
        .query("_scheduled_functions")
        .collect(),
    }));
    expect(saved.credential).toMatchObject({
      encryptedValue: "encrypted-storage-key",
      validationState: "valid",
    });
    expect(saved.operation).toMatchObject({
      stage: "application",
      setupReceipts: {
        storage: {
          outcome: "updated",
          privateBucket: "el-private-123",
          publicBucket: "el-public-123",
        },
      },
    });
    expect(
      saved.scheduledFunctions.filter((scheduled) =>
        scheduled.name.includes("runApplicationSetup"),
      ),
    ).toHaveLength(1);
    expect(
      JSON.stringify(
        await fixture.admin.query(api.evidenceLibraries.queries.getSetupDraft, {
          libraryId: fixture.created.libraryId,
        }),
      ),
    ).not.toContain("encrypted-storage-key");

    await expect(
      fixture.t.mutation(
        internal.evidenceLibraries.storageSetup.completeStorageSetup,
        {
          libraryId: fixture.created.libraryId,
          operationId: fixture.created.setupOperationId,
          attemptToken: fixture.attemptToken,
          attemptCount: fixture.attemptCount,
          encryptedServiceRoleKey: "stale-storage-key",
          outcome: "matched",
          privateBucket: "el-private-123",
          publicBucket: "el-public-123",
        },
      ),
    ).rejects.toThrow(/running application/);
  });

  it("recovers the same buckets after a lost create response", async () => {
    const fixture = await createActivatedSetupFixture("storage-retry");
    await fixture.t.mutation(
      internal.evidenceLibraries.databaseSetup.completeDatabaseSetup,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: fixture.attemptToken,
        attemptCount: fixture.attemptCount,
        encryptedDatabaseUrl: "encrypted-database-url",
        outcome: "created",
        databaseName: "el_storage_retry",
        loginName: "el_storage_retry_user",
      },
    );
    const names = createLibraryStorageBucketNames(fixture.created.libraryId);
    const buckets = new Map<string, Record<string, unknown>>();
    let loseFirstCreateResponse = true;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        if (method === "GET") {
          const name = decodeURIComponent(
            url.pathname.slice("/storage/v1/bucket/".length),
          );
          const bucket = buckets.get(name);
          return new Response(bucket ? JSON.stringify(bucket) : "{}", {
            status: bucket ? 200 : 404,
            headers: { "content-type": "application/json" },
          });
        }
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        buckets.set(String(body.id), body);
        if (loseFirstCreateResponse) {
          loseFirstCreateResponse = false;
          throw new Error(`lost response with ${SERVICE_ROLE_KEY}`);
        }
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );

    expect(
      await fixture.t.action(
        internal.evidenceLibraries.storageSetupActions.runStorageSetup,
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
        code: "STORAGE_UNAVAILABLE",
        message: "Supabase Storage could not be reached",
        stage: "storage",
      },
      status: "failed",
    });
    expect(JSON.stringify(failed)).not.toContain(SERVICE_ROLE_KEY);
    expect([...buckets.keys()]).toEqual([names.privateBucket]);

    await fixture.t.mutation(
      internal.evidenceLibraries.setupOperation.claimSetupOperation,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: "storage-retry-2",
      },
    );
    await fixture.t.mutation(
      internal.evidenceLibraries.databaseSetup.completeDatabaseSetup,
      {
        libraryId: fixture.created.libraryId,
        operationId: fixture.created.setupOperationId,
        attemptToken: "storage-retry-2",
        attemptCount: 2,
        encryptedDatabaseUrl: "encrypted-database-url",
        outcome: "matched",
        databaseName: "el_storage_retry",
        loginName: "el_storage_retry_user",
      },
    );
    expect(
      await fixture.t.action(
        internal.evidenceLibraries.storageSetupActions.runStorageSetup,
        {
          libraryId: fixture.created.libraryId,
          operationId: fixture.created.setupOperationId,
          attemptToken: "storage-retry-2",
          attemptCount: 2,
        },
      ),
    ).toMatchObject({ nextStep: "application", status: "running" });
    expect([...buckets.keys()].sort()).toEqual(
      [names.privateBucket, names.publicBucket].sort(),
    );
    const stored = await fixture.t.run(async (ctx) => ({
      credential: await ctx.db
        .query("evidenceLibraryCredentials")
        .withIndex("by_libraryId_and_credentialKey", (query) =>
          query
            .eq("libraryId", fixture.created.libraryId)
            .eq("credentialKey", "/services/storage/serviceRoleKey"),
        )
        .unique(),
      operation: await ctx.db.get(fixture.created.setupOperationId),
    }));
    expect(decrypt(stored.credential!.encryptedValue, ENCRYPTION_KEY)).toBe(
      SERVICE_ROLE_KEY,
    );
    expect(stored.operation).toMatchObject({
      setupReceipts: {
        storage: {
          privateBucket: names.privateBucket,
          publicBucket: names.publicBucket,
        },
      },
      stage: "application",
    });
  });
});
