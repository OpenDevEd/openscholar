"use client";

import { useTranslations } from "next-intl";
import { ArrowRight, Plus, Star, X } from "@/components/icons";
import type {
  ScoringRule,
  StarThreshold,
} from "@/convex/screening/scoring";
import { validateScoringConfig } from "@/convex/screening/scoring";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
      { minScore: lastMin + 1, stars: Math.min(thresholds.length + 1, 5) },
    ]);
  }

  function handleRemove(index: number) {
    onChange(thresholds.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border-subtle bg-card">
        {thresholds.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">
            {t("addThreshold")}
          </div>
        ) : (
          thresholds.map((th, i) => (
            <div
              key={i}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5",
                i < thresholds.length - 1 && "border-b border-border-subtle"
              )}
            >
              {/* Score condition: ≥ [number] */}
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs font-medium text-muted-foreground">
                  ≥
                </span>
                <Input
                  type="number"
                  value={th.minScore}
                  onChange={(e) =>
                    handleChange(i, "minScore", Number(e.target.value))
                  }
                  disabled={disabled}
                  className="h-7 w-14 text-center tabular-nums"
                  aria-label={t("minScoreLabel")}
                />
              </div>

              {/* Arrow */}
              <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />

              {/* Inline clickable stars */}
              <div className="flex items-center gap-0.5 flex-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleChange(i, "stars", s)}
                    className="rounded p-0.5 transition-transform hover:scale-110 disabled:pointer-events-none disabled:opacity-50"
                  >
                    <Star
                      className={cn(
                        "h-4 w-4 transition-colors",
                        s <= th.stars
                          ? "fill-rating text-rating"
                          : "text-muted-foreground/25 hover:text-rating/50"
                      )}
                    />
                  </button>
                ))}
              </div>

              {/* Remove */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleRemove(i)}
                disabled={disabled}
                className="h-6 w-6 shrink-0 text-muted-foreground/50 hover:text-destructive"
              >
                <X className="h-3 w-3" />
                <span className="sr-only">{t("removeThreshold")}</span>
              </Button>
            </div>
          ))
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={handleAdd}
        disabled={disabled}
        className="gap-1.5 text-muted-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
        {t("addThreshold")}
      </Button>

      {warnings.length > 0 && (
        <div className="space-y-1">
          {warnings.map((w, i) => (
            <p
              key={i}
              className="text-xs ink-warning"
            >
              {w.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
