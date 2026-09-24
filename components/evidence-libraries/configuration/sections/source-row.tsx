"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { Pause, Pencil, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  onEdit?: () => void;
  onToggle: () => void;
  onRemove: () => void;
  disabled?: boolean;
  toggleDisabled?: boolean;
}) {
  const actions = [
    ...(onEdit
      ? [{ label: "Edit", icon: Pencil, onClick: onEdit, disabled }]
      : []),
    {
      label: paused ? "Resume" : "Pause",
      icon: paused ? Play : Pause,
      onClick: onToggle,
      disabled: disabled || toggleDisabled,
    },
    { label: "Remove", icon: Trash2, onClick: onRemove, disabled },
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
            ({ label, icon: Icon, onClick, disabled: actionDisabled }) => (
              <Tooltip key={label}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${label} ${name}`}
                    disabled={actionDisabled}
                    onClick={onClick}
                    className={cn(
                      "text-muted-foreground",
                      label === "Remove" && "hover:text-destructive",
                    )}
                  >
                    <Icon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{label} source</TooltipContent>
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
        {controls}
      </div>
    </li>
  );
}
