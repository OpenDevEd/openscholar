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
export function SignOut(props: { to: string; end: boolean }) {
  // What the first request decided: where to go, and whether to end the session first. Later renders come from Clerk
  // asking for the page again as the session ends, and say nothing new.
  const [{ to, end }] = useState(props);
  const clerk = useClerk();
  const t = useTranslations();
  const [failed, setFailed] = useState(false);
  const asked = useRef(false);
  const loaded = clerk.loaded;
  const leave = () => window.location.replace(to);
  /**
   * Ends the session, then leaves. Going back as if it had worked would leave the reader signed in here after they
   * asked to sign out, so a sign-out that didn't work stays and offers to try again. Clerk's signOut settles without
   * an error even when its servers never heard it, and forgets the session in this browser either way. So Clerk is
   * asked again who is signed in: only nobody left means it worked.
   */
  const endSession = () => {
    setFailed(false);
    const signedOut = async () => ((await clerk.client?.reload())?.signedInSessions.length ?? 0) === 0;
    clerk
      .signOut(() => undefined)
      .then(signedOut)
      .then((out) => (out ? leave() : setFailed(true)), () => setFailed(true));
  };
  useEffect(() => {
    if (!loaded || asked.current) return;
    asked.current = true;
    // Nothing to end when the community didn't ask from its own page, or nobody is signed in.
    if (!end || !clerk.session) return leave();
    endSession();
    // Once, when Clerk's script has loaded: `asked` holds it to that, whatever else changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  if (failed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">{t("workspaces.signOutFailed")}</p>
        <Button onClick={endSession}>{t("common.retry")}</Button>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen">
      <AuthStatePanel variant="loading" layout="fullscreen" loadingStyle="spinner" />
    </div>
  );
}
