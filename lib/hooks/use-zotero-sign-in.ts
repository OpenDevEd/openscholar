"use client";

import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { getConvexSiteUrl } from "@/lib/convex-site";

/**
 * Sends the person to Zotero to connect their account. Zotero returns them to the page
 * they started on (convex/http.ts). Throws when the sign-in can't start.
 */
export function useZoteroSignIn() {
  const startOAuth = useAction(api.zotero.actions.startOAuth);
  return async () => {
    const convexSite = getConvexSiteUrl();
    if (!convexSite) throw new Error("No Convex site address to return to");
    const { authorizeUrl } = await startOAuth({
      callbackUrl: `${convexSite}/api/zotero/callback`,
      returnTo: `${window.location.pathname}${window.location.search}`,
    });
    window.location.href = authorizeUrl;
  };
}
