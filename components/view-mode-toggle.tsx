"use client";

import { useTranslations } from "next-intl";
import { VIEW_MODE_OPTIONS } from "@/lib/constants/view-modes";
import type { ViewMode } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The one switch between list and grid views, used by every list that offers them. */
export function ViewModeSwitch({ value, onChange }: { value: ViewMode; onChange: (mode: ViewMode) => void }) {
  const t = useTranslations("viewMode");
  const ta = useTranslations("accessibility");
  return (
    <div role="group" aria-label={ta("viewOptions")} className="flex items-center gap-0.5 rounded-md bg-muted/40 p-0.5">
      {VIEW_MODE_OPTIONS.map(({ mode, icon: Icon, label }) => (
        <button
          key={mode}
          type="button"
          aria-pressed={value === mode}
          aria-label={t(label)}
          title={t(label)}
          onClick={() => onChange(mode)}
          className={cn(
            "flex size-7 items-center justify-center rounded-[5px] transition-colors",
            value === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
