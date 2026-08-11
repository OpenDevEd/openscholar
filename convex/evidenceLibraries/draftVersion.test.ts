import { describe, expect, test } from "vitest";

import { nextDraftEditVersion } from "./draftVersion";

describe("nextDraftEditVersion", () => {
  test("increments a draft when the expected edit version matches", () => {
    expect(nextDraftEditVersion(4, 4)).toBe(5);
  });

  test("returns a typed conflict when the expected edit version is stale", () => {
    expect(() => nextDraftEditVersion(5, 4)).toThrowError(
      expect.objectContaining({
        data: {
          code: "CONFLICT",
          message: "Draft changed since it was loaded",
          currentEditVersion: 5,
          expectedEditVersion: 4,
        },
      }),
    );
  });
});
