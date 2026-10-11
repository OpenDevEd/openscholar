import type { Mention } from "./mentions";

/**
 * Where a tab's assistant panel is: open or folded, and on which chat in each workspace
 * (#651), by its address's organization, "" for the person's own: switching back to one
 * reopens its chat. It lives in the tab's session storage, so a reload, or a page opened by
 * its address, comes back to the conversation instead of an empty new chat. Another tab
 * starts on its own.
 */
export type Place = { open: boolean; threads: Record<string, string> };
/**
 * What the tab keeps: its place, and the chat link it has followed. A link stays in the
 * address after the person has gone on to another chat, so it opens its chat once in a tab,
 * and from then on the tab's own place stands.
 */
type Kept = Place & { link?: string };

const KEY = "openscholar.assistant.panel";
const FOLDED: Kept = { open: false, threads: {} };

/** The workspace a page's address is in, as the panel keeps its chats: an organization's slug, or "" for the person's own. */
export const workspaceKey = (pathname: string) => /^\/o\/([^/]+)/.exec(pathname)?.[1] ?? "";
/** The chat open in a workspace, or none: a new chat. */
export const threadIn = (place: Place, key: string): string | null => place.threads[key] ?? null;
/** The place with a workspace's chat changed; none is a new chat. */
export function withThread<P extends Place>(place: P, key: string, threadId: string | null): P {
  const { [key]: _was, ...others } = place.threads;
  return { ...place, threads: threadId === null ? others : { ...others, [key]: threadId } };
}

/**
 * The place a page starts at: the chat its address links to (`?chat=`), opened in the
 * workspace the page is in (`key`), the first time this tab sees that link; else what the tab
 * kept. Anything else in storage, written by an older version or by hand, is no place.
 */
export function placeFrom(search: string, stored: string | null, key: string): Kept {
  const linked = new URLSearchParams(search).get("chat");
  let kept: Kept | null = null;
  try {
    const read: unknown = JSON.parse(stored ?? "null");
    if (read && typeof read === "object" && !Array.isArray(read)) {
      const { open, threads, link } = read as Record<string, unknown>;
      const chats = threads && typeof threads === "object" && !Array.isArray(threads) && Object.values(threads).every((id) => typeof id === "string") ? (threads as Record<string, string>) : null;
      if (typeof open === "boolean" && chats) kept = { open, threads: chats, ...(typeof link === "string" ? { link } : {}) };
    }
  } catch {
    // Not JSON: no place.
  }
  if (linked && kept?.link !== linked) return { ...withThread(kept ?? FOLDED, key, linked), open: true, link: linked };
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
  get: (): Place => (place ??= placeFrom(window.location.search, storage()?.getItem(KEY) ?? null, workspaceKey(window.location.pathname))),
  /** The server renders no panel. */
  onServer: (): Place => FOLDED,
  set(update: (now: Place) => Place) {
    const { link } = (place ??= placeFrom(window.location.search, storage()?.getItem(KEY) ?? null, workspaceKey(window.location.pathname)));
    place = { ...update(place), ...(link === undefined ? {} : { link }) };
    keep(place);
    for (const listener of listeners) listener();
  },
};

/**
 * A chat to start about a record from elsewhere in the app ("Start chat" on a search): the
 * panel opens on a new chat with the record mentioned in its box. `id` tells one start from
 * the next, so starting about the same search again puts it back.
 */
export type Seed = { id: number; mention: Mention };
let seed: Seed | null = null;
const seedListeners = new Set<() => void>();

export const panelSeed = {
  subscribe(listener: () => void) {
    seedListeners.add(listener);
    return () => void seedListeners.delete(listener);
  },
  get: () => seed,
  onServer: (): Seed | null => null,
};

/** Opens the assistant on a new chat about a record, mentioned in the box for the person's first message. */
export function chatAbout(mention: Mention) {
  seed = { id: (seed?.id ?? 0) + 1, mention };
  for (const listener of seedListeners) listener();
  // A new chat in the workspace the page is in.
  panelPlace.set((now) => ({ ...withThread(now, workspaceKey(window.location.pathname), null), open: true }));
}

/** Opens the assistant on a chat, in the workspace the page is in: what a link to one does when it's followed inside the app, where no page loads to read its address. */
export function openChat(threadId: string) {
  panelPlace.set((now) => ({ ...withThread(now, workspaceKey(window.location.pathname), threadId), open: true }));
}
