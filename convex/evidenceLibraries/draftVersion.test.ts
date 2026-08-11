import { describe, expect, test } from "vitest";

import { nextDraftEditVersion } from "./draftVersion";

describe("nextDraftEditVersion", () => {
  test("increments a draft when the expected edit version matches", () => {
    expect(nextDraftEditVersion(4, 4)).toBe(5);
  });
});
