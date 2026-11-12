"use client";

import type { ComponentProps } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Working } from "@/components/settings/parts";
import { cn } from "@/lib/utils";

/** A step's way on: "Next" in a lighter end, then the step it leads to, as the Pay button sets its price apart. */
export function NextButton({ children, busy = false, className, ...props }: ComponentProps<typeof Button> & { busy?: boolean }) {
  const t = useTranslations("publishReports.flow");
  return (
    <Button className={cn("relative gap-0 overflow-hidden p-0 has-[>svg]:px-0", className)} {...props}>
      <Working busy={busy}>
        <span className="flex h-9 items-stretch">
          <span className="flex items-center bg-white/25 ps-3 pe-2.5 font-normal">{t("next")}</span>
          <span className="flex items-center gap-2 ps-3 pe-3.5">
            {children}
            <ArrowRight />
          </span>
        </span>
      </Working>
    </Button>
  );
}
