"use client";

import type { ComponentProps } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Working } from "@/components/settings/parts";
import { TooltipHint } from "@/components/ui/tooltip";
import { useShutNext } from "@/components/reports/intake-notice";
import { cn } from "@/lib/utils";

/** A step's way on: "Next" in a lighter end, then the step it leads to, as the Pay button sets its price apart. */
/** A step's way on: shut only while it works (`busy`), never for what is missing, which a press says at the fields (`useStepForm`), and while new reports are closed (`IntakeShut`). */
export function NextButton({ children, busy = false, className, disabled, ...props }: ComponentProps<typeof Button> & { busy?: boolean }) {
  const t = useTranslations("publishReports.flow");
  // New reports closed: a draft waits for the next period, and says why beside its way on.
  const shut = useShutNext();
  const button = (
    // On a phone a long step ("Hlola imininingwane", or any at large text) wraps inside the button rather than leaving the card.
    <Button className={cn("relative gap-0 overflow-hidden p-0 has-[>svg]:px-0 max-sm:h-auto max-sm:max-w-full max-sm:shrink max-sm:whitespace-normal", className)} disabled={busy || disabled || !!shut} {...props}>
      <Working busy={busy}>
        <span className="flex h-9 items-stretch max-sm:h-auto max-sm:min-h-9 max-sm:flex-wrap">
          <span className="flex shrink-0 items-center bg-white/25 ps-3 pe-2.5 font-normal max-sm:max-w-full max-sm:[overflow-wrap:anywhere]">{t("next")}</span>
          <span className="flex min-w-0 items-center gap-2 ps-3 pe-3.5 max-sm:grow max-sm:justify-between max-sm:py-1.5 max-sm:text-start max-sm:[overflow-wrap:anywhere]">
            {children}
            {/* Where Back keeps only its arrow (StepNav), this one goes: "Next" says it, and the words need the room. */}
            <ArrowRight className="@max-[18rem]/nav:hidden" />
          </span>
        </span>
      </Working>
    </Button>
  );
  return shut ? (
    <TooltipHint label={shut}>
      <span tabIndex={0} className="min-w-0">
        {button}
      </span>
    </TooltipHint>
  ) : (
    button
  );
}
