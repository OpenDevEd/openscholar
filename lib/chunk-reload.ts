"use client";

import { useEffect, useState } from "react";

const RELOADED_AT = "chunk-reload-at";
/** A chunk still missing this soon after a reload won't arrive by reloading again. */
export const RELOAD_GUARD_MS = 60_000;

/** A deploy removes the chunks an open tab still names, and Turbopack's runtime names the error this. */
const isChunkFailure = (error: unknown) => error instanceof Error && error.name === "ChunkLoadError";

/** Whether this error should reload the page: a missing chunk, online, with no reload just tried in this tab. */
export function reloadDue(error: unknown, online: boolean, lastReload: string | null, now: number) {
  return isChunkFailure(error) && online && now - Number(lastReload) >= RELOAD_GUARD_MS;
}

function storedReload() {
  try {
    return sessionStorage.getItem(RELOADED_AT);
  } catch {
    return String(Date.now());
  }
}

function rememberReload() {
  try {
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/**
 * For an error page. A missing chunk reloads the page once, and the page draws nothing until the
 * browser leaves it. `retry` reloads for a missing chunk too when online, since `reset` would only
 * fail on the same chunk.
 */
export function useChunkReload(error: unknown, reset: () => void) {
  const [reloading, setReloading] = useState(() => typeof window !== "undefined" && reloadDue(error, navigator.onLine, storedReload(), Date.now()));

  // The browser's reload is the outside system. One that can't be remembered could repeat forever, so it doesn't happen.
  useEffect(() => {
    if (!reloading) return;
    if (rememberReload()) window.location.reload();
    else setReloading(false);
  }, [reloading]);

  const retry = () => {
    if (!isChunkFailure(error) || !navigator.onLine) return reset();
    rememberReload();
    window.location.reload();
  };

  return { reloading, retry };
}
