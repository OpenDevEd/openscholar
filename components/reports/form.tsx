"use client";

// How the publishing steps behave as forms (docs: memory publish-forms-rules): a field that is wrong says so under
// itself once Next was pressed, and Next takes the person to the first such field instead of being shut.

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A step's foot, the same on every step: Back and the step's way on (`next`) on one row at the bottom of the step, which
 * fills the card (publish-flow.tsx `Screens`). Its other ways (`between`: Ask for a review, Change the details) sit
 * between them, or on a phone in a row of their own above, so Back and the way on always share the bottom row.
 */
export function StepNav({ onBack, backDisabled, between, next }: { onBack?: () => void; backDisabled?: boolean; between?: ReactNode; next?: ReactNode }) {
  const t = useTranslations("publishReports.flow");
  return (
    <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-6">
      {onBack ? (
        <Button variant="ghost" className="order-1 -ms-3 shrink-0 text-muted-foreground" disabled={backDisabled} onClick={onBack}>
          <ArrowLeft /> {t("back")}
        </Button>
      ) : null}
      {between ? <div className="order-2 ms-auto flex flex-wrap items-center justify-end gap-2 max-sm:order-none max-sm:basis-full">{between}</div> : null}
      <div className={cn("order-3 flex min-w-0 items-center justify-end gap-2", between ? "max-sm:ms-auto" : "ms-auto")}>{next}</div>
    </div>
  );
}

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
