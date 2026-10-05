/**
 * Where a tab's assistant panel is: open or folded, and on which chat. It lives in the
 * tab's session storage, so a reload, or a page opened by its address, comes back to the
 * conversation instead of an empty new chat. Another tab starts on its own.
 */
export type Place = { open: boolean; threadId: string | null };

const KEY = "openscholar.assistant.panel";
const FOLDED: Place = { open: false, threadId: null };

/**
 * The place a page starts at: the chat its address links to (`?chat=`), opened; else what
 * the tab kept. Anything else in storage, written by an older version or by hand, is no place.
 */
export function placeFrom(search: string, stored: string | null): Place {
  const linked = new URLSearchParams(search).get("chat");
  if (linked) return { open: true, threadId: linked };
  try {
    const kept: unknown = JSON.parse(stored ?? "null");
    if (kept && typeof kept === "object") {
      const { open, threadId } = kept as Record<string, unknown>;
      if (typeof open === "boolean" && (threadId === null || typeof threadId === "string")) return { open, threadId };
    }
  } catch {
    // Not JSON: no place.
  }
  return FOLDED;
}

let place: Place | undefined;
const listeners = new Set<() => void>();

/** The tab's storage, which a browser can refuse (blocked, or full). The place then lasts until the page is left. */
function storage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Writes the place to the tab. A browser can refuse: it then lasts until the page is left. */
function keep(now: Place) {
  try {
    storage()?.setItem(KEY, JSON.stringify(now));
  } catch {
    // Kept for this page only.
  }
}

/** The panel's place as an outside store, for `useSyncExternalStore`: read from the tab once a page load, and written back on every change. */
export const panelPlace = {
  subscribe(listener: () => void) {
    // A place that came from a link is the tab's from here on: leaving for a checkout page and coming back finds the chat.
    if (!listeners.size) keep(panelPlace.get());
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  get: () => (place ??= placeFrom(window.location.search, storage()?.getItem(KEY) ?? null)),
  /** The server renders no panel. */
  onServer: () => FOLDED,
  set(update: (now: Place) => Place) {
    place = update(panelPlace.get());
    keep(place);
    for (const listener of listeners) listener();
  },
};
