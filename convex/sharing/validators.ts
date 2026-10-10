// The shape of guest access (#653), kept apart from the functions so the schema can read it.

import { v, type Infer } from "convex/values";

/** The kinds of item a guest can be given; each has an entry in ./items.ts. */
export const sharedKinds = ["collection", "screening"] as const;
export const sharedKindValidator = v.union(...sharedKinds.map((kind) => v.literal(kind)));
export type SharedKind = Infer<typeof sharedKindValidator>;

/** What a guest may do with an item: open, read and export it, or change what's in it and run jobs on it too. */
export const guestRoleValidator = v.union(v.literal("viewer"), v.literal("editor"));
export type GuestRole = Infer<typeof guestRoleValidator>;

/** The workspace a shared item is in, as its guest is told of it: its name, and whether it's an organization's or a person's own. */
export const sharedFromValidator = v.object({ name: v.string(), organization: v.boolean() });

/** Someone outside an item's workspace who may open it: one row a person and item, which stays theirs wherever the item moves. */
export const itemAccessFields = {
  kind: sharedKindValidator,
  /** The item's document ID, which no other item of any kind has. */
  item: v.string(),
  /** The item's name, kept as it changes, which "Shared with me" finds and sorts by. */
  name: v.string(),
  userId: v.id("users"),
  role: guestRoleValidator,
  grantedBy: v.id("users"),
  grantedAt: v.number(),
};

/** An invitation to an item, sent to an address that may have no account yet. */
export const itemInvitationFields = {
  kind: sharedKindValidator,
  item: v.string(),
  email: v.string(),
  role: guestRoleValidator,
  invitedBy: v.id("users"),
  expiresAt: v.number(),
  state: v.union(v.literal("pending"), v.literal("accepted"), v.literal("declined"), v.literal("cancelled"), v.literal("expired")),
  delivery: v.union(v.literal("queued"), v.literal("sent"), v.literal("failed")),
};
