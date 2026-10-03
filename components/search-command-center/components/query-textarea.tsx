"use client";

import React from "react";
import { Loader2, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface QueryTextareaProps {
  label: string;
  /** Extra content rendered inline after the label text (e.g. history nav) */
  labelAddon?: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** Enter submits, Shift+Enter adds a line. */
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  busy?: boolean;
  allowEmpty?: boolean;
  /** Briefly tints the field green after the query was rewritten. */
  flash?: boolean;
}

/** The command center's query box: several lines, key hints and the Search button. */
export function QueryTextarea({
  label,
  labelAddon,
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
  busy = false,
  allowEmpty = false,
  flash = false,
}: QueryTextareaProps) {
  const t = useTranslations();
  const th = useTranslations("home");
  const canSubmit = !disabled && !busy && (allowEmpty || Boolean(value.trim()));
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit();
      }}
    >
      <div className="group relative">
        <div className="absolute -top-2.5 left-3 z-10 flex items-center gap-2">
          <span
            className={cn(
              "px-1.5 py-0.5 text-xs font-medium",
              "text-muted-foreground bg-background rounded",
              "transition-colors duration-200",
              "group-focus-within:text-primary"
            )}
          >
            {label}
          </span>
          {labelAddon}
        </div>

        <div
          className={cn(
            "border rounded-xl px-3 py-2.5",
            "bg-background/50",
            "transition-all duration-300",
            "border-border/60",
            "focus-within:border-primary/50",
            "focus-within:ring-2 focus-within:ring-primary/10",
            "focus-within:bg-background",
            flash && "bg-success/10 border-success"
          )}
        >
          <textarea
            aria-label={label}
            className="w-full bg-transparent outline-none resize-none text-sm placeholder:text-muted-foreground/60 min-h-[60px]"
            placeholder={placeholder}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={disabled || busy}
          />

          {/* Bottom bar: hints + search button (same as home screen) */}
          <div className="flex flex-wrap items-center justify-end md:justify-between gap-2 pt-1.5 border-t border-border/40">
            <div className="text-xs text-muted-foreground hidden md:flex flex-wrap items-center gap-2 shrink-0 order-2 md:order-1">
              <span className="px-1.5 py-0.5 rounded-md bg-muted/50 border border-border/50 font-mono">
                {th("enterKey")}
              </span>
              {th("toSubmit")}
              <span className="mx-1 opacity-20">|</span>
              <span className="px-1.5 py-0.5 rounded-md bg-muted/50 border border-border/50 font-mono">
                {th("shiftEnterKey")}
              </span>
              {th("newLine")}
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={!canSubmit}
              className={cn("order-1 md:order-2 h-7 px-3 text-xs")}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Search className="h-3.5 w-3.5 mr-1.5" />
              )}
              {t("common.search")}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
