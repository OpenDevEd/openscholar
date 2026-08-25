import type { Id } from "../_generated/dataModel";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLibraryStorageBucketNames,
  deleteLibraryStorage,
  reconcileLibraryStorage,
  StorageSetupError,
} from "./storageSetupClient";

const LIBRARY_ID =
  "j575gwm9tffaeghzu0rwqc9g196b09zb" as Id<"evidenceLibraries">;
const STORAGE_ORIGIN = "https://storage.example.test";
const SERVICE_ROLE_KEY = "service-role-secret";
const MAX_FILE_BYTES = 100_000_000;

type StoredBucket = {
  id: string;
  name: string;
  public: boolean;
  file_size_limit: number | null;
  allowed_mime_types: string[] | null;
};

type RecordedRequest = {
  body: unknown;
  headers: Headers;
  method: string;
  path: string;
  signal: AbortSignal | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createStorageServer(
  initialBuckets: StoredBucket[] = [],
  options: { persistDeletes?: boolean; persistWrites?: boolean } = {},
) {
  const buckets = new Map(
    initialBuckets.map((bucket) => [bucket.id, structuredClone(bucket)]),
  );
  const requests: RecordedRequest[] = [];
  const persistWrites = options.persistWrites ?? true;

  const fetchImpl: typeof fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({
        body,
        headers: new Headers(init?.headers ?? request?.headers),
        method,
        path: url.pathname,
        signal: init?.signal ?? null,
      });

      if (method === "GET") {
        const prefix = "/storage/v1/bucket/";
        const bucket = buckets.get(
          decodeURIComponent(url.pathname.slice(prefix.length)),
        );
        return bucket
          ? jsonResponse(structuredClone(bucket))
          : jsonResponse({ message: "remote details must stay private" }, 404);
      }

      if (method === "POST" && url.pathname === "/storage/v1/bucket") {
        const write = body as StoredBucket;
        if (persistWrites) buckets.set(write.id, structuredClone(write));
        return jsonResponse({ name: write.name });
      }

      if (method === "POST" && url.pathname.endsWith("/empty")) {
        return jsonResponse({ message: "Emptying bucket" });
      }

      if (method === "DELETE") {
        const prefix = "/storage/v1/bucket/";
        const name = decodeURIComponent(url.pathname.slice(prefix.length));
        if (options.persistDeletes ?? true) buckets.delete(name);
        return jsonResponse({ message: "Bucket deleted" });
      }

      if (method === "PUT") {
        const write = body as StoredBucket;
        if (persistWrites) buckets.set(write.id, structuredClone(write));
        return jsonResponse({ message: "Successfully updated" });
      }

      return jsonResponse({ message: "Unexpected test request" }, 500);
    },
  );

  return { buckets, fetchImpl, requests };
}

function expectedBucket(
  name: string,
  isPublic: boolean,
  allowedMimeTypes: string[],
): StoredBucket {
  return {
    id: name,
    name,
    public: isPublic,
    file_size_limit: MAX_FILE_BYTES,
    allowed_mime_types: allowedMimeTypes,
  };
}

function reconcile(fetchImpl: typeof fetch, storageUrl = STORAGE_ORIGIN) {
  return reconcileLibraryStorage({
    fetchImpl,
    libraryId: LIBRARY_ID,
    maxPdfBytes: MAX_FILE_BYTES,
    serviceRoleKey: SERVICE_ROLE_KEY,
    storageUrl,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Supabase storage setup client", () => {
  it("derives stable private and public names from the library SHA-256 digest", () => {
    const names = createLibraryStorageBucketNames(LIBRARY_ID);

    expect(names).toEqual({
      privateBucket:
        "el-private-96c09962b1fc5032ff50befaa97051678bace52006d73ea2",
      publicBucket:
        "el-public-96c09962b1fc5032ff50befaa97051678bace52006d73ea2",
    });
    expect(createLibraryStorageBucketNames(LIBRARY_ID)).toEqual(names);
    for (const name of Object.values(names)) {
      expect(name).toMatch(/^[a-z0-9-]+$/u);
      expect(name.length).toBeLessThanOrEqual(63);
    }
  });

  it("creates both buckets with fixed requests and reads them back", async () => {
    const server = createStorageServer();
    const names = createLibraryStorageBucketNames(LIBRARY_ID);

    await expect(reconcile(server.fetchImpl)).resolves.toEqual({
      outcome: "created",
      ...names,
    });

    expect(server.requests).toHaveLength(6);
    expect(
      server.requests.map(({ method, path }) => `${method} ${path}`),
    ).toEqual([
      `GET /storage/v1/bucket/${names.privateBucket}`,
      "POST /storage/v1/bucket",
      `GET /storage/v1/bucket/${names.privateBucket}`,
      `GET /storage/v1/bucket/${names.publicBucket}`,
      "POST /storage/v1/bucket",
      `GET /storage/v1/bucket/${names.publicBucket}`,
    ]);
    expect(
      server.requests
        .filter(({ method }) => method === "POST")
        .map(({ body }) => body),
    ).toEqual([
      expectedBucket(names.privateBucket, false, [
        "application/pdf",
        "image/png",
      ]),
      expectedBucket(names.publicBucket, true, [
        "application/pdf",
        "image/png",
      ]),
    ]);
    for (const request of server.requests) {
      expect(request.headers.get("apikey")).toBe(SERVICE_ROLE_KEY);
      expect(request.headers.get("authorization")).toBe(
        `Bearer ${SERVICE_ROLE_KEY}`,
      );
      expect(request.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("matches buckets that already have the fixed policies", async () => {
    const names = createLibraryStorageBucketNames(LIBRARY_ID);
    const server = createStorageServer([
      expectedBucket(names.privateBucket, false, [
        "application/pdf",
        "image/png",
      ]),
      expectedBucket(names.publicBucket, true, [
        "application/pdf",
        "image/png",
      ]),
    ]);

    await expect(reconcile(server.fetchImpl)).resolves.toEqual({
      outcome: "matched",
      ...names,
    });
    expect(server.requests.map(({ method }) => method)).toEqual(["GET", "GET"]);
  });

  it("empties and deletes both derived buckets, then treats a retry as complete", async () => {
    const names = createLibraryStorageBucketNames(LIBRARY_ID);
    const server = createStorageServer([
      expectedBucket(names.privateBucket, false, [
        "application/pdf",
        "image/png",
      ]),
      expectedBucket(names.publicBucket, true, [
        "application/pdf",
        "image/png",
      ]),
    ]);

    await expect(
      deleteLibraryStorage({
        fetchImpl: server.fetchImpl,
        libraryId: LIBRARY_ID,
        serviceRoleKey: SERVICE_ROLE_KEY,
        storageUrl: STORAGE_ORIGIN,
      }),
    ).resolves.toEqual({ outcome: "deleted", ...names });
    await expect(
      deleteLibraryStorage({
        fetchImpl: server.fetchImpl,
        libraryId: LIBRARY_ID,
        serviceRoleKey: SERVICE_ROLE_KEY,
        storageUrl: STORAGE_ORIGIN,
      }),
    ).resolves.toEqual({ outcome: "absent", ...names });
    expect(server.buckets.size).toBe(0);
  });

  it("reports pending while Storage still retains an emptied bucket", async () => {
    const names = createLibraryStorageBucketNames(LIBRARY_ID);
    const server = createStorageServer(
      [
        expectedBucket(names.privateBucket, false, [
          "application/pdf",
          "image/png",
        ]),
      ],
      { persistDeletes: false },
    );

    await expect(
      deleteLibraryStorage({
        fetchImpl: server.fetchImpl,
        libraryId: LIBRARY_ID,
        serviceRoleKey: SERVICE_ROLE_KEY,
        storageUrl: STORAGE_ORIGIN,
      }),
    ).resolves.toEqual({ outcome: "pending", ...names });
  });

  it("updates wrong policies and reads both corrections back", async () => {
    const names = createLibraryStorageBucketNames(LIBRARY_ID);
    const server = createStorageServer([
      expectedBucket(names.privateBucket, true, ["text/plain"]),
      expectedBucket(names.publicBucket, false, ["text/plain"]),
    ]);

    await expect(reconcile(server.fetchImpl)).resolves.toEqual({
      outcome: "updated",
      ...names,
    });
    expect(
      server.requests
        .filter(({ method }) => method === "PUT")
        .map((request) => ({
          body: request.body,
          path: request.path,
        })),
    ).toEqual([
      {
        body: expectedBucket(names.privateBucket, false, [
          "application/pdf",
          "image/png",
        ]),
        path: `/storage/v1/bucket/${names.privateBucket}`,
      },
      {
        body: expectedBucket(names.publicBucket, true, [
          "application/pdf",
          "image/png",
        ]),
        path: `/storage/v1/bucket/${names.publicBucket}`,
      },
    ]);
    expect(
      server.requests.filter(({ method }) => method === "GET"),
    ).toHaveLength(4);
  });

  it("fails when an update does not survive the required read-back", async () => {
    const names = createLibraryStorageBucketNames(LIBRARY_ID);
    const server = createStorageServer(
      [
        expectedBucket(names.privateBucket, true, ["text/plain"]),
        expectedBucket(names.publicBucket, true, [
          "application/pdf",
          "image/png",
        ]),
      ],
      { persistWrites: false },
    );

    await expect(reconcile(server.fetchImpl)).rejects.toMatchObject({
      code: "STORAGE_POLICY_MISMATCH",
      message: "Supabase Storage did not save the required bucket policy",
    });
  });

  it.each([
    "http://storage.example.test",
    "https://storage.example.test/storage/v1",
    "https://storage.example.test?tenant=other",
    "https://user:password@storage.example.test",
  ])("rejects the non-origin storage URL %s", async (storageUrl) => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(reconcile(fetchImpl, storageUrl)).rejects.toMatchObject({
      code: "INVALID_STORAGE_CONFIG",
      message: "Storage URL must be a valid HTTPS origin",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("times out a hanging request with a safe error", async () => {
    vi.useFakeTimers();
    const requestSignals: AbortSignal[] = [];
    const fetchImpl: typeof fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("Request signal is missing"));
            return;
          }
          requestSignals.push(signal);
          signal.addEventListener(
            "abort",
            () => reject(new Error(`remote timeout: ${SERVICE_ROLE_KEY}`)),
            { once: true },
          );
        }),
    );

    const rejection = expect(reconcile(fetchImpl)).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
      message: "Supabase Storage could not be reached",
    });
    await vi.runAllTimersAsync();

    await rejection;
    expect(requestSignals).toHaveLength(1);
    expect(requestSignals[0]?.aborted).toBe(true);
  });

  it("does not copy remote error or key text into failures", async () => {
    const remoteSecret = `internal remote failure using ${SERVICE_ROLE_KEY}`;
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ message: remoteSecret, stack: remoteSecret }, 503),
    );

    const error = await reconcile(fetchImpl).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(StorageSetupError);
    expect(error).toMatchObject({
      code: "STORAGE_REQUEST_FAILED",
      message: "Supabase Storage rejected the bucket request",
    });
    expect(String(error)).not.toContain(remoteSecret);
    expect(String(error)).not.toContain(SERVICE_ROLE_KEY);
  });
});
