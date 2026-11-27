"use client";

// What is open over a page, kept in its address: opening it is a step in the browser's history, so Back closes it, and
// closing it from the page takes that step back, so Back afterwards goes where it went before it opened. Opened from a
// link or a reload, it closes by taking itself out of the address in place.
import { useRef } from "react";
import { parseAsStringLiteral, useQueryState } from "nuqs";

export function useOpenInAddress<T extends string>(key: string, values: readonly T[]) {
  const [open, setOpen] = useQueryState(key, parseAsStringLiteral(values).withOptions({ history: "push", scroll: false }));
  // Whether this page opened it, so taking the step back lands where the person was.
  const pushed = useRef(false);
  const set = (next: T | null, { inPlace = false }: { /** Closed where something else takes its step in the history (a paper picked from it), not by stepping back. */ inPlace?: boolean } = {}) => {
    if (next) {
      pushed.current = open === null || pushed.current;
      void setOpen(next, open === null ? undefined : { history: "replace" });
    } else if (open !== null) {
      if (pushed.current && !inPlace) {
        pushed.current = false;
        window.history.back();
      } else {
        pushed.current = false;
        void setOpen(null, { history: "replace" });
      }
    }
  };
  return [open, set] as const;
}
