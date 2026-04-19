"use client";

import { useMemo, useEffect } from "react";
import { useQuery } from "convex/react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useTranslations } from "next-intl";

interface ModelPickerProps {
  value: Id<"models"> | null;
  onChange: (id: Id<"models">) => void;
  disabled?: boolean;
}

export function ModelPicker({ value, onChange, disabled }: ModelPickerProps) {
  const t = useTranslations("extraction");
  const models = useQuery(api.chat.model.listChatModels, {});

  const sortedModels = useMemo(() => {
    if (!models) return [];
    return [...models].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [models]);

  // First-run default: if no model picked but models are available, pick
  // the first served one. Mirrors the plan's §4i "first on the list" rule.
  useEffect(() => {
    if (value === null && sortedModels.length > 0) {
      onChange(sortedModels[0]._id);
    }
  }, [value, sortedModels, onChange]);

  // Group by provider for a friendlier dropdown.
  const groups = useMemo(() => {
    const byProvider = new Map<string, typeof sortedModels>();
    for (const m of sortedModels) {
      const list = byProvider.get(m.provider) ?? [];
      list.push(m);
      byProvider.set(m.provider, list);
    }
    return Array.from(byProvider.entries());
  }, [sortedModels]);

  return (
    <div className="space-y-2" data-model-id={value ?? ""}>
      <Label htmlFor="model-picker">{t("modelPickerLabel")}</Label>
      <Select
        value={value ?? ""}
        onValueChange={(v) => onChange(v as Id<"models">)}
        disabled={disabled || sortedModels.length === 0}
      >
        <SelectTrigger id="model-picker" className="w-full">
          <SelectValue placeholder={t("modelPickerPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          {groups.map(([provider, list]) => (
            <SelectGroup key={provider}>
              <SelectLabel>{provider}</SelectLabel>
              {list.map((m) => (
                <SelectItem key={m._id} value={m._id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
