/**
 * The text a list's search index matches (#636): saved searches, bookmarks (query shortcuts),
 * extraction jobs and admins. Each write gives a row its text with it; a trigger checks it
 * whichever function writes, and puts right a write that didn't. No Convex functions live
 * here, so the triggers can load it (./triggers.ts).
 */
import type { Change } from "convex-helpers/server/triggers";
import type { DataModel, Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { makeFunctionReference } from "convex/server";
import { getDocumentSize } from "convex/values";
import { currentSearch } from "../../lib/research/records";

/**
 * Characters of a row's text its search matches: the row keeps them beside what they're taken
 * from, so a long query or expansion must not double it past Convex's 1 MiB a document.
 */
const SEARCH_TEXT_MAX = 32_000;
const bounded = (text: string) => text.slice(0, SEARCH_TEXT_MAX);
/** What a row with its text may weigh: Convex's 1 MiB a document, less room for its system fields. */
const ROW_BYTES_MAX = 1024 * 1024 - 16 * 1024;

/** `row` with as much of `text` as keeps it within a document's size, however close to it the row already is. */
export function withText<Row extends object>(row: Row, text: string): Row & { searchText: string } {
  const room = ROW_BYTES_MAX - getDocumentSize({ ...row, searchText: "" } as never);
  let kept = room > 0 ? text : "";
  for (let bytes = new TextEncoder().encode(kept).length; bytes > room && kept; bytes = new TextEncoder().encode(kept).length) {
    kept = kept.slice(0, Math.max(0, Math.floor((kept.length * room) / bytes) - 1));
  }
  return { ...row, searchText: kept };
}

/** A saved search's query and questions. */
export const searchText = (data: Doc<"searches">["data"]) => {
  const search = currentSearch(data);
  return bounded(`${search.query}\n${search.questionText}`);
};
/** A bookmark's name and what it expands to. */
export const shortcutText = (data: Doc<"queryShortcuts">["data"]) => bounded(`${data.shorthand}\n${data.expansion}`);
/** An extraction job's name and description. */
export const jobText = (job: { name: string; description?: string }) => bounded(`${job.name}\n${job.description ?? ""}`);
/** An admin's name and email, from their user once they've signed up. */
export async function adminText(ctx: QueryCtx, row: { email: string; userId?: Doc<"admins">["userId"] }) {
  const user = row.userId ? await ctx.db.get("users", row.userId) : null;
  return [user?.firstName, user?.lastName, user?.email ?? row.email].filter(Boolean).join(" ");
}

/** Convex's full text search takes at most 16 terms. */
export const SEARCH_TERMS_MAX = 16;
/** Text a person typed, as a full text search takes it: its first 16 words, or undefined for none. */
export const searchTerms = (text: string | undefined) => text?.trim().split(/\s+/).filter(Boolean).slice(0, SEARCH_TERMS_MAX).join(" ") || undefined;

/** An organization member's name and email, from their user. */
export async function memberText(ctx: QueryCtx, row: { clerkUserId: string }) {
  const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", row.clerkUserId)).unique();
  return [user?.firstName, user?.lastName, user?.email].filter(Boolean).join(" ");
}

type Searched = "searches" | "queryShortcuts" | "extractionJobs" | "admins" | "organizationMemberships";

/** Keeps a row's `searchText` equal to `textOf` it. */
export const keepSearchText =
  <T extends Searched>(table: T, textOf: (ctx: QueryCtx, row: Doc<T>) => string | Promise<string>) =>
  async (ctx: MutationCtx, change: Change<DataModel, T>) => {
    const row = change.newDoc;
    if (!row) return;
    const { _id, _creationTime, searchText: was, ...fields } = row as Doc<T> & { searchText?: string };
    const { searchText: text } = withText(fields, await textOf(ctx, row));
    if (was !== text) await ctx.db.patch(table, row._id, { searchText: text } as never);
  };

/** A user whose name or email changed, or who was deleted: their admin row's and organization memberships' text follows. */
export async function keepTextOfUser(ctx: MutationCtx, change: Change<DataModel, "users">) {
  const [was, now] = [change.oldDoc, change.newDoc];
  if (now && was && was.firstName === now.firstName && was.lastName === now.lastName && was.email === now.email) return;
  const userId = (now ?? was)!._id;
  const admin = await ctx.db.query("admins").withIndex("by_userId", (q) => q.eq("userId", userId)).first();
  if (admin) {
    const text = await adminText(ctx, admin);
    if (admin.searchText !== text) await ctx.db.patch("admins", admin._id, { searchText: text });
  }
  // Every organization the person belongs to, a page at a time after this write (convex/lib/memberText.ts).
  await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation">("lib/memberText:refresh"), { clerkUserId: (now ?? was)!.clerkId, cursor: null });
}
