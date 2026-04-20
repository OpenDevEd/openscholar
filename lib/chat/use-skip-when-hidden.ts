"use client";

import { useVisibilityState } from "./use-visibility-state";

/**
 * Returns `"skip"` when the document is backgrounded, else `args`. Wrap a
 * Convex `useQuery` arg through this to unsubscribe while the tab is hidden
 * (see news.convex.dev/how-convex-took-down-t3-chat-june-1-2025-postmortem).
 *
 * Delegates to `useVisibilityState` — the raw state primitive.
 */
export function useSkipWhenHidden<T>(args: T): T | "skip" {
  return useVisibilityState() === "hidden" ? ("skip" as const) : args;
}
