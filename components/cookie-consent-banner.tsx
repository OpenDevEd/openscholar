"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Cookie, Settings2 } from "@/components/icons";
import posthog from "posthog-js";
import { useConvexAuth, useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { applyConsentToPostHog, CONSENT_UPDATED_EVENT, readConsent, writeConsent } from "@/lib/consent-cookie";
import { PolicyLinks } from "@/components/legal-links";
import { api } from "@/convex/_generated/api";
import { subtleSpring } from "@/lib/animation-config";
import { cn } from "@/lib/utils";

const cookieButtonClass =
  "min-h-10 sm:min-h-9 flex-1 sm:flex-initial bg-primary text-primary-foreground shadow-xs hover:bg-primary/90";

function ConsentDialogContent({
  onAccept,
  onReject,
  onNavigate,
}: {
  onAccept: () => void;
  onReject: () => void;
  onNavigate: () => void;
}) {
  const t = useTranslations("cookieConsent");

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("dialogDescription")}</p>

      <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3">
        <Button
          variant="default"
          size="default"
          onClick={onReject}
          className={cookieButtonClass}
        >
          {t("rejectNonEssential")}
        </Button>
        <Button
          variant="default"
          size="default"
          onClick={onAccept}
          className={cookieButtonClass}
        >
          {t("acceptAll")}
        </Button>
      </div>

      <PolicyLinks className="text-xs text-muted-foreground" onNavigate={onNavigate} />
    </div>
  );
}

export function CookieConsentBanner() {
  const t = useTranslations("cookieConsent");
  const [showBanner, setShowBanner] = useState(false);
  const [showPreferencesDialog, setShowPreferencesDialog] = useState(false);
  const [mounted, setMounted] = useState(false);

  const isChromeless = (() => {
    if (typeof window === "undefined") return false;
    const pathname = window.location.pathname;
    if (pathname.startsWith("/connect")) return true;
    if (pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up")) {
      const redirect = new URLSearchParams(window.location.search).get("redirect_url") ?? "";
      return redirect.startsWith("/connect");
    }
    return false;
  })();

  const shouldShowBanner = useCallback(() => {
    if (typeof window === "undefined") return false;
    // Nothing to consent to where PostHog didn't start (instrumentation-client.ts).
    if (!posthog.__loaded) return false;
    return !readConsent();
  }, []);

  const handleAccept = useCallback(() => {
    applyConsentToPostHog(posthog, writeConsent("granted").choice);
    setShowBanner(false);
    setShowPreferencesDialog(false);
  }, []);

  const handleReject = useCallback(() => {
    applyConsentToPostHog(posthog, writeConsent("denied").choice);
    setShowBanner(false);
    setShowPreferencesDialog(false);
  }, []);

  // The server's own analytics read the answer from the account, so every change goes there: a button here, or an
  // answer given on openscholar.ai in another tab (instrumentation-client.ts). Someone signed out brings theirs when
  // they sign in.
  const { isAuthenticated } = useConvexAuth();
  const saveConsent = useMutation(api.users.mutations.saveAnalyticsConsent);
  useEffect(() => {
    if (!isAuthenticated) return;
    const save = () => {
      const choice = readConsent()?.choice;
      if (choice) saveConsent({ choice }).catch((error) => console.error("[consent] saving to the account failed", error));
    };
    window.addEventListener(CONSENT_UPDATED_EVENT, save);
    return () => window.removeEventListener(CONSENT_UPDATED_EVENT, save);
  }, [isAuthenticated, saveConsent]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // An answer given in another tab, on openscholar.ai or on a community, reaches this one as a consent update
  // (instrumentation-client.ts), and the banner goes with it.
  useEffect(() => {
    if (!mounted) return;
    const update = () => setShowBanner(shouldShowBanner());
    update();
    window.addEventListener(CONSENT_UPDATED_EVENT, update);
    return () => window.removeEventListener(CONSENT_UPDATED_EVENT, update);
  }, [mounted, shouldShowBanner]);

  useEffect(() => {
    const handler = () => setShowPreferencesDialog(true);
    window.addEventListener(COOKIE_PREFERENCES_EVENT, handler);
    return () => window.removeEventListener(COOKIE_PREFERENCES_EVENT, handler);
  }, []);

  // Hide on chromeless routes
  if (isChromeless) return null;

  return (
    <>
      <AnimatePresence>
        {showBanner && !showPreferencesDialog && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={subtleSpring}
            className={cn(
              "fixed bottom-0 start-0 end-0 z-[100]",
              "pb-[max(1rem,env(safe-area-inset-bottom))]",
              "px-4 sm:px-6 pt-4 sm:pt-5",
              "bg-card border-t border-border shadow-lg",
              "rounded-t-xl sm:rounded-t-2xl"
            )}
          >
            <div className="max-w-3xl mx-auto">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Cookie className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-foreground mb-1">
                      {t("bannerTitle")}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {t("bannerDescription")}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 flex-shrink-0">
                  <Button
                    variant="default"
                    size="default"
                    onClick={handleReject}
                    className={cookieButtonClass}
                  >
                    {t("rejectNonEssential")}
                  </Button>
                  <Button
                    variant="default"
                    size="default"
                    onClick={handleAccept}
                    className={cookieButtonClass}
                  >
                    {t("acceptAll")}
                  </Button>
                </div>
              </div>
              <div className="mt-3 sm:mt-4 pt-3 border-t border-border">
                <PolicyLinks className="text-xs text-muted-foreground" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={showPreferencesDialog} onOpenChange={setShowPreferencesDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("preferencesTitle")}</DialogTitle>
            <DialogDescription>{t("preferencesDescription")}</DialogDescription>
          </DialogHeader>
          <ConsentDialogContent
            onAccept={handleAccept}
            onReject={handleReject}
            onNavigate={() => setShowPreferencesDialog(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

const COOKIE_PREFERENCES_EVENT = "openscholar-open-cookie-preferences";

export function CookiePreferencesTrigger() {
  const t = useTranslations("footer");
  const handleClick = () => {
    window.dispatchEvent(new CustomEvent(COOKIE_PREFERENCES_EVENT));
  };

  // Always there, so the footer's other links don't move once the page has read the decision.
  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
        "hover:text-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md"
      )}
      aria-label={t("cookiePreferences")}
    >
      <Settings2 className="h-3.5 w-3.5" />
      {t("cookiePreferences")}
    </button>
  );
}
