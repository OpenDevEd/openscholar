/**
 * What a call the assistant asks about would do, for the person asked: its arguments, one
 * by one, so they allow the exact change and not just a kind of action. A record an argument
 * names by ID is shown by its name, but only where that person can already see it: a chat
 * they can open, a collection of theirs, an organization they're in, someone in one of
 * their organizations. Any other ID stays an ID, so asking never reveals a name.
 */
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { readMemberOrganizations } from "../organizationFeatures";
import { personName, principalsOf, roleAmong } from "./access";
import { ASKED_DETAILS_MAX } from "./validators";

/** Characters of one argument's value. */
const VALUE_MAX = 200;
/** How deep an argument's own fields are listed. */
const DEPTH_MAX = 3;

/** An argument's name: the last part of its path, without the "Id" that only says it's a reference. */
const nameOf = (path: string[]) => (path.at(-1) ?? "").replace(/Ids?$/, "") || (path.at(-2) ?? "");

/** Every plain value among a call's arguments, with the path to it. */
function plain(value: unknown, path: string[] = []): Array<[string[], string | number | boolean]> {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [[path, value]];
  if (!value || typeof value !== "object" || path.length >= DEPTH_MAX) return [];
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
    const threadId = ctx.db.normalizeId("assistantThreads", id);
    if (threadId) return (await roleAmong(ctx, threadId, await principalsOf(ctx, reader))) ? ((await ctx.db.get("assistantThreads", threadId))?.title ?? null) : null;
    const collectionId = ctx.db.normalizeId("collections", id);
    if (collectionId) {
      const collection = await ctx.db.get("collections", collectionId);
      return collection?.userId === reader._id ? collection.name : null;
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
  const details: Array<{ name: string; value: string }> = [];
  for (const [path, value] of plain(args).slice(0, ASKED_DETAILS_MAX)) {
    const shown = typeof value === "string" ? ((await named(value)) ?? value) : String(value);
    details.push({ name: nameOf(path), value: shown.length > VALUE_MAX ? `${shown.slice(0, VALUE_MAX)}…` : shown });
  }
  return details;
}
