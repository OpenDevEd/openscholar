import {
  type ApplySourceCredentials,
  ConfigurationAssemblyError,
  type SourceEntry,
} from "../../lib/evidence-libraries/configuration/assembly";
import type { ZoteroGroupScopes } from "./groupAccess";

export { type ZoteroSourceEntry, zoteroSourceEntry, zoteroSourceKey } from "./sourceEntry";

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
