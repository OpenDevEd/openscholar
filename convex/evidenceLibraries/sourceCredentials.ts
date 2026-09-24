import {
  type ApplySourceCredentials,
  ConfigurationAssemblyError,
  type SourceEntry,
} from "../../lib/evidence-libraries/configuration/assembly";
import type { ZoteroGroupScopes } from "../zotero/groupAccess";

export type ConnectedZoteroGroup = {
  groupId: string;
  apiKey: string;
  scopes: ZoteroGroupScopes;
};

/** Adds provider credentials only during runtime assembly. */
export function createSourceCredentials(
  groups: readonly ConnectedZoteroGroup[],
  openAlexApiKey: string | undefined,
): ApplySourceCredentials {
  const byGroupId = new Map(groups.map((group) => [group.groupId, group]));
  return (sources: readonly SourceEntry[]) =>
    sources.map((source, index) => {
      if (source.provider === "openalex") {
        if (!openAlexApiKey) {
          throw new ConfigurationAssemblyError([
            {
              pointer: `/sources/${index}/apiKey`,
              section: "sources",
              keyword: "credential",
              message: "OpenAlex access is not configured.",
            },
          ]);
        }
        return { ...source, apiKey: openAlexApiKey, writebackEnabled: false };
      }
      if (source.provider !== "zotero" || typeof source.groupId !== "string") {
        throw new ConfigurationAssemblyError([
          {
            pointer: `/sources/${index}/provider`,
            section: "sources",
            keyword: "provider",
            message: "This source provider is not supported.",
          },
        ]);
      }
      const group = byGroupId.get(source.groupId);
      if (!group) {
        throw new ConfigurationAssemblyError([
          {
            pointer: `/sources/${index}/groupId`,
            section: "sources",
            keyword: "notConnected",
            message: "This Zotero group is not connected.",
          },
        ]);
      }
      return {
        ...source,
        apiKey: group.apiKey,
        writebackEnabled:
          source.writebackEnabled === true && group.scopes.write,
      };
    });
}
