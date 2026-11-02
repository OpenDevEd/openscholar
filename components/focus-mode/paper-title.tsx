"use client";

import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A paper's title, which opens the paper in focus mode, stepping through the list it's in.
 * `className` styles the words: a clamp or truncation applies to them, inside the button.
 */
export function PaperTitle({ title, onOpen, className, children, ...props }: { title: string; onOpen: () => void; className?: string; children?: ReactNode } & Omit<ComponentProps<"button">, "title" | "onClick" | "className">) {
  return (
    <button
      type="button"
      {...props}
      onClick={(event) => {
        // A row that selects or opens its paper on a click leaves this one to the title.
        event.stopPropagation();
        onOpen();
      }}
      // Positioned and taking the pointer, so it sits above a row-wide button that a list draws under its rows.
      className="group/title pointer-events-auto relative block max-w-full rounded-sm text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span
        className={cn(
          "block text-sm font-medium leading-snug underline decoration-transparent underline-offset-2 transition-[text-decoration-color] group-hover/title:decoration-muted-foreground/60",
          className,
        )}
      >
        {children ?? title}
      </span>
    </button>
  );
}
