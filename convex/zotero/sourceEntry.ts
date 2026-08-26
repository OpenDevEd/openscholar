// The draft shape of one connected Zotero group. Shared by the page and the
// deploy pipeline; it never carries the key, which is added at deploy time.
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

export function zoteroSourceEntry(groupId: string): ZoteroSourceEntry {
  return {
    key: zoteroSourceKey(groupId),
    provider: "zotero",
    groupId,
    enabled: true,
    writebackEnabled: false,
  };
}
