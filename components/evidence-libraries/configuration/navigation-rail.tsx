"use client";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
export function RailGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 px-3 text-xs font-medium text-muted-foreground">
        {label}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export function RailLink({
  href,
  icon: Icon,
  active,
  danger,
  onClick,
  children,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      aria-current={active ? "location" : undefined}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={cn(
        buttonVariants({ variant: "ghost", size: "sm" }),
        "group relative w-full justify-start gap-3 overflow-hidden transition-all duration-200",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-primary shadow-sm hover:bg-sidebar-accent"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
        danger && "text-destructive hover:text-destructive",
      )}
    >
      {active ? (
        <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-primary/80 to-primary/50" />
      ) : null}
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-colors",
          active
            ? "text-primary"
            : "text-solid-primary/65 group-hover:text-primary",
          danger && "text-destructive group-hover:text-destructive",
        )}
      />
      {children}
    </a>
  );
}
