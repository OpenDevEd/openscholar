"use client";

import type { LucideIcon } from "lucide-react";
import { Rocket } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ActivationControl({
  busy,
  disabled,
  idleLabel,
  onActivate,
}: {
  busy: {
    accessibleLabel: string;
    icon: LucideIcon;
    label: string;
  } | null;
  disabled: boolean;
  idleLabel: string;
  onActivate: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const BusyIcon = busy?.icon;

  return (
    <Button
      disabled={disabled}
      onClick={onActivate}
      variant={busy ? "outline" : "default"}
      aria-label={busy?.accessibleLabel}
      className={cn(
        busy &&
          "relative w-48 overflow-hidden bg-muted/50 px-3 text-foreground shadow-none disabled:opacity-100 dark:bg-muted/40",
      )}
    >
      {busy && BusyIcon ? (
        <>
          <AnimatePresence initial={false} mode="wait">
            <motion.span
              key={busy.label}
              className="flex min-w-0 items-center justify-center gap-2"
              initial={reduceMotion ? false : { opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -5 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              <BusyIcon
                role="status"
                aria-label="Loading"
                className="size-4 text-muted-foreground"
              />
              <span aria-hidden="true" className="min-w-0 truncate">
                {busy.label}
              </span>
            </motion.span>
          </AnimatePresence>
          {!reduceMotion ? (
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-px overflow-hidden"
            >
              <motion.span
                className="block h-full w-1/3 bg-primary/70"
                animate={{ x: ["-100%", "400%"] }}
                transition={{
                  duration: 1.6,
                  ease: [0.4, 0, 0.2, 1],
                  repeat: Number.POSITIVE_INFINITY,
                }}
              />
            </span>
          ) : null}
        </>
      ) : (
        <>
          <Rocket />
          {idleLabel}
        </>
      )}
    </Button>
  );
}
