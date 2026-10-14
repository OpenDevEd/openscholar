"use client";

import { useAction } from "convex/react";
import { useQueryState } from "nuqs";
import { api } from "@/convex/_generated/api";
import { ZOTERO_SIGN_IN_ERROR } from "@/convex/zotero/signInReturn";
import { getConvexSiteUrl } from "@/lib/convex-site";

/**
 * Connecting a Zotero account. `start` sends the person to Zotero, which returns them to this
 * page (convex/http.ts); `failed` is set when a sign-in that started here didn't finish, until
 * `dismiss`. `start` throws when the sign-in can't begin.
 */
export function useZoteroSignIn() {
  const startOAuth = useAction(api.zotero.actions.startOAuth);
  const [error, setError] = useQueryState(ZOTERO_SIGN_IN_ERROR);
  const start = async () => {
    const convexSite = getConvexSiteUrl();
    if (!convexSite) throw new Error("No Convex site address to return to");
    const { authorizeUrl } = await startOAuth({
      callbackUrl: `${convexSite}/api/zotero/callback`,
      returnTo: `${window.location.pathname}${window.location.search}`,
    });
    window.location.href = authorizeUrl;
  };
  return { start, failed: error !== null, dismiss: () => void setError(null) };
}
