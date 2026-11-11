"use client";

import { useEffect, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { Button } from "@/components/ui/button";

/**
 * Signs out of Openscholar, then goes to `to`. Clerk is the outside system: it ends the session on its servers and
 * clears its cookies, and only its script in this browser can ask it to. The root layout draws this page alone, so it
 * always leaves by loading the next page whole, never through the router, which would keep that bare layout.
 */
export function SignOut({ to }: { to: string }) {
  const clerk = useClerk();
  const t = useTranslations();
  const [failed, setFailed] = useState(false);
  const loaded = clerk.loaded;
  useEffect(() => {
    if (!loaded || failed) return;
    const leave = () => window.location.replace(to);
    // With nobody signed in there is nothing to end.
    if (!clerk.session) return leave();
    // Going back as if it had worked would leave the reader signed in here after they asked to sign out: they try again.
    clerk.signOut(leave).catch(() => setFailed(true));
  }, [clerk, loaded, to, failed]);
  if (failed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">{t("workspaces.signOutFailed")}</p>
        <Button onClick={() => setFailed(false)}>{t("common.retry")}</Button>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen">
      <AuthStatePanel variant="loading" layout="fullscreen" loadingStyle="spinner" />
    </div>
  );
}
