"use client";

// A person's own Zenodo account (#1237), as every page that offers it reads it: connected through Zenodo's sign-in
// (convex/zenodo), and seen on every open page the moment it is connected, through Convex.

import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";

/** The account connected: the name Zenodo knows the person by, when connected, and whether Zenodo still accepts it. */
export type ZenodoAccount = { name: string | null; zenodoUserId: string | null; connectedAt: number; broken: boolean };

/** The account connected, null when none is, and undefined until it is known (or signed out). */
export function useZenodoAccount(): ZenodoAccount | null | undefined {
  return useProtectedQuery(api.zenodo.connection.mine, {}).data;
}

/**
 * Sends the person to Zenodo's sign-in, and back to `back` (a path on this app) afterwards. `window` opens it in a
 * small window of its own, so a page half filled in (the agreement step) stays as it is: the connection reaches the
 * page through Convex the moment it is made. A browser that blocks the window goes there in the page instead.
 */
export function useConnectZenodo() {
  const start = useAction(api.zenodo.connectionActions.start);
  return async (back: string, { window: own = false } = {}) => {
    // Opened at once, while the click still lets it open, and sent on once Zenodo's address is known.
    const width = 520, height = 720;
    const opened = own ? window.open("about:blank", "zenodo-connect", `popup,width=${width},height=${height},left=${Math.round(screenX + (outerWidth - width) / 2)},top=${Math.round(screenY + (outerHeight - height) / 2)}`) : null;
    try {
      const url = await start({ returnTo: opened ? "/settings/connections/zenodo/done" : back });
      if (opened) opened.location.href = url;
      else window.location.assign(url);
    } catch (error) {
      opened?.close();
      throw error;
    }
  };
}
