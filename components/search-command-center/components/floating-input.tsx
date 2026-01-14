"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface FloatingInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  wrapperClassName?: string;
}

export function FloatingInput({
  label,
  icon,
  action,
  className,
  wrapperClassName,
  ...props
}: FloatingInputProps) {
  return (
    <div className={cn("group relative", wrapperClassName)}>
      {/* Floating label */}
      <label
        className={cn(
          "absolute -top-2.5 left-3 z-10 px-1.5 py-0.5",
          "text-xs font-medium",
          "text-muted-foreground",
          "bg-background rounded",
          "transition-colors duration-200",
          "group-focus-within:text-primary"
        )}
      >
        {label}
      </label>

      {/* Input container */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-2",
          "border rounded-xl px-4 py-3",
          "bg-background/50",
          "transition-all duration-200",
          "border-border/60",
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

        <input
          className={cn(
            "flex-1 min-w-[200px] bg-transparent outline-none",
            "text-sm placeholder:text-muted-foreground/60",
            className
          )}
          {...props}
        />

        {action && (
          <div className="flex-shrink-0 flex items-center gap-2">
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

interface FloatingTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  wrapperClassName?: string;
  flash?: boolean;
}

export function FloatingTextarea({
  label,
  className,
  wrapperClassName,
  flash,
  ...props
}: FloatingTextareaProps) {
  return (
    <div className={cn("group relative", wrapperClassName)}>
      {/* Floating label */}
      <label
        className={cn(
          "absolute -top-2.5 left-3 z-10 px-1.5 py-0.5",
          "text-xs font-medium",
          "text-muted-foreground",
          "bg-background rounded",
          "transition-colors duration-200",
          "group-focus-within:text-primary"
        )}
      >
        {label}
      </label>

      {/* Textarea container */}
      <div
        className={cn(
          "border rounded-xl px-4 py-3",
          "bg-background/50",
          "transition-all duration-300",
          "border-border/60",
          "focus-within:border-primary/50",
          "focus-within:ring-2 focus-within:ring-primary/10",
          "focus-within:bg-background",
          flash && "bg-green-50 border-green-400 dark:bg-green-950/30 dark:border-green-600"
        )}
      >
        <textarea
          className={cn(
            "w-full bg-transparent outline-none resize-y",
            "text-sm placeholder:text-muted-foreground/60",
            "min-h-[100px]",
            className
          )}
          {...props}
        />
      </div>
    </div>
  );
}
