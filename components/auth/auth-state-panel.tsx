"use client";

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { Loader2, LogIn, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

export type AuthStateVariant =
  | "loading"
  | "sign_in_required"
  | "no_access"
  | "sync_error_retry";

export type AuthStateLayout = "inline" | "fullscreen";
export type AuthStateLoadingStyle = "spinner" | "panel";

type AuthStatePanelProps = {
  variant: AuthStateVariant;
  title?: string;
  description?: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  onRetry?: () => void;
  className?: string;
  layout?: AuthStateLayout;
  loadingStyle?: AuthStateLoadingStyle;
};

const PANEL_VARIANTS: Variants = {
  initial: { opacity: 0, y: 14, scale: 0.985 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.32,
      ease: [0.22, 1, 0.36, 1],
      staggerChildren: 0.045,
      delayChildren: 0.04,
    },
  },
  exit: {
    opacity: 0,
    y: -8,
    scale: 0.985,
    transition: { duration: 0.18, ease: [0.4, 0, 1, 1] },
  },
};

const REDUCED_PANEL_VARIANTS: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.14 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

const ITEM_VARIANTS: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
  },
  exit: { opacity: 0, y: -4, transition: { duration: 0.14 } },
};

const REDUCED_ITEM_VARIANTS: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.12 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

const SPINNER_VARIANTS: Variants = {
  initial: { opacity: 0, scale: 0.9 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
  },
  exit: { opacity: 0, scale: 0.94, transition: { duration: 0.16 } },
};

const REDUCED_SPINNER_VARIANTS: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.12 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

const ICON_TREATMENT: Record<AuthStateVariant, string> = {
  loading: "bg-primary/10 text-primary",
  sign_in_required: "bg-primary/12 text-primary",
  no_access: "bg-amber-500/14 text-amber-700 dark:text-amber-300",
  sync_error_retry: "bg-primary/14 text-primary",
};

function AuthStateVariantIcon({ variant }: { variant: AuthStateVariant }) {
  if (variant === "loading") {
    return <Loader2 className="h-5 w-5 animate-spin" aria-hidden />;
  }
  if (variant === "sign_in_required") {
    return <LogIn className="h-5 w-5" aria-hidden />;
  }
  if (variant === "sync_error_retry") {
    return <RefreshCw className="h-5 w-5" aria-hidden />;
  }
  return <ShieldAlert className="h-5 w-5" aria-hidden />;
}

export function AuthStatePanel({
  variant,
  title,
  description,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  onRetry,
  className,
  layout = "inline",
  loadingStyle = "spinner",
}: AuthStatePanelProps) {
  const t = useTranslations("auth");
  const prefersReducedMotion = useReducedMotion();
  const panelVariants = prefersReducedMotion ? REDUCED_PANEL_VARIANTS : PANEL_VARIANTS;
  const itemVariants = prefersReducedMotion ? REDUCED_ITEM_VARIANTS : ITEM_VARIANTS;
  const spinnerVariants = prefersReducedMotion
    ? REDUCED_SPINNER_VARIANTS
    : SPINNER_VARIANTS;

  const defaultCopy: Record<AuthStateVariant, { title: string; description: string }> = {
    loading: { title: t("loadingTitle"), description: t("loadingDescription") },
    sign_in_required: { title: t("signInRequiredTitle"), description: t("signInRequiredDescription") },
    no_access: { title: t("noAccessTitle"), description: t("noAccessDescription") },
    sync_error_retry: { title: t("syncErrorTitle"), description: t("syncErrorDescription") },
  };

  const resolvedTitle = title ?? defaultCopy[variant].title;
  const resolvedDescription = description ?? defaultCopy[variant].description;

  const isSpinnerOnlyLoading = variant === "loading" && loadingStyle === "spinner";

  const rootClassName = cn(
    "w-full",
    layout === "fullscreen" &&
      "flex min-h-[60vh] flex-1 items-center justify-center px-4 py-8 sm:px-6",
  );

  if (isSpinnerOnlyLoading) {
    return (
      <motion.section
        className={cn(rootClassName, className)}
        variants={spinnerVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        aria-live="polite"
      >
        <div className="relative mx-auto flex items-center justify-center">
          <div className="absolute -z-10 h-24 w-24 rounded-full bg-primary/16 blur-2xl" />
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-primary/25 bg-card/95 shadow-lg">
            <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
          </div>
          <span className="sr-only">{t("loadingSession")}</span>
        </div>
      </motion.section>
    );
  }

  const primaryButton =
    variant === "sync_error_retry" && onRetry ? (
      <Button type="button" onClick={onRetry}>
        {t("retrySync")}
      </Button>
    ) : primaryHref && primaryLabel ? (
      <Button asChild>
        <Link href={primaryHref}>{primaryLabel}</Link>
      </Button>
    ) : null;

  return (
    <motion.section
      className={cn(rootClassName, className)}
      variants={panelVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      aria-live="polite"
    >
      <div className="relative mx-auto w-full max-w-xl overflow-hidden rounded-2xl border border-border/60 bg-card/95 px-6 py-8 text-center shadow-lg sm:px-8">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(70%_55%_at_50%_-5%,oklch(0.7_0.17_54_/_0.12),transparent_70%)]" />
        <div className="pointer-events-none absolute -left-20 top-10 -z-10 h-40 w-40 rounded-full bg-primary/8 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 bottom-8 -z-10 h-40 w-40 rounded-full bg-primary/8 blur-3xl" />

        <motion.div
          className={cn(
            "mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-border/50",
            ICON_TREATMENT[variant],
          )}
          variants={itemVariants}
        >
          <AuthStateVariantIcon variant={variant} />
        </motion.div>

        <motion.h2
          className="mx-auto mb-2 max-w-[24ch] text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]"
          variants={itemVariants}
        >
          {resolvedTitle}
        </motion.h2>

        <motion.p
          className="mx-auto mb-7 max-w-[48ch] text-pretty text-[0.95rem] leading-6 text-muted-foreground"
          variants={itemVariants}
        >
          {resolvedDescription}
        </motion.p>

        <AnimatePresence initial={false}>
          {(primaryButton || (secondaryHref && secondaryLabel)) && (
            <motion.div
              key="actions"
              className="flex flex-wrap items-center justify-center gap-2.5"
              variants={itemVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              {primaryButton}
              {secondaryHref && secondaryLabel ? (
                <Button variant="outline" asChild>
                  <Link href={secondaryHref}>{secondaryLabel}</Link>
                </Button>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}
