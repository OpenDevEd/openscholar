"use client";

import {
  FileText,
  Unlock,
  AlertCircle,
  TrendingUp,
  TrendingDown,
} from "@/components/icons";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useTranslations } from "next-intl";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import { getStatusFilterOptionIds } from "@/lib/extraction/status-filter-options";

interface StatusFilterProps {
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
}

/** The status checks, shown in the results filter menu. */
export function StatusFilterFields({ selected, onChange }: StatusFilterProps) {
  const t = useTranslations('filters');
  const tc = useTranslations('common');
  const pdfEnabled = useFeatureFlag("extraction.pdf");
  const options = getStatusFilterOptionIds(pdfEnabled).map((id) => {
    if (id === "has-pdf") {
      return { id, label: t("hasPdf"), icon: FileText };
    }
    if (id === "abstract-only") {
      return { id, label: tc("abstractOnly"), icon: FileText };
    }
    if (id === "open-access") {
      return { id, label: tc("openAccess"), icon: Unlock };
    }
    if (id === "has-errors") {
      return { id, label: t("hasErrors"), icon: AlertCircle };
    }
    if (id === "high-confidence") {
      return { id, label: t("highConfidence"), icon: TrendingUp };
    }
    if (id === "low-confidence") {
      return { id, label: t("lowConfidence"), icon: TrendingDown };
    }
    return { id, label: t("lowConfidence"), icon: TrendingDown };
  });


  const toggleStatus = (id: string) => {
    const newSet = new Set(selected);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    onChange(newSet);
  };

  return (
    <div className="space-y-2">
      <Label>{t('filterByStatus')}</Label>
      {options.map(option => {
        const Icon = option.icon;
        return (
          <div key={option.id} className="flex items-center gap-2">
            <Checkbox
              checked={selected.has(option.id)}
              onCheckedChange={() => toggleStatus(option.id)}
              id={option.id}
            />
            <Icon className="w-4 h-4 text-muted-foreground" />
            <label
              htmlFor={option.id}
              className="text-sm cursor-pointer flex-1"
            >
              {option.label}
            </label>
          </div>
        );
      })}
    </div>
  );
}
