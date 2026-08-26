import { describe, expect, test } from "vitest";

import {
  EVIDENCE_LIBRARY_UPLOAD_BUCKET,
  EVIDENCE_LIBRARY_UPLOAD_LIMITS,
  checkEvidenceLibraryUpload,
  checkEvidenceLibraryUploadContent,
  createEvidenceLibraryUploadKey,
  detectEvidenceLibraryUploadContent,
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

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
]);
const SVG = bytesOf(
  '<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
);

describe("Evidence Library upload content detection", () => {
  test("detects png, jpeg, webp and svg from the bytes", () => {
    expect(detectEvidenceLibraryUploadContent(PNG)).toBe("png");
    expect(detectEvidenceLibraryUploadContent(JPG)).toBe("jpg");
    expect(detectEvidenceLibraryUploadContent(WEBP)).toBe("webp");
    expect(detectEvidenceLibraryUploadContent(SVG)).toBe("svg");
    expect(detectEvidenceLibraryUploadContent(bytesOf("# Privacy\n"))).toBe("text");
    expect(detectEvidenceLibraryUploadContent(new Uint8Array([0xff, 0xfe, 0xfd]))).toBeNull();
    expect(detectEvidenceLibraryUploadContent(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe("text");
  });

  test("rejects svg without an svg root or with script", () => {
    expect(detectEvidenceLibraryUploadContent(bytesOf("<html><svg/></html>"))).toBe("text");
    expect(
      detectEvidenceLibraryUploadContent(bytesOf('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')),
    ).toBe("text");
    expect(
      detectEvidenceLibraryUploadContent(bytesOf('<svg xmlns="http://www.w3.org/2000/svg"><SCRIPT href="x"/></svg>')),
    ).toBe("text");
    expect(
      detectEvidenceLibraryUploadContent(bytesOf('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')),
    ).toBe("text");
    expect(
      detectEvidenceLibraryUploadContent(bytesOf('<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"/></svg>')),
    ).toBe("text");
    expect(
      detectEvidenceLibraryUploadContent(bytesOf('<svg:svg xmlns:svg="http://www.w3.org/2000/svg"/>')),
    ).toBe("svg");
  });

  test("checks the content against the name and kind", () => {
    expect(
      checkEvidenceLibraryUploadContent({ kind: "image", name: "logo.png", content: PNG }),
    ).toEqual({ ok: true, extension: "png", contentType: "image/png" });
    expect(
      checkEvidenceLibraryUploadContent({ kind: "image", name: "logo.svg", content: SVG }),
    ).toEqual({ ok: true, extension: "svg", contentType: "image/svg+xml" });
    expect(
      checkEvidenceLibraryUploadContent({ kind: "shareImage", name: "card.jpeg", content: JPG }),
    ).toEqual({ ok: true, extension: "jpg", contentType: "image/jpeg" });
    expect(
      checkEvidenceLibraryUploadContent({ kind: "legal", name: "privacy.md", content: bytesOf("# Hi") }),
    ).toEqual({ ok: true, extension: "md", contentType: "text/markdown" });

    // name says png, bytes are svg
    expect(
      checkEvidenceLibraryUploadContent({ kind: "image", name: "logo.png", content: SVG }),
    ).toEqual({ ok: false, reason: "type" });
    // name says svg, bytes are png
    expect(
      checkEvidenceLibraryUploadContent({ kind: "image", name: "logo.svg", content: PNG }),
    ).toEqual({ ok: false, reason: "type" });
    // svg with script under an svg name
    expect(
      checkEvidenceLibraryUploadContent({
        kind: "image",
        name: "logo.svg",
        content: bytesOf('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
      }),
    ).toEqual({ ok: false, reason: "type" });
    // legal file that is not valid UTF-8 text
    expect(
      checkEvidenceLibraryUploadContent({ kind: "legal", name: "terms.txt", content: new Uint8Array([0xff, 0xfe]) }),
    ).toEqual({ ok: false, reason: "type" });
    // legal file with image bytes
    expect(
      checkEvidenceLibraryUploadContent({ kind: "legal", name: "terms.txt", content: PNG }),
    ).toEqual({ ok: false, reason: "type" });
    // size still checked
    expect(
      checkEvidenceLibraryUploadContent({ kind: "legal", name: "terms.txt", content: new Uint8Array(204_801).fill(0x61) }),
    ).toEqual({ ok: false, reason: "size" });
  });
});
