import { describe, expect, test } from "vitest";

import {
  EVIDENCE_LIBRARY_UPLOAD_BUCKET,
  EVIDENCE_LIBRARY_UPLOAD_LIMITS,
  checkEvidenceLibraryUpload,
  createEvidenceLibraryUploadKey,
  evidenceLibraryUploadPrefix,
  evidenceLibraryUploadUrl,
  parseOwnedEvidenceLibraryUploadUrl,
} from "./uploads";

const LIBRARY_ID = "j575gwm9tffaeghzu0rwqc9g196b09zb";
const STORAGE_ORIGIN = "https://storage.example.test";

describe("Evidence Library upload checks", () => {
  test("accepts the file types each kind allows and maps the content type", () => {
    expect(
      checkEvidenceLibraryUpload({ kind: "image", name: "Logo.SVG", bytes: 10 }),
    ).toEqual({ ok: true, extension: "svg", contentType: "image/svg+xml" });
    expect(
      checkEvidenceLibraryUpload({ kind: "image", name: "logo.webp", bytes: 10 }),
    ).toEqual({ ok: true, extension: "webp", contentType: "image/webp" });
    expect(
      checkEvidenceLibraryUpload({
        kind: "shareImage",
        name: "card.jpeg",
        bytes: 10,
      }),
    ).toEqual({ ok: true, extension: "jpg", contentType: "image/jpeg" });
    expect(
      checkEvidenceLibraryUpload({ kind: "legal", name: "privacy.md", bytes: 10 }),
    ).toEqual({ ok: true, extension: "md", contentType: "text/markdown" });
    expect(
      checkEvidenceLibraryUpload({ kind: "legal", name: "terms.txt", bytes: 10 }),
    ).toEqual({ ok: true, extension: "txt", contentType: "text/plain" });
  });

  test("rejects the wrong type before the size", () => {
    expect(
      checkEvidenceLibraryUpload({ kind: "image", name: "logo.jpg", bytes: 10 }),
    ).toEqual({ ok: false, reason: "type" });
    expect(
      checkEvidenceLibraryUpload({ kind: "shareImage", name: "card.svg", bytes: 10 }),
    ).toEqual({ ok: false, reason: "type" });
    expect(
      checkEvidenceLibraryUpload({ kind: "legal", name: "privacy.pdf", bytes: 10 }),
    ).toEqual({ ok: false, reason: "type" });
    expect(
      checkEvidenceLibraryUpload({ kind: "image", name: "noextension", bytes: 10 }),
    ).toEqual({ ok: false, reason: "type" });
  });

  test("rejects files over each kind's limit and empty files", () => {
    expect(EVIDENCE_LIBRARY_UPLOAD_LIMITS).toEqual({
      image: 1_048_576,
      shareImage: 2_097_152,
      legal: 204_800,
    });
    expect(
      checkEvidenceLibraryUpload({
        kind: "image",
        name: "logo.png",
        bytes: 1_048_576,
      }),
    ).toEqual({ ok: true, extension: "png", contentType: "image/png" });
    expect(
      checkEvidenceLibraryUpload({
        kind: "image",
        name: "logo.png",
        bytes: 1_048_577,
      }),
    ).toEqual({ ok: false, reason: "size" });
    expect(
      checkEvidenceLibraryUpload({
        kind: "shareImage",
        name: "card.png",
        bytes: 2_097_153,
      }),
    ).toEqual({ ok: false, reason: "size" });
    expect(
      checkEvidenceLibraryUpload({ kind: "legal", name: "a.md", bytes: 204_801 }),
    ).toEqual({ ok: false, reason: "size" });
    expect(
      checkEvidenceLibraryUpload({ kind: "image", name: "logo.png", bytes: 0 }),
    ).toEqual({ ok: false, reason: "size" });
  });
});

describe("Evidence Library upload keys and URLs", () => {
  test("derives a stable key under the library prefix with the extension kept", () => {
    const key = createEvidenceLibraryUploadKey({
      libraryId: LIBRARY_ID,
      kind: "shareImage",
      contentHashHex: "abcdef0123456789abcdef0123456789",
      extension: "png",
    });
    expect(key).toBe(
      `evidence-libraries/${LIBRARY_ID}/shareImage-abcdef01.png`,
    );
    expect(evidenceLibraryUploadPrefix(LIBRARY_ID)).toBe(
      `evidence-libraries/${LIBRARY_ID}/`,
    );
    expect(key.startsWith(evidenceLibraryUploadPrefix(LIBRARY_ID))).toBe(true);
  });

  test("builds a public URL without a query string that ends in the extension", () => {
    const url = evidenceLibraryUploadUrl({
      storageOrigin: STORAGE_ORIGIN,
      key: `evidence-libraries/${LIBRARY_ID}/image-abcdef01.svg`,
    });
    expect(url).toBe(
      `${STORAGE_ORIGIN}/storage/v1/object/public/${EVIDENCE_LIBRARY_UPLOAD_BUCKET}/evidence-libraries/${LIBRARY_ID}/image-abcdef01.svg`,
    );
    expect(new URL(url).search).toBe("");
    expect(url.endsWith(".svg")).toBe(true);
  });

  test("returns the object key only for URLs inside the library prefix", () => {
    const ownKey = `evidence-libraries/${LIBRARY_ID}/image-abcdef01.svg`;
    const ownUrl = evidenceLibraryUploadUrl({
      storageOrigin: STORAGE_ORIGIN,
      key: ownKey,
    });
    expect(
      parseOwnedEvidenceLibraryUploadUrl({
        storageOrigin: STORAGE_ORIGIN,
        libraryId: LIBRARY_ID,
        url: ownUrl,
      }),
    ).toBe(ownKey);

    const rejected = [
      `${STORAGE_ORIGIN}/storage/v1/object/public/${EVIDENCE_LIBRARY_UPLOAD_BUCKET}/evidence-libraries/otherlibrary000000000000000000000/image-abcdef01.svg`,
      `${STORAGE_ORIGIN}/storage/v1/object/public/other-bucket/${ownKey}`,
      `https://elsewhere.example.test/storage/v1/object/public/${EVIDENCE_LIBRARY_UPLOAD_BUCKET}/${ownKey}`,
      `${STORAGE_ORIGIN}/storage/v1/object/public/${EVIDENCE_LIBRARY_UPLOAD_BUCKET}/evidence-libraries/${LIBRARY_ID}/../${LIBRARY_ID}x/a.svg`,
      `${STORAGE_ORIGIN}/storage/v1/object/public/${EVIDENCE_LIBRARY_UPLOAD_BUCKET}/evidence-libraries/${LIBRARY_ID}/`,
      "not a url",
    ];
    for (const url of rejected) {
      expect(
        parseOwnedEvidenceLibraryUploadUrl({
          storageOrigin: STORAGE_ORIGIN,
          libraryId: LIBRARY_ID,
          url,
        }),
      ).toBeNull();
    }
  });
});
