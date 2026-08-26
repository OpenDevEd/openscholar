import {
  type ApplySourceCredentials,
  ConfigurationAssemblyError,
  type SourceEntry,
} from "../../lib/evidence-libraries/configuration/assembly";
import type { ZoteroGroupScopes } from "./groupAccess";

export type ZoteroSourceEntry = {
  key: string;
  provider: "zotero";
  groupId: string;
  enabled: boolean;
  writebackEnabled: boolean;
};

export function zoteroSourceKey(groupId: string): string {
  return `zotero-${groupId}`;
}

// The draft shape of one connected group. The key is added at deploy time.
export function zoteroSourceEntry(groupId: string): ZoteroSourceEntry {
  return {
    key: zoteroSourceKey(groupId),
    provider: "zotero",
    groupId,
    enabled: true,
    writebackEnabled: false,
  };
}

export type ConnectedZoteroGroup = {
  groupId: string;
  apiKey: string;
  scopes: ZoteroGroupScopes;
};

// Gives every Zotero source the key of the owner who connected its group.
// Write back stays off when that key cannot write to the group.
export function createZoteroSourceCredentials(
  groups: readonly ConnectedZoteroGroup[],
): ApplySourceCredentials {
  const byGroupId = new Map(groups.map((group) => [group.groupId, group]));
  return (sources: readonly SourceEntry[]) => {
    const missing = sources.flatMap((source, index) =>
      typeof source.groupId === "string" && byGroupId.has(source.groupId)
        ? []
        : [
            {
              pointer: `/sources/${index}/groupId`,
              section: "sources" as const,
              keyword: "notConnected",
              message: "This Zotero group is not connected.",
            },
          ],
    );
    if (missing.length > 0) throw new ConfigurationAssemblyError(missing);
    return sources.map((source) => {
      const group = byGroupId.get(source.groupId as string)!;
      return {
        ...source,
        apiKey: group.apiKey,
        writebackEnabled: source.writebackEnabled === true && group.scopes.write,
      };
    });
  };
}
