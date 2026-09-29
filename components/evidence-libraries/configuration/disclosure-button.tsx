"use client";

import { ChevronRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * The one way the configuration page shows and hides extra detail: a small
 * muted label led by a chevron that turns down while `aria-expanded`. Inside a
 * `Collapsible`, use `DisclosureTrigger` and `DisclosureContent` (or
 * `Disclosure`) so the content slides open to its height.
 */
export function DisclosureButton({ className, children, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("group/disclosure -ml-2 h-7 text-xs font-medium text-muted-foreground hover:text-foreground", className)}
      {...props}
    >
      <ChevronRight className="h-3.5 w-3.5 transition-transform group-aria-expanded/disclosure:rotate-90" />
      {children}
    </Button>
  );
}

export function DisclosureTrigger({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <CollapsibleTrigger asChild>
      <DisclosureButton className={className}>{children}</DisclosureButton>
    </CollapsibleTrigger>
  );
}

export function DisclosureContent({ children }: { children: ReactNode }) {
  return (
    <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none">
      {children}
    </CollapsibleContent>
  );
}

export function Disclosure({
  open,
  onOpenChange,
  label,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className={className}>
      <DisclosureTrigger>{label}</DisclosureTrigger>
      <DisclosureContent>{children}</DisclosureContent>
    </Collapsible>
  );
}
