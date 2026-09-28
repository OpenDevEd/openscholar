"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The one way the configuration page shows and hides extra detail: a small
 * muted label led by a chevron that turns down when open. The content it
 * controls is rendered by the caller while `open`.
 */
export function DisclosureButton({
  open,
  onToggle,
  controls,
  className,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  /** The id of the content this shows and hides. */
  controls?: string;
  className?: string;
  children: ReactNode;
}) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("-ml-2 h-7 text-xs font-medium text-muted-foreground hover:text-foreground", className)}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      <Chevron className="h-3.5 w-3.5" />
      {children}
    </Button>
  );
}
