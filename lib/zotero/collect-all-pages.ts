/**
 * Drives SWR-infinite's `setSize` in a loop until the server reports no
 * more pages, the caller's cap is reached, or the user cancels. Zotero's
 * REST API is strictly cursor-paginated — there's no "fetch everything"
 * endpoint — so "select all across pages" is the 20-ish sequential
 * requests this loop issues. Keeping it as a pure function (no React,
 * no SWR, no Convex) makes it unit-testable in isolation.
 */

export type PageLike<Item> = {
  items: Item[];
  hasMore: boolean;
};

export type CollectAllPagesOptions<Page extends PageLike<unknown>> = {
  initialPages: Page[];
  /**
   * Fetch the next page batch. Mirrors `SWRInfinite.setSize(n)` — returns
   * the new full page array (cumulative, not just the appended page).
   * `undefined` is treated as a hard stop.
   */
  fetchNext: (size: number) => Promise<Page[] | undefined>;
  cap: number;
  isCancelled: () => boolean;
};

export type CollectAllPagesResult<Page extends PageLike<unknown>> = {
  pages: Page[];
  /** Server still has more results, but we stopped because we hit `cap`. */
  truncated: boolean;
  /** `isCancelled()` returned true during the loop. */
  cancelled: boolean;
};

export async function collectAllPages<Item, Page extends PageLike<Item>>(
  opts: CollectAllPagesOptions<Page>,
): Promise<CollectAllPagesResult<Page>> {
  let pages: Page[] = [...opts.initialPages];
  let collected = pages.reduce((n, p) => n + p.items.length, 0);
  let last = pages[pages.length - 1];

  while (
    !opts.isCancelled() &&
    last?.hasMore === true &&
    collected < opts.cap
  ) {
    const next = await opts.fetchNext(pages.length + 1);
    if (!next || next.length <= pages.length) break;
    pages = next;
    collected = pages.reduce((n, p) => n + p.items.length, 0);
    last = pages[pages.length - 1];
  }

  const cancelled = opts.isCancelled();
  const truncated =
    !cancelled && last?.hasMore === true && collected >= opts.cap;

  return { pages, truncated, cancelled };
}
