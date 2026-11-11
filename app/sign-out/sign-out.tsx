"use client";

import { useEffect, useRef, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { Button } from "@/components/ui/button";

/**
 * Signs out of Openscholar, then goes to `to`. Clerk is the outside system: it ends the session on its servers and
 * clears its cookies, and only its script in this browser can ask it to. The root layout draws this page alone, so it
 * always leaves by loading the next page whole, never through the router, which would keep that bare layout.
 *
 * Nobody presses anything here: the reader already pressed Sign out in their community, and this page is the rest of
 * that press. So the effect starts it once Clerk's script has loaded, and only once: a sign-out can't be taken back,
 * so there is nothing to clean up, and a second run of the effect must not ask Clerk again.
 */
export function SignOut({ to }: { to: string }) {
  const clerk = useClerk();
  const t = useTranslations();
  const [failed, setFailed] = useState(false);
  const asked = useRef(false);
  const loaded = clerk.loaded;
  useEffect(() => {
    if (!loaded || failed || asked.current) return;
    asked.current = true;
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
        <Button
          onClick={() => {
            asked.current = false;
            setFailed(false);
          }}
        >
          {t("common.retry")}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen">
      <AuthStatePanel variant="loading" layout="fullscreen" loadingStyle="spinner" />
    </div>
  );
}
