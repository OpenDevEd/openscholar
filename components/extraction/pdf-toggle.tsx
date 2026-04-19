"use client";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useTranslations } from "next-intl";

interface PdfToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function PdfToggle({ value, onChange, disabled }: PdfToggleProps) {
  const t = useTranslations("extraction");
  return (
    <div
      className="flex items-center justify-between rounded-lg border border-border bg-card p-4"
      data-pdf-enabled={value}
    >
      <div className="space-y-0.5">
        <Label htmlFor="pdf-toggle" className="text-sm font-medium">
          {t("usePdfsTitle")}
        </Label>
        <p className="text-xs text-muted-foreground">{t("usePdfsDescription")}</p>
      </div>
      <Switch
        id="pdf-toggle"
        checked={value}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={t("usePdfsAriaLabel")}
      />
    </div>
  );
}
