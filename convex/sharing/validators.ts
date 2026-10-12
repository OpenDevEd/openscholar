// The shape of guest access (#653), kept apart from the functions so the schema can read it.

import { v, type Infer } from "convex/values";

/** The kinds of item a guest can be given; each has an entry in ./items.ts. */
export const sharedKinds = ["collection", "screening", "extraction", "search", "author", "chat"] as const;
export const sharedKindValidator = v.union(...sharedKinds.map((kind) => v.literal(kind)));
export type SharedKind = Infer<typeof sharedKindValidator>;

/** What a guest may do with an item: open, read and export it, or change what's in it and run jobs on it too. */
export const guestRoleValidator = v.union(v.literal("viewer"), v.literal("editor"));
export type GuestRole = Infer<typeof guestRoleValidator>;

/**
 * What the two tables below keep besides guests: an Evidence Library's people, under its own
 * two roles. Its editor reviews and publishes, and its creator makes items for review. They are
 * given in the library's settings by rules of its own (../evidenceLibraries/team.ts), so nothing
 * that shares the kinds above takes a library.
 */
export const accessKindValidator = v.union(sharedKindValidator, v.literal("library"));
export type AccessKind = Infer<typeof accessKindValidator>;
export const accessRoleValidator = v.union(guestRoleValidator, v.literal("creator"));
export type AccessRole = Infer<typeof accessRoleValidator>;

/** The workspace a shared item is in, as its guest is told of it: its name, and whether it's an organization's or a person's own. */
export const sharedFromValidator = v.object({ name: v.string(), organization: v.boolean() });

/** Someone outside an item's workspace who may open it: one row a person and item, which stays theirs wherever the item moves. */
export const itemAccessFields = {
  kind: accessKindValidator,
  /** The item's document ID, which no other item of any kind has. */
  item: v.string(),
  /** The item's name, kept as it changes, which "Shared with me" finds and sorts by. */
  name: v.string(),
  userId: v.id("users"),
  role: accessRoleValidator,
  grantedBy: v.id("users"),
  grantedAt: v.number(),
  /** On a chat: when its newest message was sent, kept as it changes, which the person's list of chats orders by. */
  lastMessageAt: v.optional(v.number()),
};

/**
 * What an invitation can be to: what people are given above, and a reader's collection in an
 * Evidence Library (`libraryCollection`, item `<libraryId>:<collectionId>`). The library keeps
 * that collection's members and accepts its invitations on its own page
 * (../evidenceLibraries/collectionInvitations.ts), so nobody is given one here.
 */
export const invitationKindValidator = v.union(accessKindValidator, v.literal("libraryCollection"));
export type InvitationKind = Infer<typeof invitationKindValidator>;

/** An invitation to an item, sent to an address that may have no account yet. */
export const itemInvitationFields = {
  kind: invitationKindValidator,
  item: v.string(),
  email: v.string(),
  role: accessRoleValidator,
  invitedBy: v.id("users"),
  expiresAt: v.number(),
  state: v.union(v.literal("pending"), v.literal("accepted"), v.literal("declined"), v.literal("cancelled"), v.literal("expired")),
  delivery: v.union(v.literal("queued"), v.literal("sent"), v.literal("failed")),
  /** On one to a library's collection, which OpenScholar can't read: the collection's name as the library gave it, for the email. */
  name: v.optional(v.string()),
  /** On one to a library's collection: who accepted it, so accepting again answers the same. */
  acceptedBy: v.optional(v.id("users")),
};
