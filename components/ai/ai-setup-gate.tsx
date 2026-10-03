"use client";

import { create } from "zustand";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import Image from "next/image";
import { X, ArrowRight, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { useSignInRedirect } from "@/lib/auth/use-sign-in-redirect";
import { subtleSpring } from "@/lib/animation-config";
import { cn } from "@/lib/utils";
import Link from "next/link";

/** Session-scoped shared state — dismiss once, all gates hide. */
const useAISetupGateDismissed = create<{
  dismissed: boolean;
  dismiss: () => void;
}>((set) => ({
  dismissed: false,
  dismiss: () => set({ dismissed: true }),
}));

interface AISetupGateProps {
  className?: string;
}

/**
 * Inline dismissible card shown when a user has no AI configured
 * (not signed in AND no API key). Presents two clear paths:
 *
 * 1. Sign in for free credits (primary, zero-friction)
 * 2. Use your own API key (secondary, power-user)
 *
 * Dismissal is shared across all instances for the current session.
 * Reappears on refresh if the underlying state hasn't changed.
 */
export function AISetupGate({ className }: AISetupGateProps) {
  const t = useTranslations("aiSetupGate");
  const tc = useTranslations("common");
  const { dismissed, dismiss } = useAISetupGateDismissed();
  const { phase } = useAuthReadiness();
  const goToSignIn = useSignInRedirect();
  const prefersReducedMotion = useReducedMotion();

  // Don't render until auth has settled — avoid flash during initializing
  if (phase === "initializing" || phase === "authenticated") return null;
  if (dismissed) return null;

  const motionProps = prefersReducedMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
      }
    : {
        initial: { opacity: 0, y: -8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -8 },
      };

  return (
    <AnimatePresence>
      <motion.div
        {...motionProps}
        transition={prefersReducedMotion ? { duration: 0.14 } : subtleSpring}
        className={cn(
          "rounded-xl border p-4 shadow-sm",
          "bg-card",
          "border-border/60",
          className,
        )}
      >
        <div className="flex items-start gap-3">
          {/* Logo icon */}
          <div className="flex h-9 w-9 shrink-0 items-center justify-center">
            <Image src="/icon.svg" alt="" width={28} height={28} className="w-7 h-7" />
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground leading-snug">
                  {t("title")}
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                  {t("description")}
                </p>
              </div>
              {/* Dismiss button */}
              <Button
                size="sm"
                variant="ghost"
                onClick={dismiss}
                className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                aria-label={tc("dismiss")}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Dual CTAs */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                onClick={goToSignIn}
                className="h-7 gap-1 px-2.5 text-2xs"
              >
                <ArrowRight className="h-2.5 w-2.5" />
                {t("signInForCredits")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                asChild
                className="h-7 gap-1 px-2.5 text-2xs text-muted-foreground"
              >
                <Link href="/settings/ai">
                  <Settings className="h-2.5 w-2.5" />
                  {t("useOwnApiKey")}
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
