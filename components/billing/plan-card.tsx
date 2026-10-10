"use client";

// A plan on the Pricing page: a person's own (components/Pricing.tsx) or an organization's
// (components/workspaces/org-plans.tsx).

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Check, type AppIcon } from "@/components/icons";
import { subtleSpring } from "@/lib/animation-config";
import { cn } from "@/lib/utils";

const BADGE_TONES = {
  success: "bg-success/10 border-success/20 ink-success",
  primary: "bg-primary/10 border-primary/20 text-primary",
  info: "bg-info/10 border-info/20 ink-info",
} as const;

export function PlanCard({
  testId,
  index,
  current,
  badges = [],
  icon: Icon,
  name,
  price,
  description,
  features,
  children,
}: {
  testId?: string;
  /** Its place in the row, which staggers its entrance. */
  index: number;
  current: boolean;
  /** The strips across its top. */
  badges?: Array<{ tone: keyof typeof BADGE_TONES; label: string; testId?: string }>;
  icon: AppIcon;
  name: string;
  price: ReactNode;
  description?: string;
  features: string[];
  /** Its button. */
  children: ReactNode;
}) {
  return (
    <motion.div
      data-testid={testId}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...subtleSpring, delay: index * 0.1 }}
      className={cn("relative flex flex-col overflow-hidden rounded-xl border bg-card", current ? "border-primary/50 bg-primary/[0.02]" : "border-border-subtle")}
    >
      {badges.map((badge) => (
        <div key={badge.label} className={cn("flex items-center justify-center border-b px-4 py-2", BADGE_TONES[badge.tone])}>
          <span data-testid={badge.testId} className="text-xs font-semibold">
            {badge.label}
          </span>
        </div>
      ))}
      <div className="border-b border-border-subtle p-6">
        <div className="mb-4 flex items-center gap-3">
          <Icon className="size-8 text-primary" />
          <h3 className="text-2xl font-bold">{name}</h3>
        </div>
        <div className="mb-2">{price}</div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex-1 space-y-3 p-6">
        {features.map((feature) => (
          <div key={feature} className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="text-sm tabular-nums">{feature}</span>
          </div>
        ))}
      </div>
      <div className="mt-auto p-6 pt-0">{children}</div>
    </motion.div>
  );
}
