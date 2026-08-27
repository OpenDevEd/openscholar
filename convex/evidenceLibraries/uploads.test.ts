/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";

const modules = import.meta.glob("/convex/**/*.ts");
const STORAGE_ORIGIN = "https://storage.example.test";
const SERVICE_ROLE_KEY = "service-role-secret";

async function seedLibrary(role: "org:admin" | "org:member") {
  const t = convexTest(schema, modules);
  const libraryId = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      clerkOrganizationId: "org_uploads",
      name: "Uploads Team",
      slug: "uploads-team",
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      evidenceLibrariesEnabled: true,
    });
    await ctx.db.insert("organizationMemberships", {
      organizationId,
      clerkMembershipId: "orgmem_uploads",
      clerkUserId: "user_uploads",
      role,
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    return await ctx.db.insert("evidenceLibraries", {
      organizationId,
      name: "Uploads Library",
      slug: "uploads-library",
      state: "provisioning",
      createdByClerkUserId: "user_uploads",
      updatedByClerkUserId: "user_uploads",
      createdAt: 1,
      updatedAt: 1,
    });
  });
  const caller = t.withIdentity({
    subject: "user_uploads",
    o: { id: "org_uploads", rol: role },
  });
  return { caller, libraryId, t };
}

/** Reads the error data an action threw; convex-test hands it back as JSON text. */
async function errorData(work: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await work;
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    return typeof data === "string" ? JSON.parse(data) : (data as Record<string, unknown>);
  }
  throw new Error("expected the action to fail");
}

/** Records every request the action sends to the file store. */
function stubFileStore() {
  const objects = new Set<string>();
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof URL ? input.href : String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const match = url.pathname.match(/^\/storage\/v1\/object\/openscholar\/(.+)$/);
    if (method === "POST" && match) {
      objects.add(match[1]);
      return Response.json({ Key: `openscholar/${match[1]}` });
    }
    if (method === "DELETE" && url.pathname === "/storage/v1/object/openscholar") {
      const { prefixes } = JSON.parse(String(init?.body)) as { prefixes: string[] };
      for (const key of prefixes) objects.delete(key);
      return Response.json(prefixes.map((name) => ({ name })));
    }
    return Response.json({ message: "unexpected" }, { status: 500 });
  });
  vi.stubGlobal("fetch", fetchImpl);
  return { fetchImpl, objects };
}

describe("Evidence Library uploads", () => {
  beforeEach(() => {
    vi.stubEnv("EL_STORAGE_URL", STORAGE_ORIGIN);
    vi.stubEnv("EL_STORAGE_SERVICE_KEY", SERVICE_ROLE_KEY);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("gives owners an upload URL and refuses members", async () => {
    const owner = await seedLibrary("org:admin");
    const url = await owner.caller.mutation(
      api.evidenceLibraries.uploads.generateUploadUrl,
      { libraryId: owner.libraryId },
    );
    expect(url).toMatch(/^https?:\/\//);

    const member = await seedLibrary("org:member");
    await expect(
      member.caller.mutation(api.evidenceLibraries.uploads.generateUploadUrl, {
        libraryId: member.libraryId,
      }),
    ).rejects.toThrow(/access denied/);
  });

  it("stores an image, returns its public URL and drops the temporary file", async () => {
    const store = stubFileStore();
    const { caller, libraryId, t } = await seedLibrary("org:admin");
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob([png], { type: "image/png" })),
    );

    const result = await caller.action(api.evidenceLibraries.uploadActions.upload, {
      libraryId,
      kind: "image",
      name: "logo.png",
      storageId,
    });

    expect(result).toMatchObject({
      kind: "file",
      bytes: 8,
      contentType: "image/png",
      name: "logo.png",
    });
    if (result.kind !== "file") throw new Error("expected a file result");
    expect(result.url).toMatch(
      new RegExp(
        `^${STORAGE_ORIGIN}/storage/v1/object/public/openscholar/evidence-libraries/${libraryId}/image-[0-9a-f]{8}\\.png$`,
      ),
    );
    expect([...store.objects]).toEqual([
      result.url.split("/openscholar/")[1],
    ]);
    const temporary = await t.run((ctx) => ctx.storage.get(storageId));
    expect(temporary).toBeNull();
  });

  it("returns legal files as text without storing them", async () => {
    const store = stubFileStore();
    const { caller, libraryId, t } = await seedLibrary("org:admin");
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["# Privacy\n\nWe keep little."], { type: "text/markdown" })),
    );

    const result = await caller.action(api.evidenceLibraries.uploadActions.upload, {
      libraryId,
      kind: "legal",
      name: "privacy.md",
      storageId,
    });

    expect(result).toEqual({
      kind: "text",
      bytes: 26,
      name: "privacy.md",
      text: "# Privacy\n\nWe keep little.",
    });
    expect(store.objects.size).toBe(0);
  });

  it("rejects the wrong type with a reason and still drops the temporary file", async () => {
    stubFileStore();
    const { caller, libraryId, t } = await seedLibrary("org:admin");
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["gif"], { type: "image/gif" })),
    );

    expect(
      await errorData(
        caller.action(api.evidenceLibraries.uploadActions.upload, {
          libraryId,
          kind: "image",
          name: "logo.gif",
          storageId,
        }),
      ),
    ).toMatchObject({ code: "VALIDATION_ERROR", reason: "type" });
    expect(await t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
  });

  it("rejects a file whose bytes do not match its name", async () => {
    const store = stubFileStore();
    const { caller, libraryId, t } = await seedLibrary("org:admin");
    const svgNamedPng = await t.run((ctx) =>
      ctx.storage.store(
        new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: "image/png" }),
      ),
    );
    expect(
      await errorData(
        caller.action(api.evidenceLibraries.uploadActions.upload, {
          libraryId,
          kind: "image",
          name: "logo.png",
          storageId: svgNamedPng,
        }),
      ),
    ).toMatchObject({ code: "VALIDATION_ERROR", reason: "type" });

    const scriptSvg = await t.run((ctx) =>
      ctx.storage.store(
        new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'], {
          type: "image/svg+xml",
        }),
      ),
    );
    expect(
      await errorData(
        caller.action(api.evidenceLibraries.uploadActions.upload, {
          libraryId,
          kind: "image",
          name: "logo.svg",
          storageId: scriptSvg,
        }),
      ),
    ).toMatchObject({ code: "VALIDATION_ERROR", reason: "type" });
    expect(store.objects.size).toBe(0);
  });

  it("refuses uploads from members and changes nothing at all", async () => {
    const store = stubFileStore();
    const { caller, libraryId, t } = await seedLibrary("org:member");
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["x"], { type: "image/png" })),
    );
    await expect(
      caller.action(api.evidenceLibraries.uploadActions.upload, {
        libraryId,
        kind: "image",
        name: "logo.png",
        storageId,
      }),
    ).rejects.toThrow(/access denied/);
    // A refused caller must not cause any write, not even the cleanup delete.
    const stillThere = await t.run(
      async (ctx) => (await ctx.storage.get(storageId)) !== null,
    );
    expect(stillThere).toBe(true);
    expect(store.objects.size).toBe(0);
  });

  it("still drops the temporary file when an allowed upload is rejected", async () => {
    const store = stubFileStore();
    const { caller, libraryId, t } = await seedLibrary("org:admin");
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["x"], { type: "text/plain" })),
    );
    await expect(
      caller.action(api.evidenceLibraries.uploadActions.upload, {
        libraryId,
        kind: "image",
        name: "logo.png",
        storageId,
      }),
    ).rejects.toThrow(/VALIDATION_ERROR/);
    const deleted = await t.run(
      async (ctx) => (await ctx.storage.get(storageId)) === null,
    );
    expect(deleted).toBe(true);
    expect(store.objects.size).toBe(0);
  });

  it("removes only files inside the library prefix", async () => {
    const store = stubFileStore();
    const { caller, libraryId } = await seedLibrary("org:admin");
    const ownKey = `evidence-libraries/${libraryId}/image-abcdef01.svg`;
    const otherKey = "evidence-libraries/otherlibrary000000000000000000000/image-abcdef01.svg";
    store.objects.add(ownKey);
    store.objects.add(otherKey);
    const publicUrl = (key: string) =>
      `${STORAGE_ORIGIN}/storage/v1/object/public/openscholar/${key}`;

    await caller.action(api.evidenceLibraries.uploadActions.remove, {
      libraryId,
      url: publicUrl(ownKey),
    });
    expect(store.objects.has(ownKey)).toBe(false);

    expect(
      await errorData(
        caller.action(api.evidenceLibraries.uploadActions.remove, {
          libraryId,
          url: publicUrl(otherKey),
        }),
      ),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(store.objects.has(otherKey)).toBe(true);
  });
});
