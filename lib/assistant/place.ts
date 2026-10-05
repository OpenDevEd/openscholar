/**
 * Where a tab's assistant panel is: open or folded, and on which chat. It lives in the
 * tab's session storage, so a reload, or a page opened by its address, comes back to the
 * conversation instead of an empty new chat. Another tab starts on its own.
 */
export type Place = { open: boolean; threadId: string | null };
/**
 * What the tab keeps: its place, and the chat link it has followed. A link stays in the
 * address after the person has gone on to another chat, so it opens its chat once in a tab,
 * and from then on the tab's own place stands.
 */
type Kept = Place & { link?: string };

const KEY = "openscholar.assistant.panel";
const FOLDED: Kept = { open: false, threadId: null };

/**
 * The place a page starts at: the chat its address links to (`?chat=`), opened, the first
 * time this tab sees that link; else what the tab kept. Anything else in storage, written
 * by an older version or by hand, is no place.
 */
export function placeFrom(search: string, stored: string | null): Kept {
  const linked = new URLSearchParams(search).get("chat");
  let kept: Kept | null = null;
  try {
    const read: unknown = JSON.parse(stored ?? "null");
    if (read && typeof read === "object") {
      const { open, threadId, link } = read as Record<string, unknown>;
      if (typeof open === "boolean" && (threadId === null || typeof threadId === "string")) kept = { open, threadId, ...(typeof link === "string" ? { link } : {}) };
    }
  } catch {
    // Not JSON: no place.
  }
  if (linked && kept?.link !== linked) return { open: true, threadId: linked, link: linked };
  return kept ?? FOLDED;
}

let place: Kept | undefined;
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
function keep(now: Kept) {
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
  get: (): Place => (place ??= placeFrom(window.location.search, storage()?.getItem(KEY) ?? null)),
  /** The server renders no panel. */
  onServer: (): Place => FOLDED,
  set(update: (now: Place) => Place) {
    const { link } = (place ??= placeFrom(window.location.search, storage()?.getItem(KEY) ?? null));
    place = { ...update(place), ...(link === undefined ? {} : { link }) };
    keep(place);
    for (const listener of listeners) listener();
  },
};
