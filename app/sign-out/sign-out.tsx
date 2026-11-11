"use client";

import { useEffect } from "react";
import { useClerk } from "@clerk/nextjs";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";

/**
 * Signs out of Openscholar, then goes to `to`. Clerk is the outside system: it ends the session on its servers and
 * clears its cookies, and only its script in this browser can ask it to. The root layout draws this page alone, so it
 * always leaves by loading the next page whole, never through the router, which would keep that bare layout.
 */
export function SignOut({ to }: { to: string }) {
  const clerk = useClerk();
  const loaded = clerk.loaded;
  useEffect(() => {
    if (!loaded) return;
    const leave = () => window.location.replace(to);
    // With nobody signed in there is nothing to end.
    if (!clerk.session) return leave();
    // A sign-out that fails still leaves: the community that sent its reader here has already signed them out.
    clerk.signOut(leave).catch(leave);
  }, [clerk, loaded, to]);
  return (
    <div className="flex min-h-screen">
      <AuthStatePanel variant="loading" layout="fullscreen" loadingStyle="spinner" />
    </div>
  );
}
