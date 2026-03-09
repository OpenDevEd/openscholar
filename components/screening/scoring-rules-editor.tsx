"use client";

import { useTranslations } from "next-intl";
import type { ScoringRule } from "@/convex/screening/scoring";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface ScoringRulesEditorProps {
  questions: { key: string; question: string }[];
  rules: ScoringRule[];
  onChange: (rules: ScoringRule[]) => void;
  minimumScore: number | undefined;
  onMinimumScoreChange: (score: number | undefined) => void;
  disabled?: boolean;
}

export function ScoringRulesEditor({
  questions,
  rules,
  onChange,
  minimumScore,
  onMinimumScoreChange,
  disabled,
}: ScoringRulesEditorProps) {
  const t = useTranslations("screeningDialog");

  function handlePointChange(
    questionKey: string,
    field: "yesPoints" | "noPoints" | "nullPoints",
    value: number
  ) {
    const updated = rules.map((rule) =>
      rule.questionKey === questionKey ? { ...rule, [field]: value } : rule
    );
    onChange(updated);
  }

  return (
    <div className="space-y-3">
      {questions.map((q, i) => {
        const rule = rules.find((r) => r.questionKey === q.key);
        if (!rule) return null;

        return (
          <div
            key={q.key}
            className="rounded-lg border border-border/50 bg-card p-3 space-y-2.5"
          >
            {/* Question text with numbered badge */}
            <div className="flex items-start gap-2">
              <Badge
                variant="outline"
                className="mt-0.5 h-5 min-w-5 shrink-0 justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums"
              >
                {i + 1}
              </Badge>
              <span className="text-sm text-foreground/90">{q.question}</span>
            </div>

            {/* Point inputs - fixed-width labels for alignment */}
            <div className="grid grid-cols-3 gap-3 pl-7">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">
                  {t("yesLabel")}
                </Label>
                <Input
                  type="number"
                  value={rule.yesPoints}
                  onChange={(e) =>
                    handlePointChange(
                      q.key,
                      "yesPoints",
                      Number(e.target.value)
                    )
                  }
                  disabled={disabled}
                  className="h-8"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">
                  {t("noLabel")}
                </Label>
                <Input
                  type="number"
                  value={rule.noPoints}
                  onChange={(e) =>
                    handlePointChange(
                      q.key,
                      "noPoints",
                      Number(e.target.value)
                    )
                  }
                  disabled={disabled}
                  className="h-8"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">
                  {t("uncertainLabel")}
                </Label>
                <Input
                  type="number"
                  value={rule.nullPoints}
                  onChange={(e) =>
                    handlePointChange(
                      q.key,
                      "nullPoints",
                      Number(e.target.value)
                    )
                  }
                  disabled={disabled}
                  className="h-8"
                />
              </div>
            </div>
          </div>
        );
      })}

      {/* Minimum score to save */}
      <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-1">
        <Label className="text-xs font-medium text-muted-foreground">
          {t("minimumScoreLabel")}
        </Label>
        <Input
          type="number"
          value={minimumScore ?? ""}
          placeholder="--"
          onChange={(e) => {
            const val = e.target.value;
            onMinimumScoreChange(val === "" ? undefined : Number(val));
          }}
          disabled={disabled}
          className="h-8 w-32"
        />
      </div>
    </div>
  );
}
