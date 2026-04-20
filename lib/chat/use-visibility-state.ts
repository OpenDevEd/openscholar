"use client";

import { useEffect, useState } from "react";

export type VisibilityState = "visible" | "hidden";

/**
 * Mirrors `document.visibilityState` into React state. Returns `'visible'` on
 * the server (no document). Primitive behind `useSkipWhenHidden` — prefer this
 * when the raw state is needed directly (e.g., for test assertions or
 * visibility-gated effects).
 */
export function useVisibilityState(): VisibilityState {
  const [state, setState] = useState<VisibilityState>(() =>
    typeof document !== "undefined" && document.visibilityState === "hidden"
      ? "hidden"
      : "visible",
  );

  useEffect(() => {
    const onChange = () =>
      setState(document.visibilityState === "hidden" ? "hidden" : "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return state;
}
