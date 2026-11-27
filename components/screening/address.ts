"use client";

// What is open over a page, kept in its address: opening it is a step in the browser's history, so Back closes it, and
// closing it from the page takes that step back, so Back afterwards goes where it went before it opened. Opened from a
// link or a reload, or changed something in the address while open (a filter picked in a sheet), it closes by taking
// itself out of the address in place, so nothing chosen in it is undone.
import { useRef } from "react";
import { parseAsStringLiteral, useQueryState } from "nuqs";

/** The address as it is, less what is open over it: the same while nothing else in it has changed. */
const addressWithout = (key: string) => {
  const query = new URLSearchParams(window.location.search);
  query.delete(key);
  query.sort();
  return `${window.location.pathname}?${query}`;
};

export function useOpenInAddress<T extends string>(key: string, values: readonly T[]) {
  const [open, setOpen] = useQueryState(key, parseAsStringLiteral(values).withOptions({ history: "push", scroll: false }));
  // The address this page opened it over, so taking the step back lands where the person was, and only then.
  const openedOver = useRef<string | null>(null);
  const set = (next: T | null, { inPlace = false }: { /** Closed where something else takes its step in the history (a paper picked from it), not by stepping back. */ inPlace?: boolean } = {}) => {
    if (next) {
      if (open === null) openedOver.current = addressWithout(key);
      void setOpen(next, open === null ? undefined : { history: "replace" });
    } else if (open !== null) {
      const back = !inPlace && openedOver.current === addressWithout(key);
      openedOver.current = null;
      if (back) window.history.back();
      else void setOpen(null, { history: "replace" });
    }
  };
  return [open, set] as const;
}
