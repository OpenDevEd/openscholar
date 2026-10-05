/**
 * What a call the assistant asks about would do, for the person asked: its arguments, one
 * by one, so they allow the exact change and not just a kind of action. A record an argument
 * names by ID is shown by its name, but only where that person can already see it: a chat
 * they can open, a collection, a saved or removed paper of theirs, an organization they're
 * in, someone in one of their organizations. Any other ID stays an ID, so asking never
 * reveals a name.
 */
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { readMemberOrganizations } from "../organizationFeatures";
import { findSearch } from "../research/records";
import { currentSearch } from "../../lib/research/records";
import { personName, principalsOf, roleAmong } from "./access";
import { ASKED_DETAILS_MAX } from "./validators";

/** A saved search's ID: the one the page made for it. */
const SEARCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Characters of one argument's value. */
const VALUE_MAX = 200;
/** How deep an argument's own fields are listed. */
const DEPTH_MAX = 3;

type Leaf = [path: string[], value: string | number | boolean | null];

/** An argument's name: the last part of its path, without the "Id" that only says it's a reference. */
const nameOf = (path: string[]) => (path.at(-1) ?? "").replace(/Ids?$/, "") || (path.at(-2) ?? "");

/** Every plain value among a call's arguments, with the path to it. One given as null is kept: taking a value off is a change too. */
function plain(value: unknown, path: string[] = []): Leaf[] {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [[path, value]];
  if (typeof value !== "object" || path.length >= DEPTH_MAX) return [];
  return Object.entries(value).flatMap(([key, inner]) => plain(inner, Array.isArray(value) ? path : [...path, key]));
}

export async function detailsOf(ctx: QueryCtx, reader: Doc<"users">, input: string): Promise<Array<{ name: string; value: string }>> {
  let args: unknown;
  try {
    args = JSON.parse(input);
  } catch {
    // Arguments too long to keep whole were refused before they could be asked about.
    return [];
  }
  const mine = await readMemberOrganizations(ctx, reader);
  /** The name of the record an ID names, when the reader can already see it. */
  const named = async (id: string): Promise<string | null> => {
    // A saved search has the ID its page gave it, not a document's. It is the reader's own or it isn't found.
    if (SEARCH_ID.test(id)) {
      const search = await findSearch(ctx, reader._id, id);
      return search ? currentSearch(search.data).query || null : null;
    }
    const threadId = ctx.db.normalizeId("assistantThreads", id);
    if (threadId) return (await roleAmong(ctx, threadId, await principalsOf(ctx, reader))) ? ((await ctx.db.get("assistantThreads", threadId))?.title ?? null) : null;
    const collectionId = ctx.db.normalizeId("collections", id);
    if (collectionId) {
      const collection = await ctx.db.get("collections", collectionId);
      return collection?.userId === reader._id ? collection.name : null;
    }
    const itemId = ctx.db.normalizeId("libraryItems", id);
    if (itemId) {
      const item = await ctx.db.get("libraryItems", itemId);
      return item?.userId === reader._id ? item.title : null;
    }
    const removalId = ctx.db.normalizeId("libraryRemovals", id);
    if (removalId) {
      const removal = await ctx.db.get("libraryRemovals", removalId);
      return removal?.userId === reader._id ? removal.item.title : null;
    }
    const organizationId = ctx.db.normalizeId("organizations", id);
    if (organizationId) return mine.find(({ organization }) => organization._id === organizationId)?.organization.name ?? null;
    const userId = ctx.db.normalizeId("users", id);
    if (userId) {
      const person = await ctx.db.get("users", userId);
      if (!person) return null;
      const shared = person._id === reader._id || (await readMemberOrganizations(ctx, person)).some(({ organization }) => mine.some((own) => own.organization._id === organization._id));
      return shared ? personName(person) || person.email : null;
    }
    const modelId = ctx.db.normalizeId("models", id);
    // The model catalog is the same for everyone.
    return modelId ? ((await ctx.db.get("models", modelId))?.name ?? null) : null;
  };
  // The call's own arguments come before the fields inside them, so what it acts on and what
  // it changes are shown even when a paper it carries has more fields than fit.
  const leaves = plain(args).sort(([a], [b]) => a.length - b.length);
  const details: Array<{ name: string; value: string }> = [];
  for (const [path, value] of leaves.slice(0, ASKED_DETAILS_MAX)) {
    // A name that can't be read, such as someone in more organizations than are read at once, stays an ID.
    const shown = typeof value === "string" ? ((await named(value).catch(() => null)) ?? value) : String(value);
    details.push({ name: nameOf(path), value: shown.length > VALUE_MAX ? `${shown.slice(0, VALUE_MAX)}…` : shown });
  }
  return details;
}
