"use client";

import { useTranslations } from "next-intl";
import type { ScoringRule } from "@/convex/screening/scoring";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
            className="rounded-lg border p-3 space-y-2"
          >
            <p className="text-sm font-medium text-foreground/90">
              {i + 1}. {q.question}
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {t("yesLabel")} ({t("pointsLabel")})
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
                <Label className="text-xs text-muted-foreground">
                  {t("noLabel")} ({t("pointsLabel")})
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
                <Label className="text-xs text-muted-foreground">
                  {t("uncertainLabel")} ({t("pointsLabel")})
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
      <div className="rounded-lg border p-3 space-y-1">
        <Label className="text-xs text-muted-foreground">
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
