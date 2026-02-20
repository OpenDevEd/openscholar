"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Cookie, Settings2 } from "lucide-react";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getStoredConsent,
  storeConsent,
  hasConsentDecision,
  CONSENT_UPDATED_EVENT,
} from "@/lib/consent-storage";
import { PolicyLinks } from "@/components/legal-links";
import { subtleSpring } from "@/lib/animation-config";
import { cn } from "@/lib/utils";

function ConsentDialogContent({
  onAccept,
  onReject,
}: {
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        We use analytics cookies to understand how you use OpenScholar and
        improve the product. You can accept all cookies, reject non-essential
        ones, or change your preference anytime.
      </p>

      <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3">
        <Button
          variant="outline"
          size="default"
          onClick={onReject}
          className={cn(
            "min-h-10 sm:min-h-9 flex-1 sm:flex-initial",
            "border bg-background hover:bg-accent hover:text-accent-foreground",
            "dark:border-input dark:hover:bg-input/50"
          )}
        >
          Reject non-essential
        </Button>
        <Button
          variant="default"
          size="default"
          onClick={onAccept}
          className="min-h-10 sm:min-h-9 flex-1 sm:flex-initial bg-primary text-primary-foreground shadow-xs hover:bg-primary/90"
        >
          Accept all
        </Button>
      </div>

      <PolicyLinks className="text-xs text-muted-foreground" />
    </div>
  );
}

export function CookieConsentBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [showPreferencesDialog, setShowPreferencesDialog] = useState(false);
  const [mounted, setMounted] = useState(false);

  const shouldShowBanner = useCallback(() => {
    if (typeof window === "undefined") return false;
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return false;

    const stored = getStoredConsent();
    if (stored) return false;

    try {
      const status = posthog.get_explicit_consent_status?.();
      return status === "pending";
    } catch {
      return true;
    }
  }, []);

  const handleAccept = useCallback(() => {
    posthog.opt_in_capturing();
    storeConsent("granted");
    setShowBanner(false);
    setShowPreferencesDialog(false);
  }, []);

  const handleReject = useCallback(() => {
    posthog.opt_out_capturing();
    storeConsent("denied");
    setShowBanner(false);
    setShowPreferencesDialog(false);
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    setShowBanner(shouldShowBanner());
  }, [mounted, shouldShowBanner]);

  useEffect(() => {
    const handler = () => setShowPreferencesDialog(true);
    window.addEventListener(COOKIE_PREFERENCES_EVENT, handler);
    return () => window.removeEventListener(COOKIE_PREFERENCES_EVENT, handler);
  }, []);

  return (
    <>
      <AnimatePresence>
        {showBanner && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={subtleSpring}
            className={cn(
              "fixed bottom-0 left-0 right-0 z-[100]",
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
                      We value your privacy
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      We use analytics cookies to understand how you use
                      OpenScholar and improve the product. Choose your
                      preference below.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="default"
                    onClick={handleReject}
                    className={cn(
                      "min-h-10 sm:min-h-9 flex-1 sm:flex-initial",
                      "border bg-background hover:bg-accent hover:text-accent-foreground",
                      "dark:border-input dark:hover:bg-input/50"
                    )}
                  >
                    Reject non-essential
                  </Button>
                  <Button
                    variant="default"
                    size="default"
                    onClick={handleAccept}
                    className="min-h-10 sm:min-h-9 flex-1 sm:flex-initial bg-primary text-primary-foreground shadow-xs hover:bg-primary/90"
                  >
                    Accept all
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
            <DialogTitle>Cookie preferences</DialogTitle>
            <DialogDescription>
              Manage how OpenScholar uses cookies for analytics.
            </DialogDescription>
          </DialogHeader>
          <ConsentDialogContent
            onAccept={handleAccept}
            onReject={handleReject}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

export const COOKIE_PREFERENCES_EVENT = "openscholar-open-cookie-preferences";

export function CookiePreferencesTrigger() {
  const [mounted, setMounted] = useState(false);
  const [hasDecision, setHasDecision] = useState(false);

  useEffect(() => {
    setMounted(true);
    setHasDecision(hasConsentDecision());
  }, []);

  useEffect(() => {
    const handler = () => setHasDecision(true);
    window.addEventListener(CONSENT_UPDATED_EVENT, handler);
    return () => window.removeEventListener(CONSENT_UPDATED_EVENT, handler);
  }, []);

  const handleClick = () => {
    window.dispatchEvent(new CustomEvent(COOKIE_PREFERENCES_EVENT));
  };

  if (!mounted || !hasDecision) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
        "hover:text-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md"
      )}
      aria-label="Open cookie preferences"
    >
      <Settings2 className="h-3.5 w-3.5" />
      Cookie preferences
    </button>
  );
}
