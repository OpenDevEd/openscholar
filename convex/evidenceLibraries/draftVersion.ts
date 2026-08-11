import { createError } from "../lib/errors";

export function nextDraftEditVersion(
  currentEditVersion: number,
  expectedEditVersion: number,
): number {
  if (currentEditVersion !== expectedEditVersion) {
    throw createError("CONFLICT", "Draft changed since it was loaded", {
      currentEditVersion,
      expectedEditVersion,
    });
  }

  return currentEditVersion + 1;
}
