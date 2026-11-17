"use client";

// MOCK (#1237): the Zenodo account a person has connected, kept in this browser until the server stores the
// connection. Every page that shows it reads it here, so connecting on one is seen on the others at once.

import { useMemo, useSyncExternalStore } from "react";

const KEY = "mock:zenodo-account";

/** The Zenodo account connected: the name Zenodo knows the person by, and when it was connected. */
export type ZenodoAccount = { name: string; connectedAt: number };

const listeners = new Set<() => void>();

const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

// The browser's storage is the outside system here: another tab connecting is heard through its `storage` event.
const subscribe = (changed: () => void) => {
  listeners.add(changed);
  const heard = (event: StorageEvent) => event.key === KEY && changed();
  addEventListener("storage", heard);
  return () => {
    listeners.delete(changed);
    removeEventListener("storage", heard);
  };
};

/** The account connected, null when none is, and undefined on the server, before the browser has been read. */
export function useZenodoAccount(): ZenodoAccount | null | undefined {
  const raw = useSyncExternalStore(subscribe, read, () => undefined);
  return useMemo(() => (raw === undefined ? undefined : raw ? (JSON.parse(raw) as ZenodoAccount) : null), [raw]);
}

export function setZenodoAccount(account: ZenodoAccount | null) {
  try {
    if (account) localStorage.setItem(KEY, JSON.stringify(account));
    else localStorage.removeItem(KEY);
  } catch {
    // Private windows may refuse storage: the mock then simply stays unconnected.
  }
  for (const changed of listeners) changed();
}

/**
 * Sends the person to connect Zenodo, and back to `back` afterwards. In the real flow this is Zenodo's own sign-in
 * and approval page (OAuth); the mock stands in for it at /mock/zenodo-connect.
 *
 * `window` opens it in a small window of its own instead, so a page half filled in (the agreement step) stays as it
 * is: the connection is heard through the browser's storage the moment it is made. A browser that blocks the window
 * goes there in the page instead.
 */
export function connectZenodo(back: string, { window: own = false } = {}) {
  const url = `/mock/zenodo-connect?back=${encodeURIComponent(back)}`;
  if (own) {
    const width = 480, height = 640;
    const opened = window.open(url, "zenodo-connect", `popup,width=${width},height=${height},left=${Math.round(screenX + (outerWidth - width) / 2)},top=${Math.round(screenY + (outerHeight - height) / 2)}`);
    if (opened) return;
  }
  window.location.assign(url);
}
