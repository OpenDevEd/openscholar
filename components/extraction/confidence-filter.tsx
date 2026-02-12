"use client";

import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface ConfidenceFilterProps {
  range: [number, number];
  onChange: (range: [number, number]) => void;
}

const presets = [
  { label: 'All', value: [0, 100] as [number, number] },
  { label: 'High', value: [80, 100] as [number, number] },
  { label: 'Medium', value: [50, 80] as [number, number] },
  { label: 'Low', value: [0, 50] as [number, number] },
];

export function ConfidenceFilter({ range, onChange }: ConfidenceFilterProps) {
  const t = useTranslations('filters');
  const isFiltered = range[0] !== 0 || range[1] !== 100;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn(isFiltered && "border-primary")}>
          <Filter className="w-4 h-4 mr-2" />
          Confidence: {range[0]}%-{range[1]}%
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="space-y-4">
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

          <div className="space-y-1">
            <Label>{t('quickFilters')}</Label>
            <div className="flex gap-2">
              {presets.map(preset => (
                <Button
                  key={preset.label}
                  variant="outline"
                  size="sm"
                  onClick={() => onChange(preset.value)}
                  className={cn(
                    range[0] === preset.value[0] && range[1] === preset.value[1] &&
                    "bg-primary/10 border-primary"
                  )}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
