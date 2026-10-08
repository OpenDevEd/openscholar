"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { MIRRORED_FIELD, QueryMirror, useMirrorScroll } from "@/components/query-highlight";

interface FloatingInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Extra content rendered inline after the label text (e.g. history nav) */
  labelAddon?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  wrapperClassName?: string;
  /** Draws the value as a boolean search query, its logic highlighted. */
  highlightQuery?: boolean;
}

export function FloatingInput({
  label,
  labelAddon,
  icon,
  action,
  className,
  wrapperClassName,
  highlightQuery = false,
  ...props
}: FloatingInputProps) {
  const mirror = useMirrorScroll();
  return (
    <div className={cn("group relative", wrapperClassName)}>
      {/* Floating label */}
      <div className="absolute -top-2.5 left-3 z-10 flex items-center gap-2">
        <label
          className={cn(
            "px-1.5 py-0.5",
            "text-xs font-medium",
            "text-muted-foreground",
            "bg-background rounded",
            "transition-colors duration-200",
            "group-focus-within:text-primary"
          )}
        >
          {label}
        </label>
        {labelAddon}
      </div>

      {/* Input container */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-2",
          "border rounded-xl px-4 py-3",
          "bg-field",
          "transition-all duration-200",
          "border-border-subtle",
          "focus-within:border-primary/50",
          "focus-within:ring-2 focus-within:ring-primary/10",
          "focus-within:bg-background"
        )}
      >
        {icon && (
          <div className="flex-shrink-0 text-muted-foreground group-focus-within:text-primary/70 transition-colors">
            {icon}
          </div>
        )}

        <div className="relative flex flex-1 min-w-[200px]">
          {highlightQuery && (
            <QueryMirror ref={mirror.ref} query={String(props.value ?? "")} className="whitespace-pre text-sm" />
          )}
          <input
            className={cn(
              "w-full bg-transparent outline-none",
              "text-sm placeholder:text-muted-foreground/60",
              highlightQuery && MIRRORED_FIELD,
              className
            )}
            onScroll={mirror.sync}
            onSelect={mirror.sync}
            {...props}
          />
        </div>

        {action && (
          <div className="flex-shrink-0 flex items-center gap-2">
            {action}
          </div>
        )}
      </div>
    </div>
  );
}
