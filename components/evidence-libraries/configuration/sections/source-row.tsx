"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { Pause, Pencil, Play, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { MetaList, type MetaItem } from "../fields";
import { StatusChip, type StatusTone } from "../status-chip";

export function SourceRow({
  name,
  provider,
  icon,
  status,
  paused,
  metadata,
  description,
  controls,
  activity,
  onEdit,
  onToggle,
  onRemove,
  disabled,
  toggleDisabled,
  ...rest
}: Omit<HTMLAttributes<HTMLLIElement>, "onToggle"> & {
  name: string;
  provider: string;
  icon: ReactNode;
  status: { label: string; tone: StatusTone };
  paused: boolean;
  metadata: MetaItem[];
  description?: ReactNode;
  controls?: ReactNode;
  /** The import status band across the foot of the row. */
  activity?: ReactNode;
  onEdit?: () => void;
  onToggle: () => void;
  onRemove: () => void;
  disabled?: boolean;
  toggleDisabled?: boolean;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  const tc = useTranslations("common");
  const actions = [
    ...(onEdit
      ? [{ key: "edit", label: tc("edit"), icon: Pencil, onClick: onEdit, disabled }]
      : []),
    {
      key: "toggle",
      label: paused ? t("resume") : t("pause"),
      icon: paused ? Play : Pause,
      onClick: onToggle,
      disabled: disabled || toggleDisabled,
    },
    { key: "remove", label: tc("remove"), icon: Trash2, onClick: onRemove, disabled },
  ];
  return (
    <li
      className={cn("@container/source space-y-3 p-4", paused && "bg-muted/30")}
      {...rest}
    >
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 @min-[24rem]/source:grid-cols-[2rem_minmax(0,1fr)_auto]">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/50"
          aria-hidden
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "min-w-0 break-words text-sm font-medium",
                paused && "text-muted-foreground",
              )}
            >
              {name}
            </span>
            <StatusChip tone={status.tone}>{status.label}</StatusChip>
          </div>
          <p className="text-xs text-muted-foreground">{provider}</p>
        </div>
        <div className="col-start-2 flex items-center justify-end gap-0.5 @min-[24rem]/source:col-start-auto">
          {actions.map(
            ({ key, label, icon: Icon, onClick, disabled: actionDisabled }) => (
              <Tooltip key={key}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("sourceAction", { action: label, name })}
                    disabled={actionDisabled}
                    onClick={onClick}
                    className={cn(
                      "text-muted-foreground",
                      key === "remove" && "hover:text-destructive",
                    )}
                  >
                    <Icon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("sourceActionHint", { action: label })}</TooltipContent>
              </Tooltip>
            ),
          )}
        </div>
      </div>
      {description ? (
        <div className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MetaList items={metadata} />
        {controls ? <div className="flex flex-wrap items-center gap-4">{controls}</div> : null}
      </div>
      {activity ? <div className="-mx-4 -mb-4">{activity}</div> : null}
    </li>
  );
}

/** A setting on the right of a source row. It explains itself only when it cannot be used. */
export function SourceSwitch({
  label,
  checked,
  onCheckedChange,
  disabledReason,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabledReason?: string;
}) {
  const control = (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <Switch
        checked={checked}
        disabled={disabledReason !== undefined}
        aria-label={label}
        onCheckedChange={onCheckedChange}
      />
      {label}
    </label>
  );
  if (disabledReason === undefined) return control;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{control}</TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}

/** A count read after the row renders, in a box wide enough that nothing moves when it arrives. */
export function SourceCount({ count }: { count: number | null | undefined }) {
  return (
    <span className="inline-block min-w-[7ch] tabular-nums">
      {count == null ? null : count.toLocaleString()}
    </span>
  );
}
