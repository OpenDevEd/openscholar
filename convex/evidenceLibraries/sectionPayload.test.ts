import { describe, expect, it } from "vitest";
import {
  MAX_DRAFT_PAYLOAD_BYTES,
  MAX_SECTION_PAYLOAD_BYTES,
  assertDraftPayloadBudget,
  validateSectionPayload,
} from "./sectionPayload";

describe("validateSectionPayload", () => {
  it("returns the exact UTF-8 byte length for strict JSON", () => {
    const payload = { label: "Évidence", enabled: true, values: [1, null] };
    expect(validateSectionPayload(payload)).toBe(
      new TextEncoder().encode(JSON.stringify(payload)).byteLength,
    );
  });

  it.each([
    ["undefined", { value: undefined }],
    ["bigint", { value: 1n }],
    ["NaN", { value: Number.NaN }],
    ["infinity", { value: Number.POSITIVE_INFINITY }],
    ["bytes", { value: new Uint8Array([1]) }],
  ])("rejects %s because it is not strict JSON", (_label, payload) => {
    expect(() => validateSectionPayload(payload)).toThrow(/strict JSON/);
  });

  it("rejects a section beyond the bounded document budget", () => {
    const payload = "x".repeat(MAX_SECTION_PAYLOAD_BYTES);
    expect(() => validateSectionPayload(payload)).toThrow(/section payload limit/);
  });
});

describe("assertDraftPayloadBudget", () => {
  it("accepts the boundary and rejects the first byte over it", () => {
    expect(() => assertDraftPayloadBudget(MAX_DRAFT_PAYLOAD_BYTES)).not.toThrow();
    expect(() => assertDraftPayloadBudget(MAX_DRAFT_PAYLOAD_BYTES + 1)).toThrow(
      /draft payload limit/,
    );
  });
});
