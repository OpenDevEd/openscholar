import { describe, expect, it } from "vitest";
import { ConfigurationAssemblyError } from "../../lib/evidence-libraries/configuration/assembly";
import { zoteroSourceEntry, zoteroSourceKey } from "./sourceEntry";
import { createSourceCredentials } from "../evidenceLibraries/sourceCredentials";

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

describe("createSourceCredentials", () => {
  it("adds each group's key and keeps write back only when the key can write", () => {
    const apply = createSourceCredentials(groups, {});
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
    const apply = createSourceCredentials(groups, {});
    expect(() =>
      apply([zoteroSourceEntry("42"), zoteroSourceEntry("99")]),
    ).toThrow(ConfigurationAssemblyError);
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

  it("uses the selected OpenAlex key without enabling writeback", () => {
    const apply = createSourceCredentials(groups, {
      custom: "custom-openalex-key",
      platform: "platform-openalex-key",
    });
    expect(
      apply([
        {
          key: "openalex-education",
          provider: "openalex",
          enabled: true,
          writebackEnabled: false,
          settings: {
            name: "Education",
            apiKeyMode: "custom",
            approvedQuery: {
              version: "v1",
              approvedAt: "2026-09-24T12:00:00.000Z",
              query: { search: "education" },
            },
            downloadPdfs: false,
          },
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        provider: "openalex",
        apiKey: "custom-openalex-key",
        writebackEnabled: false,
      }),
    ]);
  });

  it("keeps a saved custom key while a source uses platform access", () => {
    const apply = createSourceCredentials(groups, {
      custom: "saved-custom-key",
      platform: "platform-key",
    });
    expect(
      apply([
        {
          key: "openalex-education",
          provider: "openalex",
          settings: { apiKeyMode: "platform" },
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        provider: "openalex",
        apiKey: "platform-key",
      }),
    ]);
  });

  it("blocks OpenAlex assembly when neither platform nor custom access exists", () => {
    const apply = createSourceCredentials(groups, {});
    expect(() =>
      apply([{ key: "openalex-education", provider: "openalex" }]),
    ).toThrow(ConfigurationAssemblyError);
  });
});
