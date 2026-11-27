"use client";

// What is open over a page, kept in its address: opening it is a step in the browser's history, and so is each tab or
// choice made inside it, so Back undoes them one at a time and then closes it. Closing it from the page goes back over
// all of its steps at once, so Back afterwards goes where it went before it opened. Opened from a link, or with
// something else in the address changed while open (a filter picked in a sheet), it closes by taking itself out of the
// address in place, so nothing chosen in it is undone.
import { useRef } from "react";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";

/** An address less what is open over it and what belongs to that: the same while nothing else in it has changed. */
const without = (href: string, keys: string[]) => {
  const url = new URL(href, window.location.origin);
  for (const key of keys) url.searchParams.delete(key);
  url.searchParams.sort();
  return `${url.pathname}?${url.searchParams}`;
};

type Entry = { key: string; index: number; url: string | null };
type Navigation = { currentEntry: Entry | null; entries: () => Entry[] };
// The browser's list of this tab's history entries (the Navigation API), which says how many steps back the page under
// it is, whether it was opened from here, by Forward, or before a reload. A replace keeps an entry's key.
const navigation = () => (window as Window & { navigation?: Navigation }).navigation;

export function useOpenInAddress<T extends string>(key: string, values: readonly T[] | null, { inner = [] }: { /** What it keeps in the address while open, such as a dialog's tab: its steps, gone when it closes. */ inner?: string[] } = {}) {
  const [state, setState] = useQueryStates({ [key]: values ? parseAsStringLiteral(values) : parseAsString, ...Object.fromEntries(inner.map((one) => [one, parseAsString])) }, { history: "push", scroll: false });
  const open = (state[key] ?? null) as T | null;
  const own = [key, ...inner];
  // Where the browser has no Navigation API: the address this page opened it over.
  const openedOver = useRef<string | null>(null);
  /** How many steps back the page under it is, where every step since it opened is its own; else none, and it closes in place. */
  const stepsBack = () => {
    const list = navigation();
    const current = list?.currentEntry;
    // Without it, only a single step is known for sure: one with nothing of its own set beyond being open. After a tab or a choice inside it, it closes in place rather than guess how far back the page is.
    if (!list || !current) return openedOver.current === without(window.location.href, own) && inner.every((one) => !new URL(window.location.href).searchParams.has(one)) ? 1 : 0;
    const entries = list.entries();
    const under = without(window.location.href, own);
    // Back from here, the first entry without it open is the page it was opened over.
    for (let at = current.index - 1; at >= 0; at--) {
      const entry = entries[at];
      if (!entry?.url) return 0;
      const url = new URL(entry.url);
      if (without(entry.url, own) !== under) return 0;
      if (!url.searchParams.has(key)) return current.index - at;
    }
    return 0;
  };
  const set = (next: T | null, { inPlace = false }: { /** Closed where something else takes its step in the history (a paper picked from it, a link followed), not by stepping back. */ inPlace?: boolean } = {}) => {
    if (next) {
      if (open === null) {
        openedOver.current = without(window.location.href, own);
        void setState({ [key]: next });
      } else void setState({ [key]: next }, { history: "replace" });
    } else if (open !== null) {
      const steps = inPlace ? 0 : stepsBack();
      openedOver.current = null;
      if (steps > 0) window.history.go(-steps);
      else void setState(Object.fromEntries(own.map((one) => [one, null])), { history: "replace" });
    }
  };
  return [open, set] as const;
}

/**
 * How a choice inside something open (a dialog's tab) writes to the history: a step of its own where the browser can
 * say how many steps back the page is, and in place where it can't, so closing is always one step back.
 */
export const innerStep = () => ({ history: navigation() ? ("push" as const) : ("replace" as const) });

/**
 * How a search box writes to the history: starting a search and clearing one are steps, since the list changes in front
 * of the person, and the letters typed in between replace each other. Every list's search box asks this.
 */
export const searchHistory = (was: string, next: string) => ({ history: Boolean(next.trim()) !== Boolean(was.trim()) ? ("push" as const) : ("replace" as const) });

/**
 * Leaves pages that are gone for good (a form already sent, a screening deleted) out of the way back: steps back past
 * every entry at or under `path`, then goes on with `next`, so Back from where it leads returns to the page before
 * them and Forward has nothing left to reopen. `lands` says whether an entry is already the page `next` opens: a
 * push to the address showing is only a replace, which would leave the entries after it, so it steps one further.
 * Where the browser can't say how far back that is, or the entries before were another document's, `next` takes
 * this entry's place instead.
 */
export function leaveBehind(path: string, next: (how: "push" | "replace") => void, lands: (url: URL) => boolean = () => false) {
  const list = navigation() as (Navigation & { currentEntry: Entry & { sameDocument?: boolean } }) | undefined;
  const current = list?.currentEntry;
  const at = (url: string | null) => (url ? new URL(url) : null);
  const under = (url: URL | null) => url !== null && (url.pathname === path || url.pathname.startsWith(`${path}/`));
  if (!list || !current) return next("replace");
  const entries = list.entries() as Array<Entry & { sameDocument?: boolean }>;
  let first = current.index;
  while (first > 0 && under(at(entries[first - 1]?.url ?? null))) first--;
  // The tab began on these pages: back to its first entry, which then takes the next page's place.
  if (first === 0) {
    if (current.index === 0) return next("replace");
    window.addEventListener("popstate", () => next("replace"), { once: true });
    return window.history.go(-current.index);
  }
  let landing = first - 1;
  if (lands(at(entries[landing]!.url)!) && landing > 0) landing--;
  // Entries from before a reload belong to another document: going back to them loads a page, and nothing follows.
  if (entries[landing]!.sameDocument === false) return next("replace");
  window.addEventListener("popstate", () => next("push"), { once: true });
  window.history.go(landing - current.index);
}
