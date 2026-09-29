"use client";

import { useTranslations } from "next-intl";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { getModelIcon } from "@/components/icons/provider-icons";
import { stripProviderPrefix } from "@/lib/chat/model-display";
import { PRESET_KEYS } from "@/lib/ai/tasks";
import { ModelPicker } from "@/components/models/model-picker";
import { usePresetModels, type PresetPick } from "@/components/settings/model-map";
import type { ChatModelRow } from "./chat-model-types";
import type { Effort } from "@/lib/ai/core/call-options";

interface ComposerModelPickerProps {
  value: Id<"models"> | null;
  /** The chat's effort; none means its model's default. */
  effort?: Effort;
  /** A preset shortcut passes the effort it runs chat at. */
  onChange: (id: Id<"models">, effort?: Effort) => void;
  disabled?: boolean;
  models: ChatModelRow[];
}

/**
 * The chat's model, as a low-weight pill in the composer toolbar that opens the
 * shared model picker, with each preset's chat model listed first.
 */
export function ComposerModelPicker({ value, effort, onChange, disabled, models }: ComposerModelPickerProps) {
  const t = useTranslations("extraction");
  const presetModel = usePresetModels();
  const selected = models.find((m) => m._id === value);
  const presets: PresetPick[] = presetModel
    ? PRESET_KEYS.flatMap((preset) => {
        const m = presetModel(preset, "chat");
        return m ? [{ id: preset, models: [m], onSelect: () => onChange(m._id, m.effort) }] : [];
      })
    : [];
  const Brand = getModelIcon(selected?.modelId ?? "");

  return (
    <ModelPicker
      align="start"
      side="top"
      tasks={["chat"]}
      presets={presets}
      current={selected && { id: selected.modelId, effort, reasoningEfforts: selected.reasoningEfforts, defaultEffort: selected.defaultEffort }}
      onChange={(m, effort) => onChange(m._id, effort)}
      efforts
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || models.length === 0}
          aria-label={t("chatModelPickerTrigger")}
          data-action="open-model-picker"
          data-model-id={value ?? ""}
          data-provider={selected?.provider ?? ""}
          className={cn(
            "h-7 min-w-0 shrink gap-1.5 rounded-full px-2 text-xs font-medium text-muted-foreground",
            "hover:bg-accent hover:text-foreground",
            "data-[state=open]:bg-accent data-[state=open]:text-foreground",
          )}
        >
          {selected ? <Brand className="size-3.5 text-foreground/80" /> : null}
          <span className="min-w-0 max-w-[200px] truncate">
            {selected ? stripProviderPrefix(selected.name) : models.length === 0 ? t("chatModelPickerLoading") : t("chatModelPickerTrigger")}
          </span>
          <ChevronDownIcon className="size-3 opacity-60" />
        </Button>
      }
    />
  );
}
