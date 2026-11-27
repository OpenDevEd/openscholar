"use client";

// What is open over a page, kept in its address: opening it is a step in the browser's history, so Back closes it, and
// closing it from the page takes that step back, so Back afterwards goes where it went before it opened. Opened from a
// link, or changed something in the address while open (a filter picked in a sheet), it closes by taking itself out of
// the address in place, so nothing chosen in it is undone.
import { useRef } from "react";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";

/** The address as it is, less what is open over it and what belongs to that: the same while nothing else in it has changed. */
const addressWithout = (keys: string[]) => {
  const query = new URLSearchParams(window.location.search);
  for (const key of keys) query.delete(key);
  query.sort();
  return `${window.location.pathname}?${query}`;
};

// The history entries this tab pushed to open something, by the browser's key for each (the Navigation API): Forward
// back onto one, or a reload of it, still closes by stepping back. A replace keeps an entry's key; a push makes a new one.
const PUSHED = "screening:opened";
const entryKey = () => (window as Window & { navigation?: { currentEntry?: { key: string } | null } }).navigation?.currentEntry?.key;
const pushedKeys = (): string[] => {
  try {
    return JSON.parse(sessionStorage.getItem(PUSHED) ?? "[]") as string[];
  } catch {
    return [];
  }
};
const remember = () => {
  const key = entryKey();
  if (!key) return;
  try {
    sessionStorage.setItem(PUSHED, JSON.stringify([...pushedKeys().slice(-49), key]));
  } catch {
    // Without storage, Forward onto an entry closes in place, as a link does.
  }
};

export function useOpenInAddress<T extends string>(key: string, values: readonly T[], { inner = [] }: { /** What it keeps in the address while open, such as a dialog's tab: one step with it, and gone when it closes. */ inner?: string[] } = {}) {
  const [state, setState] = useQueryStates({ [key]: parseAsStringLiteral(values), ...Object.fromEntries(inner.map((one) => [one, parseAsString])) }, { history: "push", scroll: false });
  const open = (state[key] ?? null) as T | null;
  const own = [key, ...inner];
  // The address this page opened it over, where the browser has no Navigation API to say which entry it pushed.
  const openedOver = useRef<string | null>(null);
  const set = (next: T | null, { inPlace = false }: { /** Closed where something else takes its step in the history (a paper picked from it), not by stepping back. */ inPlace?: boolean } = {}) => {
    if (next) {
      if (open === null) {
        openedOver.current = addressWithout(own);
        void setState({ [key]: next }).then(remember);
      } else void setState({ [key]: next }, { history: "replace" });
    } else if (open !== null) {
      const current = entryKey();
      const pushed = current ? pushedKeys().includes(current) : openedOver.current === addressWithout(own);
      openedOver.current = null;
      if (pushed && !inPlace) window.history.back();
      else void setState(Object.fromEntries(own.map((one) => [one, null])), { history: "replace" });
    }
  };
  return [open, set] as const;
}

/**
 * How a search box writes to the history: starting a search and clearing one are steps, since the list changes in front
 * of the person, and the letters typed in between replace each other. Every list's search box asks this.
 */
export const searchHistory = (was: string, next: string) => ({ history: Boolean(next.trim()) !== Boolean(was.trim()) ? ("push" as const) : ("replace" as const) });
