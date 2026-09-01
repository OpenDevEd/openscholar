"use client";

import {
  Copy01Icon,
  SquareArrowUpRight02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** A library address that can be opened or copied wherever it is shown. */
export function LibraryAddressLink({
  address,
  className,
}: {
  address: string;
  className?: string;
}) {
  const t = useTranslations("evidenceLibraries.setup.live");
  const host = address.replace(/^https?:\/\//, "");

  async function copyAddress() {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(address);
      toast.success(t("copied"), { description: address });
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <a
        href={address}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-w-0 items-center gap-1 hover:text-foreground hover:underline"
        data-library-address
      >
        <span className="truncate">{host}</span>
        <HugeiconsIcon
          icon={SquareArrowUpRight02Icon}
          size={14}
          className="shrink-0"
          aria-hidden
        />
      </a>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0"
            aria-label={t("copyAddress")}
            onClick={() => void copyAddress()}
          >
            <HugeiconsIcon icon={Copy01Icon} size={14} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("copyAddress")}</TooltipContent>
      </Tooltip>
    </span>
  );
}
