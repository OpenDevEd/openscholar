// Closing something a page keeps in its address. Opening it added a step to the browser's history, so closing it
// with its own button should take that step back: then Back never reopens what was just closed, and Forward does.
// Whether there is such a step is read from the browser's own history, never remembered by the page, so the
// person's own Back and Forward, a reload and a link from elsewhere all leave it right.

type Entries = { currentEntry?: { index: number } | null; entries(): Array<{ url: string | null }> };

/**
 * Steps back in the browser's history when the entry behind this one is where closing leads (`leadsTo`), and says
 * whether it did. False where there is no such entry, as after a link or a reload, or no Navigation API to ask: the
 * caller then changes the address in place.
 */
export function stepBack(leadsTo: (behind: URL) => boolean): boolean {
  const navigation = (window as { navigation?: Entries }).navigation;
  const at = navigation?.currentEntry?.index ?? 0;
  const behind = at > 0 ? navigation!.entries()[at - 1]?.url : null;
  if (!behind || !leadsTo(new URL(behind))) return false;
  window.history.back();
  return true;
}

const queryOf = (url: URL) => [...url.searchParams].map(([key, value]) => `${key}=${value}`).sort().join("&");

/** Whether `behind` is this page with the query keys in `closed` taken out: what closing them leads to. */
export function withoutKeys(closed: readonly string[]) {
  const target = new URL(window.location.href);
  for (const key of closed) target.searchParams.delete(key);
  return (behind: URL) => behind.origin === target.origin && behind.pathname === target.pathname && queryOf(behind) === queryOf(target);
}
