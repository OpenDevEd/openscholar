import { describe, expect, it } from "vitest";
import { parseZoteroKeyAccess } from "./groupAccess";

describe("parseZoteroKeyAccess", () => {
  it("reads the group entry when the key names the group", () => {
    expect(
      parseZoteroKeyAccess(
        {
          key: "abc",
          userID: 1,
          access: {
            user: { library: true, write: true },
            groups: { all: { library: true, write: false }, "42": { library: true, write: true } },
          },
        },
        "42",
      ),
    ).toEqual({ read: true, write: true });
  });

  it("falls back to the all-groups entry", () => {
    expect(
      parseZoteroKeyAccess(
        { access: { groups: { all: { library: true, write: false } } } },
        "42",
      ),
    ).toEqual({ read: true, write: false });
  });

  it("grants nothing when the key has no group access", () => {
    expect(
      parseZoteroKeyAccess({ access: { user: { library: true, write: true } } }, "42"),
    ).toEqual({ read: false, write: false });
    expect(parseZoteroKeyAccess(null, "42")).toEqual({ read: false, write: false });
  });
});
