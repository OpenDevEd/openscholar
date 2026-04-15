"use client";

import { useTranslations } from "next-intl";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelTier = "auto" | "cheap" | "accurate";

interface TierSelectorProps {
  value: ModelTier;
  onChange: (tier: ModelTier) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TierSelector({ value, onChange, className }: TierSelectorProps) {
  const t = useTranslations("extraction");

  const tiers: Array<{
    tierValue: ModelTier;
    label: string;
    description: string;
  }> = [
    {
      tierValue: "auto",
      label: t("jobCreation.tierAuto"),
      description: t("jobCreation.tierAutoDesc"),
    },
    {
      tierValue: "cheap",
      label: t("jobCreation.tierCheap"),
      description: t("jobCreation.tierCheapDesc"),
    },
    {
      tierValue: "accurate",
      label: t("jobCreation.tierAccurate"),
      description: t("jobCreation.tierAccurateDesc"),
    },
  ];

  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as ModelTier)}
      className={cn("grid gap-2", className)}
    >
      {tiers.map((option) => {
        const isSelected = value === option.tierValue;
        const itemId = `tier-${option.tierValue}`;

        return (
          <Label
            key={option.tierValue}
            htmlFor={itemId}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
              "hover:bg-accent/30",
              isSelected
                ? "border-primary/50 bg-primary/5"
                : "border-border/50"
            )}
          >
            <RadioGroupItem value={option.tierValue} id={itemId} className="mt-0.5" />
            <div className="space-y-0.5">
              <span className="text-sm font-medium leading-none">
                {option.label}
              </span>
              <p className="text-xs text-muted-foreground">
                {option.description}
              </p>
            </div>
          </Label>
        );
      })}
    </RadioGroup>
  );
}
