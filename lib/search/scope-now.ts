import { useSearchHistoryStore } from "../store";
import { queryScope, type QueryScope } from "./query-scope";

/**
 * A search's query scope as it is now, from its saved state. A handler awaiting an AI rewrite
 * still sees the render it started in, so it reads the scope here before and after: a rewrite
 * written for one scope is dropped once the search has been switched to another meanwhile, such
 * as keywords that would otherwise be asked as a question by meaning.
 */
export function scopeNow(searchId: string): QueryScope {
  return queryScope(useSearchHistoryStore.getState().getSearchResult(searchId)?.field);
}
