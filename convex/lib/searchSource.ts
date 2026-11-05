import type { QueryCtx } from "../_generated/server";
import { SEARCH_SOURCE_FLAG, sourceFromFlag, type SearchSource } from "../../lib/search/source";

/** The source the site's searches read, as a site admin last chose it. */
export async function activeSource(ctx: Pick<QueryCtx, "db">): Promise<SearchSource> {
  const flag = await ctx.db.query("featureFlags").withIndex("by_key", (q) => q.eq("key", SEARCH_SOURCE_FLAG)).unique();
  return sourceFromFlag(flag?.enabled);
}
