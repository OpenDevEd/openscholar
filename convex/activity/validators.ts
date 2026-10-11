// The shape of activity rows (#656), kept apart from the functions so the schema can read it.

import { v, type Infer } from "convex/values";

/** The kinds of item that keep activity. */
export const itemKinds = ["collection", "search", "screening", "extraction", "author"] as const;
export const itemKindValidator = v.union(...itemKinds.map((kind) => v.literal(kind)));
export type ItemKind = Infer<typeof itemKindValidator>;

/** What happened to it. */
export const activityKinds = ["created", "renamed", "edited", "added", "removed", "rated", "answered", "screened", "extracted", "paused", "resumed", "retried", "stopped", "moved", "shared"] as const;
export const activityKindValidator = v.union(...activityKinds.map((kind) => v.literal(kind)));

/** One change an entry declares: to which item, what happened, how many papers it took in, and a word about it (a name, a query). */
export const noteValidator = v.object({
  kind: itemKindValidator,
  id: v.string(),
  happened: activityKindValidator,
  count: v.optional(v.number()),
  detail: v.optional(v.string()),
});
export type Note = Infer<typeof noteValidator>;

/** An item as its activity rows name it: its kind and ID in one string, so one index finds them. */
export const itemKey = (kind: ItemKind, id: string) => `${kind}:${id}`;

/** The longest `detail` kept: a query or a name is shown in a chip, not whole. */
export const DETAIL_MAX = 200;

export const activityFields = {
  workspaceId: v.id("workspaces"),
  item: v.string(),
  by: v.id("users"),
  happened: activityKindValidator,
  count: v.optional(v.number()),
  detail: v.optional(v.string()),
  // The assistant made it for `by`.
  viaAssistant: v.optional(v.literal(true)),
};
