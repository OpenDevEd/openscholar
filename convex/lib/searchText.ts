/**
 * The text a list's search index matches (#636): saved searches, bookmarks (query shortcuts),
 * extraction jobs and admins. Each write gives a row its text with it; a trigger checks it
 * whichever function writes, and puts right a write that didn't. No Convex functions live
 * here, so the triggers can load it (./triggers.ts).
 */
import type { Change } from "convex-helpers/server/triggers";
import type { DataModel, Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { currentSearch } from "../../lib/research/records";

/**
 * Characters of a row's text its search matches: the row keeps them beside what they're taken
 * from, so a long query or expansion must not double it past Convex's 1 MiB a document.
 */
const SEARCH_TEXT_MAX = 32_000;
const bounded = (text: string) => text.slice(0, SEARCH_TEXT_MAX);

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

type Searched = "searches" | "queryShortcuts" | "extractionJobs" | "admins";

/** Keeps a row's `searchText` equal to `textOf` it. */
export const keepSearchText =
  <T extends Searched>(table: T, textOf: (ctx: QueryCtx, row: Doc<T>) => string | Promise<string>) =>
  async (ctx: MutationCtx, change: Change<DataModel, T>) => {
    const row = change.newDoc;
    if (!row) return;
    const text = await textOf(ctx, row);
    if (row.searchText !== text) await ctx.db.patch(table, row._id, { searchText: text } as never);
  };

/** A user whose name or email changed: their admin row's text follows. */
export async function keepAdminTextOfUser(ctx: MutationCtx, change: Change<DataModel, "users">) {
  const [was, now] = [change.oldDoc, change.newDoc];
  if (!now || (was && was.firstName === now.firstName && was.lastName === now.lastName && was.email === now.email)) return;
  const admin = await ctx.db.query("admins").withIndex("by_userId", (q) => q.eq("userId", now._id)).first();
  if (admin) {
    const text = await adminText(ctx, admin);
    if (admin.searchText !== text) await ctx.db.patch("admins", admin._id, { searchText: text });
  }
}
