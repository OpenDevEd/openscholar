import { describe, expect, it } from "vitest";
import { ConfigurationAssemblyError } from "../../lib/evidence-libraries/configuration/assembly";
import {
  createZoteroSourceCredentials,
  zoteroSourceEntry,
  zoteroSourceKey,
} from "./sourceCredentials";

const groups = [
  { groupId: "42", apiKey: "key-42", scopes: { read: true, write: true } },
  { groupId: "77", apiKey: "key-77", scopes: { read: true, write: false } },
];

describe("zoteroSourceEntry", () => {
  it("builds the draft entry without a key", () => {
    expect(zoteroSourceKey("42")).toBe("zotero-42");
    expect(zoteroSourceEntry("42")).toEqual({
      key: "zotero-42",
      provider: "zotero",
      groupId: "42",
      enabled: true,
      writebackEnabled: false,
    });
  });
});

describe("createZoteroSourceCredentials", () => {
  it("adds each group's key and keeps write back only when the key can write", () => {
    const apply = createZoteroSourceCredentials(groups);
    expect(
      apply([
        { ...zoteroSourceEntry("42"), writebackEnabled: true },
        { ...zoteroSourceEntry("77"), writebackEnabled: true, enabled: false },
      ]),
    ).toEqual([
      { ...zoteroSourceEntry("42"), writebackEnabled: true, apiKey: "key-42" },
      {
        ...zoteroSourceEntry("77"),
        writebackEnabled: false,
        enabled: false,
        apiKey: "key-77",
      },
    ]);
  });

  it("reports a source whose group is not connected", () => {
    const apply = createZoteroSourceCredentials(groups);
    expect(() => apply([zoteroSourceEntry("42"), zoteroSourceEntry("99")])).toThrow(
      ConfigurationAssemblyError,
    );
    try {
      apply([zoteroSourceEntry("99")]);
    } catch (error) {
      expect((error as ConfigurationAssemblyError).issues).toEqual([
        {
          pointer: "/sources/0/groupId",
          section: "sources",
          keyword: "notConnected",
          message: "This Zotero group is not connected.",
        },
      ]);
    }
  });
});
