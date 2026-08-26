// What a Zotero API key may do with one group, read from `GET /keys/current`.
// The response lists `access.groups.<groupId>` for keys limited to named
// groups and `access.groups.all` for keys that cover every group.
export type ZoteroGroupScopes = { read: boolean; write: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readScopes(entry: unknown): ZoteroGroupScopes | null {
  if (!isRecord(entry)) return null;
  return { read: entry.library === true, write: entry.write === true };
}

export function parseZoteroKeyAccess(
  body: unknown,
  groupId: string,
): ZoteroGroupScopes {
  const groups = isRecord(body) && isRecord(body.access) ? body.access.groups : null;
  if (!isRecord(groups)) return { read: false, write: false };
  return (
    readScopes(groups[groupId]) ??
    readScopes(groups.all) ?? { read: false, write: false }
  );
}
