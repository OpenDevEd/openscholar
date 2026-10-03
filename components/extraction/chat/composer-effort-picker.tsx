"use client";

import { useTranslations } from "next-intl";
import { Brain, ChevronDownIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Effort } from "@/lib/ai/core/call-options";
import type { ChatModelRow } from "./chat-model-types";
import { EffortMeter } from "@/components/models/meters";

/** The chat's reasoning effort, for models that take one; a change applies from the next message. */
export function ComposerEffortPicker({
  model,
  value,
  onChange,
  disabled,
}: {
  model: ChatModelRow | undefined;
  value: Effort | undefined;
  onChange: (effort: Effort) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("settingsAi");
  const levels = model?.reasoningEfforts ?? [];
  if (levels.length === 0) return null;
  const current = value && levels.includes(value) ? value : model?.defaultEffort;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={current ? `${t("effort")}: ${t(`efforts.${current}`)}` : t("effort")}
          className={cn(
            "h-7 gap-1.5 rounded-full px-2 text-xs font-medium text-muted-foreground",
            "hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground",
          )}
        >
          {current ? <EffortMeter levels={levels} level={current} filled="bg-current" /> : <Brain className="size-3.5" />}
          {current ? t(`efforts.${current}`) : t("effort")}
          <ChevronDownIcon className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-44">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t("effort")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current ?? ""} onValueChange={(next) => onChange(next as Effort)}>
          {levels.map((level) => (
            <DropdownMenuRadioItem key={level} value={level} className="gap-2.5 text-sm">
              <EffortMeter levels={levels} level={level} />
              {t(`efforts.${level}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
