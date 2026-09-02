import { v } from "convex/values";

export const zoteroGroupScopesValidator = v.object({
  read: v.boolean(),
  write: v.boolean(),
});

// One Zotero group an owner connected to a library. The owner's key is
// copied into `evidenceLibraryCredentials` under `credentialKey`.
export const evidenceLibraryZoteroGroupFields = {
  libraryId: v.id("evidenceLibraries"),
  groupId: v.string(),
  name: v.string(),
  isPublic: v.boolean(),
  itemCount: v.number(),
  connectedByClerkUserId: v.string(),
  connectedByZoteroUsername: v.optional(v.string()),
  connectedAt: v.number(),
  scopes: zoteroGroupScopesValidator,
  credentialKey: v.string(),
};

export const evidenceLibraryZoteroGroupValidator = v.object({
  _id: v.id("evidenceLibraryZoteroGroups"),
  _creationTime: v.number(),
  ...evidenceLibraryZoteroGroupFields,
});

export function zoteroGroupCredentialKey(groupId: string): string {
  return `zotero-group:${groupId}`;
}
