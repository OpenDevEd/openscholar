import {
  escapeJsonPointerToken,
  jsonPointerPatternMatches,
} from "../../lib/evidence-libraries/configuration/json-pointer";
import { WRITE_ONLY_POINTER_PATTERNS } from "../../lib/evidence-libraries/configuration/section-registry";

export const MAX_SECTION_PAYLOAD_BYTES = 512 * 1024;
export const MAX_DRAFT_PAYLOAD_BYTES = 768 * 1024;

function assertStrictJson(value: unknown, seen: WeakSet<object>): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new Error("Section payload must be strict JSON");
  }
  if (typeof value !== "object") {
    throw new Error("Section payload must be strict JSON");
  }
  if (seen.has(value)) {
    throw new Error("Section payload must be strict JSON");
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) assertStrictJson(item, seen);
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Section payload must be strict JSON");
    }
    for (const item of Object.values(value as Record<string, unknown>)) {
      assertStrictJson(item, seen);
    }
  }
  seen.delete(value);
}

export function validateSectionPayload(payload: unknown): number {
  assertStrictJson(payload, new WeakSet());
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) {
    throw new Error("Section payload must be strict JSON");
  }
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > MAX_SECTION_PAYLOAD_BYTES) {
    throw new Error("Section payload exceeds the section payload limit");
  }
  return byteLength;
}

export function assertDraftPayloadBudget(totalByteLength: number): void {
  if (totalByteLength > MAX_DRAFT_PAYLOAD_BYTES) {
    throw new Error("Draft exceeds the draft payload limit");
  }
}

export function assertNoCredentialMaterial(
  sectionKey: string,
  payload: unknown,
): void {
  function visit(value: unknown, pointer: string): void {
    if (
      WRITE_ONLY_POINTER_PATTERNS.some((pattern) =>
        jsonPointerPatternMatches(pattern, pointer),
      )
    ) {
      throw new Error("Write-only values belong to the credential lifecycle");
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${pointer}/${index}`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        visit(item, `${pointer}/${escapeJsonPointerToken(key)}`);
      }
    }
  }

  visit(payload, `/${escapeJsonPointerToken(sectionKey)}`);
}
