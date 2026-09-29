"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
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
import { TooltipHint } from "@/components/ui/tooltip";
import type { Id } from "@/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { getProviderIcon } from "@/components/icons/provider-icons";
import { stripProviderPrefix } from "@/lib/chat/model-display";
import type { AIProvider } from "@/lib/types/ai.types";
import type { ChatModelRow } from "./chat-model-types";
import type { Effort } from "@/lib/ai/core/call-options";

interface ComposerModelPickerProps {
  value: Id<"models"> | null;
  /** A preset shortcut passes the effort it runs chat at. */
  onChange: (id: Id<"models">, effort?: Effort) => void;
  disabled?: boolean;
  models: ChatModelRow[];
}

// Display labels keep editorial casing (OpenAI, DeepSeek) instead of the
// lowercase slug stored on each model row.
const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
  azure: "Azure",
};

const PROVIDER_ORDER: Record<string, number> = {
  anthropic: 0,
  openai: 1,
  google: 2,
  deepseek: 3,
  openrouter: 4,
  azure: 5,
};

function providerLabel(slug: string): string {
  return PROVIDER_LABEL[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}

function formatContextLength(n: number | undefined | null): string | null {
  if (!n || n <= 0) return null;
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}M`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/**
 * Composer-anchored model picker. Renders as a low-weight ghost pill
 * (provider icon + model name + chevron) inside the composer toolbar.
 * Click → searchable command palette grouped by provider, each row
 * showing its provider glyph and context length so the user can pick
 * the right model without reading a settings page first.
 */
export function ComposerModelPicker({
  value,
  onChange,
  disabled,
  models,
}: ComposerModelPickerProps) {
  const t = useTranslations("extraction");
  const [open, setOpen] = useState(false);
  const sortedModels = useMemo(() => models, [models]);

  // Each preset's chat model as a shortcut, resolved to the chat's catalog rows.
  const tp = useTranslations("settingsAi");
  const presets = useQuery(api.aiModelConfig.queries.presets, {});
  const presetRows = useMemo(
    () =>
      (presets ?? []).flatMap(({ preset, tasks }) => {
        const chat = tasks.find((r) => r.task === "chat");
        const m = chat?.model ? sortedModels.find((x) => x._id === chat.model!._id) : undefined;
        return m ? [{ label: tp(`presets.${preset}`), m, effort: chat?.effort ?? undefined }] : [];
      }),
    [presets, sortedModels, tp],
  );

  const groups = useMemo(() => {
    const byProvider = new Map<string, typeof sortedModels>();
    for (const m of sortedModels) {
      const list = byProvider.get(m.provider) ?? [];
      list.push(m);
      byProvider.set(m.provider, list);
    }
    return Array.from(byProvider.entries()).sort((a, b) => {
      const ra = PROVIDER_ORDER[a[0]] ?? 99;
      const rb = PROVIDER_ORDER[b[0]] ?? 99;
      if (ra !== rb) return ra - rb;
      return a[0].localeCompare(b[0]);
    });
  }, [sortedModels]);

  const selected = useMemo(
    () => sortedModels.find((m) => m._id === value),
    [sortedModels, value],
  );

  const TriggerIcon = useMemo(
    () => getProviderIcon((selected?.provider as AIProvider) ?? "openai"),
    [selected?.provider],
  );

  const triggerLabel = selected
    ? stripProviderPrefix(selected.name)
    : sortedModels.length === 0
      ? t("chatModelPickerLoading")
      : t("chatModelPickerTrigger");

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
          data-provider={selected?.provider ?? ""}
          className={cn(
            "h-7 gap-1.5 rounded-full px-2 text-xs font-medium text-muted-foreground",
            "hover:bg-accent hover:text-foreground",
            "data-[state=open]:bg-accent data-[state=open]:text-foreground",
          )}
        >
          {selected ? (
            <TriggerIcon className="size-3.5 text-foreground/80" />
          ) : null}
          <span className="max-w-[200px] truncate">{triggerLabel}</span>
          <ChevronDownIcon className="size-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-[340px] p-0"
        data-composer-model-picker="true"
      >
        <Command>
          <CommandInput placeholder={t("chatModelPickerSearch")} />
          <CommandList className="max-h-[340px]">
            <CommandEmpty>{t("chatModelPickerEmpty")}</CommandEmpty>
            {presetRows.length > 0 ? (
              <>
                <CommandGroup heading={t("chatModelPresets")}>
                  {presetRows.map(({ label, m, effort }) => {
                    const Icon = getProviderIcon(m.provider as AIProvider);
                    const isSelected = m._id === value;
                    return (
                      <CommandItem
                        key={`preset-${m._id}`}
                        value={`Preset ${label} ${stripProviderPrefix(m.name)}`}
                        onSelect={() => {
                          onChange(m._id, effort);
                          setOpen(false);
                        }}
                        data-preset-option={label}
                        className="gap-2.5 py-2"
                      >
                        <Icon className={cn("size-3.5 shrink-0", isSelected ? "text-foreground" : "text-muted-foreground/70")} />
                        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                        <span className="shrink-0 truncate text-[11px] text-muted-foreground">{stripProviderPrefix(m.name)}</span>
                        <CheckIcon className={cn("size-3.5 shrink-0 text-primary transition-opacity", isSelected ? "opacity-100" : "opacity-0")} aria-hidden />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
                <CommandSeparator />
              </>
            ) : null}
            {groups.map(([provider, list], i) => {
              const Icon = getProviderIcon(provider as AIProvider);
              return (
                <div key={provider} data-provider-group={provider}>
                  {i > 0 ? <CommandSeparator /> : null}
                  <CommandGroup
                    heading={
                      <span className="flex items-center gap-1.5">
                        <Icon className="size-3 text-muted-foreground/70" />
                        <span className="tracking-wide">
                          {providerLabel(provider)}
                        </span>
                      </span>
                    }
                  >
                    {list.map((m) => {
                      const isSelected = m._id === value;
                      const ctx = formatContextLength(m.contextLength);
                      const label = stripProviderPrefix(m.name);
                      return (
                        <CommandItem
                          key={m._id}
                          value={`${providerLabel(provider)} ${label}`}
                          onSelect={() => {
                            onChange(m._id);
                            setOpen(false);
                          }}
                          data-model-option={m._id}
                          data-selected={isSelected}
                          className="gap-2.5 py-2"
                        >
                          <Icon
                            className={cn(
                              "size-3.5 shrink-0",
                              isSelected
                                ? "text-foreground"
                                : "text-muted-foreground/70",
                            )}
                          />
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate",
                              isSelected && "font-medium",
                            )}
                          >
                            {label}
                          </span>
                          {ctx ? (
                            <TooltipHint label={`${m.contextLength?.toLocaleString()} token context`}>
                              <span
                                className="shrink-0 rounded border border-border/60 bg-background/60 px-1 py-0.5 font-mono text-[10px] leading-none text-muted-foreground"
                                aria-label={`${ctx} tokens context`}
                              >
                                {ctx}
                              </span>
                            </TooltipHint>
                          ) : null}
                          <CheckIcon
                            className={cn(
                              "size-3.5 shrink-0 text-primary transition-opacity",
                              isSelected ? "opacity-100" : "opacity-0",
                            )}
                            aria-hidden
                          />
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </div>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
