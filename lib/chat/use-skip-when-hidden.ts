"use client";

import { useEffect, useState } from "react";

/**
 * Returns `"skip"` when the document is backgrounded, else `args`. Wrap a
 * Convex `useQuery` arg through this to unsubscribe while the tab is hidden
 * (see news.convex.dev/how-convex-took-down-t3-chat-june-1-2025-postmortem).
 *
 * SSR-safe: the initial state reads `document.visibilityState` only when a
 * document exists; on the server it falls through to `false`.
 */
export function useSkipWhenHidden<T>(args: T): T | "skip" {
  const [hidden, setHidden] = useState(() =>
    typeof document !== "undefined" &&
    document.visibilityState === "hidden",
  );

  useEffect(() => {
    const onChange = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return hidden ? ("skip" as const) : args;
}
