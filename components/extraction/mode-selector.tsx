"use client";

import { cn } from "@/lib/utils";
import { FileText, MessageSquare } from "@/components/icons";
import { useTranslations } from "next-intl";
import type { JobMode } from "@/lib/store/extraction";

interface ModeSelectorProps {
  value: JobMode;
  onChange: (mode: JobMode) => void;
  disabled?: boolean;
}

export function ModeSelector({ value, onChange, disabled }: ModeSelectorProps) {
  const t = useTranslations("extraction");

  const options = [
    { id: "extraction" as const, icon: FileText, titleKey: "modeExtractionTitle" as const, descKey: "modeExtractionDescription" as const },
    { id: "chat" as const, icon: MessageSquare, titleKey: "modeChatTitle" as const, descKey: "modeChatDescription" as const },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t("modeSelectLabel")}
      data-mode={value}
      className="grid grid-cols-1 sm:grid-cols-2 gap-3"
    >
      {options.map((opt) => {
        const Icon = opt.icon;
        const isSelected = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            data-value={opt.id}
            disabled={disabled}
            onClick={() => onChange(opt.id)}
            className={cn(
              "text-left p-4 rounded-lg border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:border-muted-foreground/30",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          >
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "rounded-md p-2",
                  isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-sm text-foreground">{t(opt.titleKey)}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{t(opt.descKey)}</div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
