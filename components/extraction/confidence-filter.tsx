"use client";

import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useTranslations } from "next-intl";

interface ConfidenceFilterProps {
  range: [number, number];
  onChange: (range: [number, number]) => void;
}

/** The confidence range, shown in the results filter menu. */
export function ConfidenceFilterFields({ range, onChange }: ConfidenceFilterProps) {
  const t = useTranslations('filters');

  return (
    <div>
      <Label>{t('confidenceRange')}</Label>
      <Slider
        value={range}
        onValueChange={(value) => onChange(value as [number, number])}
        min={0}
        max={100}
        step={5}
        className="mt-2"
      />
      <div className="flex justify-between text-xs text-muted-foreground mt-1">
        <span>{range[0]}%</span>
        <span>{range[1]}%</span>
      </div>
    </div>
  );
}
