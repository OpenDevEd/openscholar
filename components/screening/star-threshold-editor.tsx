"use client";

import { useTranslations } from "next-intl";
import { Trash2, Plus, Star } from "lucide-react";
import type {
  ScoringRule,
  StarThreshold,
} from "@/convex/screening/scoring";
import { validateScoringConfig } from "@/convex/screening/scoring";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface StarThresholdEditorProps {
  thresholds: StarThreshold[];
  onChange: (thresholds: StarThreshold[]) => void;
  rules: ScoringRule[];
  minimumScore?: number;
  disabled?: boolean;
}

export function StarThresholdEditor({
  thresholds,
  onChange,
  rules,
  minimumScore,
  disabled,
}: StarThresholdEditorProps) {
  const t = useTranslations("screeningDialog");

  const warnings = validateScoringConfig({
    rules,
    starThresholds: thresholds,
    minimumScore,
  });

  function handleChange(
    index: number,
    field: keyof StarThreshold,
    value: number
  ) {
    const updated = thresholds.map((th, i) =>
      i === index ? { ...th, [field]: value } : th
    );
    onChange(updated);
  }

  function handleAdd() {
    const lastMin =
      thresholds.length > 0
        ? thresholds[thresholds.length - 1].minScore
        : -1;
    onChange([
      ...thresholds,
      { minScore: lastMin + 1, stars: 1 },
    ]);
  }

  function handleRemove(index: number) {
    onChange(thresholds.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3">
      {thresholds.map((th, i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 p-3"
        >
          <div className="space-y-1 flex-1">
            <Label className="text-xs text-muted-foreground">
              {t("minScoreLabel")}
            </Label>
            <Input
              type="number"
              value={th.minScore}
              onChange={(e) =>
                handleChange(i, "minScore", Number(e.target.value))
              }
              disabled={disabled}
              className="h-8"
            />
          </div>
          <div className="space-y-1 w-24">
            <Label className="text-xs text-muted-foreground">
              {t("starsLabel")}
            </Label>
            <Select
              value={String(th.stars)}
              onValueChange={(v) => handleChange(i, "stars", Number(v))}
              disabled={disabled}
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    <span className="flex items-center gap-1.5">
                      <span>{s}</span>
                      <span className="flex">
                        {Array.from({ length: s }, (_, i) => (
                          <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        ))}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleRemove(i)}
            disabled={disabled}
            className="h-8 w-8 shrink-0"
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">{t("removeThreshold")}</span>
          </Button>
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        onClick={handleAdd}
        disabled={disabled}
        className="gap-1.5"
      >
        <Plus className="h-3.5 w-3.5" />
        {t("addThreshold")}
      </Button>

      {warnings.length > 0 && (
        <div className="space-y-1">
          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-600 dark:text-amber-400">
              {w.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
