/**
 * What a call the assistant asks about would do, for the person asked: its arguments, one
 * by one, so they allow the exact change and not just a kind of action. A record an argument
 * names by ID is shown by its name, but only where that person can already see it: a chat
 * they can open, a collection, a saved or removed paper of theirs, a screening or an
 * extraction of theirs, an organization they're in, someone in one of their organizations.
 * Any other ID stays an ID, so asking never reveals a name.
 */
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { readMemberOrganizations } from "../organizationFeatures";
import { findSearch } from "../research/records";
import { currentSearch } from "../../lib/research/records";
import { personName, principalsOf, roleAmong } from "./access";
import { workUrl } from "../../lib/openalex/work-id";
import { ASKED_DETAILS_MAX, ASKED_EACH_DETAILS_MAX, ASKED_EACH_MAX } from "./validators";

/** A saved search's ID: the one the page made for it. */
const SEARCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Arguments that name a paper by its OpenAlex ID. */
const PAPER_KEYS = new Set(["id", "openalexId", "paperId"]);
/** What a `kind` beside a record's ID says when it only names the sort of record, which the record's own line already does. */
const REFERENCE_KINDS = new Set(["user", "organization"]);
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
  const named = async (id: string, key: string): Promise<string | null> => {
    // A saved search has the ID its page gave it, not a document's. It is the reader's own or it isn't found.
    if (SEARCH_ID.test(id)) {
      const search = await findSearch(ctx, reader._id, id);
      // One saved with filters alone has no query to show: it is named as such, never by its ID.
      return search ? currentSearch(search.data).query : null;
    }
    // A paper by its OpenAlex ID is shown by its title when it's one the reader has saved. Only where the
    // argument is a paper's ID: a name or a title that reads like one is shown as it was typed.
    const work = PAPER_KEYS.has(key) ? workUrl(id) : null;
    if (work) return (await ctx.db.query("libraryItems").withIndex("by_user_openalexId", (q) => q.eq("userId", reader._id).eq("openalexId", work)).first())?.title ?? null;
    const threadId = ctx.db.normalizeId("assistantThreads", id);
    if (threadId) return (await roleAmong(ctx, threadId, await principalsOf(ctx, reader))) ? ((await ctx.db.get("assistantThreads", threadId))?.title ?? null) : null;
    // A change the assistant made, which undoing one names by its step: how many changes it was and what they were about, to someone who reads its chat.
    // Only where the argument is that change: a title that reads like a step's ID is shown as it was typed.
    const stepId = key === "change" ? ctx.db.normalizeId("assistantSteps", id) : null;
    if (stepId) {
      const step = await ctx.db.get("assistantSteps", stepId);
      return step && (await roleAmong(ctx, step.threadId, await principalsOf(ctx, reader))) ? [step.count ?? step.batch, step.subject].filter((part) => part !== undefined).join(", ") : null;
    }
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
    const screeningId = ctx.db.normalizeId("screeningJobs", id);
    if (screeningId) {
      const job = await ctx.db.get("screeningJobs", screeningId);
      return job?.userId === reader._id ? job.label || null : null;
    }
    const extractionId = ctx.db.normalizeId("extractionJobs", id);
    if (extractionId) {
      const job = await ctx.db.get("extractionJobs", extractionId);
      return job?.userId === reader._id ? job.name || null : null;
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
  // `expect` is what an undo passes so that it leaves alone a record changed since: it says what the record is now, not what the call does.
  const leaves = plain(args).filter(([path]) => path[0] !== "expect").sort(([a], [b]) => a.length - b.length);
  const details: Array<{ name: string; value: string; record: boolean; within: string; key: string }> = [];
  for (const [path, value] of leaves.slice(0, ASKED_DETAILS_MAX)) {
    // A name that can't be read, such as someone in more organizations than are read at once, stays an ID.
    const record = typeof value === "string" ? await named(value, path.at(-1) ?? "").catch(() => null) : null;
    const shown = record ?? String(value);
    // A saved paper is shown by its title, so that is what its line is called, not the ID the call gave.
    const title = record !== null && typeof value === "string" && PAPER_KEYS.has(path.at(-1) ?? "") && workUrl(value) !== null;
    details.push({ name: title ? "title" : nameOf(path), value: shown.length > VALUE_MAX ? `${shown.slice(0, VALUE_MAX)}…` : shown, record: record !== null, within: path.slice(0, -1).join("."), key: path.at(-1) ?? "" });
  }
  // Which kind of thing an ID beside it names ("user", "organization") is said by the record's own line.
  // Any other `kind` says what the call does, and stays.
  const told = new Set(details.flatMap((detail) => (detail.record ? [detail.within] : [])));
  // A call can name a record by its ID and again by the name it expects it to have, so that it
  // fails on one renamed since. The record's own name says both, so the typed one isn't
  // repeated. Two records with one name, a chat and the organization it's shared with, are both said.
  const records = new Set(details.flatMap((detail) => (detail.record ? [detail.value] : [])));
  return details.flatMap(({ record, within, key, ...detail }) => ((record || !records.has(detail.value)) && !(key === "kind" && told.has(within) && REFERENCE_KINDS.has(detail.value)) ? [detail] : []));
}

/**
 * What a bulk change the assistant asks about would do (./steps.ts `BULK`): what every one of
 * its changes is given alike, as `detailsOf` says it, then the first of its changes, each as
 * what it alone is given: the record it's made to, and what it gives that record.
 */
export async function bulkOf(ctx: QueryCtx, reader: Doc<"users">, { input, shown }: { input: string; shown?: string }) {
  let each: Record<string, unknown>[];
  try {
    // One over a set of papers says what it shows: what its changes share, and the first papers by title, which the reader may not have saved yet.
    if (shown) {
      const said = JSON.parse(shown) as { shared: Record<string, unknown>; each: string[] };
      return { details: await detailsOf(ctx, reader, JSON.stringify(said.shared)), each: said.each.slice(0, ASKED_EACH_MAX).map((title) => [{ name: "title", value: title }]) };
    }
    each = JSON.parse(input) as Record<string, unknown>[];
  } catch {
    // A list too long to keep whole was refused before it could be asked about.
    return { details: [], each: [] };
  }
  const [first = {}] = each;
  const shared = Object.fromEntries(Object.entries(first).filter(([key, value]) => each.length > 1 && each.every((item) => JSON.stringify(item[key]) === JSON.stringify(value))));
  const own = (item: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(item).filter(([key]) => !(key in shared))));
  const changes = await Promise.all(each.slice(0, ASKED_EACH_MAX).map(async (item) => (await detailsOf(ctx, reader, own(item))).slice(0, ASKED_EACH_DETAILS_MAX)));
  return { details: await detailsOf(ctx, reader, JSON.stringify(shared)), each: changes };
}
