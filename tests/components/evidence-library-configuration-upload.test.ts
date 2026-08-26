import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkUploadFile,
  fileNameFromUrl,
  type UploadClient,
  uploadFile,
} from "@/components/evidence-libraries/configuration/upload-file";
import type { Id } from "@/convex/_generated/dataModel";

const libraryId = "library_123" as Id<"evidenceLibraries">;

function client(overrides: Partial<UploadClient> = {}): UploadClient {
  return {
    generateUploadUrl: async () => "https://upload.example.test/put",
    upload: async ({ name }) => ({
      kind: "file",
      bytes: 10,
      contentType: "image/png",
      name,
      url: `https://files.example.test/evidence-libraries/library_123/image-abc123.png`,
    }),
    remove: async () => null,
    ...overrides,
  };
}

describe("checkUploadFile", () => {
  it("accepts the platform's allowed types", () => {
    expect(checkUploadFile("image", { name: "logo.svg", size: 10 })).toBeNull();
    expect(checkUploadFile("image", { name: "logo.webp", size: 10 })).toBeNull();
    expect(checkUploadFile("shareImage", { name: "card.jpeg", size: 10 })).toBeNull();
  });

  it("rejects the wrong type before the size", () => {
    expect(checkUploadFile("image", { name: "photo.gif", size: 10 })).toBe("type");
    expect(checkUploadFile("shareImage", { name: "card.svg", size: 10 })).toBe("type");
  });

  it("rejects files over the limit", () => {
    expect(checkUploadFile("image", { name: "logo.png", size: 1024 * 1024 + 1 })).toBe("size");
    expect(checkUploadFile("image", { name: "logo.png", size: 1024 * 1024 })).toBeNull();
  });
});

describe("uploadFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the file to the upload url and returns the stored url", async () => {
    const posted: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        posted.push({ url, body: init.body });
        return new Response(JSON.stringify({ storageId: "storage_1" }), { status: 200 });
      }),
    );
    const uploads: unknown[] = [];
    const file = new File(["png"], "logo.png", { type: "image/png" });
    const result = await uploadFile(
      client({
        upload: async (args) => {
          uploads.push(args);
          return { kind: "file", bytes: 3, contentType: "image/png", name: args.name, url: "https://files.example.test/logo.png" };
        },
      }),
      libraryId,
      "image",
      file,
    );

    expect(posted).toEqual([{ url: "https://upload.example.test/put", body: file }]);
    expect(uploads).toEqual([{ libraryId, kind: "image", name: "logo.png", storageId: "storage_1" }]);
    expect(result).toEqual({ ok: true, kind: "file", url: "https://files.example.test/logo.png", name: "logo.png" });
  });

  it("does not leave the browser when the file is not allowed", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await uploadFile(
      client(),
      libraryId,
      "image",
      new File(["gif"], "photo.gif", { type: "image/gif" }),
    );
    expect(result).toEqual({ ok: false, error: "type" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps the platform's rejection reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ storageId: "storage_1" }), { status: 200 })),
    );
    const result = await uploadFile(
      client({
        upload: async () => {
          throw new ConvexError({ code: "VALIDATION_ERROR", reason: "size" });
        },
      }),
      libraryId,
      "image",
      new File(["png"], "logo.png", { type: "image/png" }),
    );
    expect(result).toEqual({ ok: false, error: "size" });
  });

  it("reports a failed upload when the temporary upload is refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    const result = await uploadFile(
      client(),
      libraryId,
      "image",
      new File(["png"], "logo.png", { type: "image/png" }),
    );
    expect(result).toEqual({ ok: false, error: "failed" });
  });
});

describe("fileNameFromUrl", () => {
  it("shows the stored file name", () => {
    expect(
      fileNameFromUrl("https://files.example.test/evidence-libraries/lib/image-abc123.png?x=1"),
    ).toBe("image-abc123.png");
  });
});
