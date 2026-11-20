"use client";

// How the publishing steps behave as forms (docs: memory publish-forms-rules): a field that is wrong says so under
// itself once Next was pressed, and Next takes the person to the first such field instead of being shut.

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** What is wrong with a field, under it. `id` is what the field names in `aria-describedby`. */
export function FieldMessage({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <p id={id} className={cn("pt-1.5 ps-1 text-xs text-destructive", className)}>
      {children}
    </p>
  );
}

/**
 * A step's form, the same on every step: its way on (Next, Sign, Save) is never shut for what the person hasn't done
 * yet, only while it works. Pressed, `go` goes on when none of `wrong` is a field's id; otherwise `tried` turns on the
 * messages at the fields and the person is taken to the first. Pass each check as `wrong && fieldId`.
 */
export function useStepForm() {
  const [tried, setTried] = useState(false);
  const go = (wrong: ReadonlyArray<string | false | null | undefined>, onward: () => void) => {
    const fields = wrong.filter((field): field is string => !!field);
    if (!fields.length) return onward();
    setTried(true);
    goToFirst(fields);
  };
  return { tried, go };
}

/**
 * Takes the person to the first of these fields that is on the page: scrolled to the middle of the window, and focused
 * so a screen reader reads its message. Answers whether there was one.
 */
export function goToFirst(ids: readonly string[]): boolean {
  for (const id of ids) {
    const field = document.getElementById(id);
    if (!field) continue;
    field.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    field.focus({ preventScroll: true });
    return true;
  }
  return false;
}
