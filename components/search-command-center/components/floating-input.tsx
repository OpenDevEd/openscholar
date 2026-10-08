"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { experimental_RichInput as RichInput } from "rich-textarea";
import { queryRenderer, useQueryFieldStyle } from "@/components/query-highlight";

interface FloatingInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "defaultValue"> {
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
  const fieldStyle = useQueryFieldStyle();
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

        <div className="flex flex-1 min-w-[200px]">
          <RichInput
            className={cn(
              "w-full bg-transparent outline-none",
              "text-sm placeholder:text-muted-foreground/60",
              className
            )}
            style={fieldStyle}
            {...props}
          >
            {queryRenderer(highlightQuery)}
          </RichInput>
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
