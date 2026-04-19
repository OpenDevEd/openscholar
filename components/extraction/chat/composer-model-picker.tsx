"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { CheckIcon, ChevronDownIcon, SparklesIcon } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

interface ComposerModelPickerProps {
  value: Id<"models"> | null;
  onChange: (id: Id<"models">) => void;
  disabled?: boolean;
}

/**
 * Composer-anchored model picker. Renders as a low-weight ghost pill
 * (model name + chevron) inside the composer toolbar — pattern adopted
 * by Cursor / v0 / ChatGPT new composer. Click → searchable command
 * palette grouped by provider. Avoids the previous header dropdown
 * which the user called out as cramped and out of place.
 */
export function ComposerModelPicker({
  value,
  onChange,
  disabled,
}: ComposerModelPickerProps) {
  const t = useTranslations("extraction");
  const [open, setOpen] = useState(false);
  const models = useQuery(api.chat.model.listChatModels, {});

  const sortedModels = useMemo(() => {
    if (!models) return [];
    return [...models].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [models]);

  // First-run default: pick the first served model if none selected yet.
  useEffect(() => {
    if (value === null && sortedModels.length > 0) {
      onChange(sortedModels[0]._id);
    }
  }, [value, sortedModels, onChange]);

  const groups = useMemo(() => {
    const byProvider = new Map<string, typeof sortedModels>();
    for (const m of sortedModels) {
      const list = byProvider.get(m.provider) ?? [];
      list.push(m);
      byProvider.set(m.provider, list);
    }
    return Array.from(byProvider.entries());
  }, [sortedModels]);

  const selected = useMemo(
    () => sortedModels.find((m) => m._id === value),
    [sortedModels, value],
  );

  const triggerLabel =
    selected?.name ??
    (sortedModels.length === 0
      ? t("chatModelPickerLoading")
      : t("chatModelPickerTrigger"));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || sortedModels.length === 0}
          aria-label={t("chatModelPickerTrigger")}
          data-action="open-model-picker"
          data-model-id={value ?? ""}
          className="h-7 gap-1.5 rounded-full px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          <SparklesIcon className="size-3.5" />
          <span className="max-w-[160px] truncate">{triggerLabel}</span>
          <ChevronDownIcon className="size-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-[280px] p-0"
        data-composer-model-picker="true"
      >
        <Command>
          <CommandInput placeholder={t("chatModelPickerSearch")} />
          <CommandList>
            <CommandEmpty>{t("chatModelPickerEmpty")}</CommandEmpty>
            {groups.map(([provider, list], i) => (
              <div key={provider}>
                {i > 0 ? <CommandSeparator /> : null}
                <CommandGroup heading={provider}>
                  {list.map((m) => {
                    const isSelected = m._id === value;
                    return (
                      <CommandItem
                        key={m._id}
                        value={`${provider} ${m.name}`}
                        onSelect={() => {
                          onChange(m._id);
                          setOpen(false);
                        }}
                        data-model-option={m._id}
                        data-selected={isSelected}
                      >
                        <span className="flex-1 truncate">{m.name}</span>
                        <CheckIcon
                          className={cn(
                            "size-4 shrink-0 text-primary transition-opacity",
                            isSelected ? "opacity-100" : "opacity-0",
                          )}
                          aria-hidden
                        />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </div>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
