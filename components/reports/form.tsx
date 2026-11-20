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
    <div className="@container/nav mt-auto flex flex-col gap-2 pt-6 sm:flex-row sm:items-center sm:gap-3">
      {/* On a phone what goes between has a row of its own, above; on a wide page it sits between Back and the way on. */}
      {between ? <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:order-2 sm:ms-auto">{between}</div> : null}
      {/* Back and the way on share one row at every width: a long way on wraps its own words (NextButton), never the row,
          and where even that is too narrow (a small phone, large text) Back keeps its arrow and its name only for screen readers. */}
      <div className="flex items-center gap-3 sm:contents">
        {onBack ? (
          <Button variant="ghost" className="-ms-3 shrink-0 text-muted-foreground sm:order-1" disabled={backDisabled} onClick={onBack}>
            <ArrowLeft /> <span className="@max-[18rem]/nav:sr-only">{t("back")}</span>
          </Button>
        ) : null}
        <div className={cn("ms-auto flex min-w-0 items-center justify-end gap-2 sm:order-3", between && "sm:ms-0")}>{next}</div>
      </div>
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
