import { describe, expect, it, vi } from "vitest";
import { StorageSetupError } from "./storageSetupClient";
import {
  deleteLibraryUpload,
  deleteLibraryUploads,
  ensureUploadBucket,
  storeLibraryUpload,
} from "./uploadsClient";

const LIBRARY_ID = "j575gwm9tffaeghzu0rwqc9g196b09zb";
const STORAGE_ORIGIN = "https://storage.example.test";
const SERVICE_ROLE_KEY = "service-role-secret";

type RecordedRequest = {
  body: unknown;
  headers: Headers;
  method: string;
  path: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** In-memory stand-in for the file store's object endpoints. */
function createObjectServer(initialObjects: string[] = []) {
  const objects = new Set(initialObjects);
  const requests: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers);
      const isJson = headers.get("content-type") === "application/json";
      const body =
        init?.body && isJson
          ? JSON.parse(String(init.body))
          : (init?.body ?? null);
      requests.push({ body, headers, method, path: url.pathname });
      if (headers.get("authorization") !== `Bearer ${SERVICE_ROLE_KEY}`) {
        return jsonResponse({ message: "unauthorized" }, 401);
      }

      const uploadMatch = url.pathname.match(
        /^\/storage\/v1\/object\/openscholar\/(.+)$/,
      );
      if (method === "POST" && uploadMatch) {
        objects.add(uploadMatch[1]);
        return jsonResponse({ Key: `openscholar/${uploadMatch[1]}` });
      }
      if (method === "DELETE" && url.pathname === "/storage/v1/object/openscholar") {
        const prefixes = (body as { prefixes: string[] }).prefixes;
        for (const key of prefixes) objects.delete(key);
        return jsonResponse(prefixes.map((name) => ({ name })));
      }
      if (
        method === "POST" &&
        url.pathname === "/storage/v1/object/list/openscholar"
      ) {
        const { prefix, limit, offset } = body as {
          prefix: string;
          limit: number;
          offset: number;
        };
        const names = [...objects]
          .filter((key) => key.startsWith(prefix))
          .map((key) => key.slice(prefix.length))
          .sort()
          .slice(offset, offset + limit);
        return jsonResponse(names.map((name) => ({ name })));
      }
      return jsonResponse({ message: "not found" }, 404);
    },
  );
  return { fetchImpl, objects, requests };
}

function pngBytes(fill: number): ArrayBuffer {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47]);
  bytes.fill(fill, 8);
  return bytes.buffer;
}

describe("storeLibraryUpload", () => {
  it("writes the file under the library prefix and returns a stable public URL", async () => {
    const server = createObjectServer();
    const stored = await storeLibraryUpload({
      storageUrl: STORAGE_ORIGIN,
      serviceRoleKey: SERVICE_ROLE_KEY,
      fetchImpl: server.fetchImpl,
      libraryId: LIBRARY_ID,
      kind: "image",
      name: "Logo Dark.PNG",
      bytes: pngBytes(1),
    });

    expect(stored.key).toMatch(
      new RegExp(`^evidence-libraries/${LIBRARY_ID}/image-[0-9a-f]{8}\\.png$`),
    );
    expect(stored.url).toBe(
      `${STORAGE_ORIGIN}/storage/v1/object/public/openscholar/${stored.key}`,
    );
    expect(new URL(stored.url).search).toBe("");
    expect(stored.contentType).toBe("image/png");
    expect(stored.bytes).toBe(64);
    expect(server.objects.has(stored.key)).toBe(true);

    const upload = server.requests[0];
    expect(upload.method).toBe("POST");
    expect(upload.headers.get("content-type")).toBe("image/png");
    expect(upload.headers.get("cache-control")).toBe("max-age=31536000");
    expect(upload.headers.get("apikey")).toBe(SERVICE_ROLE_KEY);
  });

  it("gives the same key for the same content and a new key for new content", async () => {
    const server = createObjectServer();
    const base = {
      storageUrl: STORAGE_ORIGIN,
      serviceRoleKey: SERVICE_ROLE_KEY,
      fetchImpl: server.fetchImpl,
      libraryId: LIBRARY_ID,
      kind: "shareImage" as const,
    };
    const first = await storeLibraryUpload({ ...base, name: "a.jpeg", bytes: pngBytes(1) });
    const same = await storeLibraryUpload({ ...base, name: "b.jpg", bytes: pngBytes(1) });
    const changed = await storeLibraryUpload({ ...base, name: "a.jpeg", bytes: pngBytes(2) });

    expect(same.key).toBe(first.key);
    expect(changed.key).not.toBe(first.key);
    expect(first.key.endsWith(".jpg")).toBe(true);
    expect(server.objects.size).toBe(2);
  });

  it("rejects the wrong type and oversized files before contacting the store", async () => {
    const server = createObjectServer();
    const base = {
      storageUrl: STORAGE_ORIGIN,
      serviceRoleKey: SERVICE_ROLE_KEY,
      fetchImpl: server.fetchImpl,
      libraryId: LIBRARY_ID,
    };
    await expect(
      storeLibraryUpload({ ...base, kind: "image", name: "logo.gif", bytes: pngBytes(1) }),
    ).rejects.toMatchObject({ code: "UPLOAD_WRONG_TYPE" });
    await expect(
      storeLibraryUpload({
        ...base,
        kind: "image",
        name: "logo.png",
        bytes: new ArrayBuffer(1024 * 1024 + 1),
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_TOO_BIG" });
    expect(server.requests).toHaveLength(0);
  });

  it("reports a rejected write as a storage error with the status", async () => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ message: "nope" }, 500),
    );
    await expect(
      storeLibraryUpload({
        storageUrl: STORAGE_ORIGIN,
        serviceRoleKey: SERVICE_ROLE_KEY,
        fetchImpl,
        libraryId: LIBRARY_ID,
        kind: "image",
        name: "logo.png",
        bytes: pngBytes(1),
      }),
    ).rejects.toSatisfy(
      (error) =>
        error instanceof StorageSetupError &&
        error.code === "STORAGE_REQUEST_FAILED" &&
        error.status === 500,
    );
  });
});

describe("deleteLibraryUpload and deleteLibraryUploads", () => {
  it("deletes one key", async () => {
    const key = `evidence-libraries/${LIBRARY_ID}/image-abcdef01.svg`;
    const server = createObjectServer([key]);
    await deleteLibraryUpload({
      storageUrl: STORAGE_ORIGIN,
      serviceRoleKey: SERVICE_ROLE_KEY,
      fetchImpl: server.fetchImpl,
      key,
    });
    expect(server.objects.has(key)).toBe(false);
    expect(server.requests[0]).toMatchObject({
      method: "DELETE",
      path: "/storage/v1/object/openscholar",
      body: { prefixes: [key] },
    });
  });

  it("lists every page of the library prefix and deletes only those files", async () => {
    const prefix = `evidence-libraries/${LIBRARY_ID}/`;
    const own = Array.from({ length: 150 }, (_, i) => `${prefix}image-${String(i).padStart(8, "0")}.png`);
    const other = "evidence-libraries/otherlibrary000000000000000000000/image-00000000.png";
    const server = createObjectServer([...own, other]);

    const result = await deleteLibraryUploads({
      storageUrl: STORAGE_ORIGIN,
      serviceRoleKey: SERVICE_ROLE_KEY,
      fetchImpl: server.fetchImpl,
      libraryId: LIBRARY_ID,
    });

    expect(result).toEqual({ deleted: 150 });
    expect([...server.objects]).toEqual([other]);
    expect(server.requests.filter((r) => r.path.endsWith("/list/openscholar"))).toHaveLength(2);
  });

  it("does nothing when the library has no files", async () => {
    const server = createObjectServer();
    const result = await deleteLibraryUploads({
      storageUrl: STORAGE_ORIGIN,
      serviceRoleKey: SERVICE_ROLE_KEY,
      fetchImpl: server.fetchImpl,
      libraryId: LIBRARY_ID,
    });
    expect(result).toEqual({ deleted: 0 });
    expect(server.requests.filter((r) => r.method === "DELETE")).toHaveLength(0);
  });
});

describe("ensureUploadBucket", () => {
  it("creates the public openscholar bucket when it is missing", async () => {
    const buckets = new Map<string, Record<string, unknown>>();
    const fetchImpl: typeof fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof URL ? input.href : String(input));
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET") {
          const bucket = buckets.get(url.pathname.split("/").pop() ?? "");
          return bucket ? jsonResponse(bucket) : jsonResponse({ message: "missing" }, 404);
        }
        if (method === "POST") {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          buckets.set(String(body.id), body);
          return jsonResponse({ name: body.id });
        }
        return jsonResponse({ message: "unexpected" }, 500);
      },
    );

    const outcome = await ensureUploadBucket({
      storageUrl: STORAGE_ORIGIN,
      serviceRoleKey: SERVICE_ROLE_KEY,
      fetchImpl,
    });

    expect(outcome).toBe("created");
    expect(buckets.get("openscholar")).toMatchObject({
      public: true,
      file_size_limit: 2 * 1024 * 1024,
    });

    const again = await ensureUploadBucket({
      storageUrl: STORAGE_ORIGIN,
      serviceRoleKey: SERVICE_ROLE_KEY,
      fetchImpl,
    });
    expect(again).toBe("matched");
  });
});
