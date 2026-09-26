"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { TooltipHint } from "@/components/ui/tooltip";

interface Props {
  metadata: Record<string, string>;
}

export function DrawerMetadataTable({ metadata }: Props) {
  const t = useTranslations("billingPage.transactions.drawer.metadata");
  const [open, setOpen] = useState(false);
  const entries = Object.entries(metadata);

  if (entries.length === 0) return null;

  return (
    <section
      data-drawer-section="metadata"
      aria-labelledby="drawer-metadata-heading"
      className="rounded-lg border border-border/50"
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls="drawer-metadata-body"
        data-drawer-metadata-toggle
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span
          id="drawer-metadata-heading"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t("heading")}{" "}
          <span className="tabular-nums">({entries.length})</span>
        </span>
        {open ? (
          <ChevronDown
            className="size-3.5 text-muted-foreground"
            aria-hidden
          />
        ) : (
          <ChevronRight
            className="size-3.5 text-muted-foreground"
            aria-hidden
          />
        )}
      </button>
      {open && (
        <dl
          id="drawer-metadata-body"
          className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 pb-3 text-[11px]"
        >
          {entries.map(([key, value]) => (
            <Fragment key={key}>
              <dt
                data-metadata-key={key}
                className="whitespace-nowrap font-mono text-muted-foreground"
              >
                {key}
              </dt>
              <TooltipHint label={value} onlyWhenClipped>
                <dd className="truncate font-mono">{value}</dd>
              </TooltipHint>
            </Fragment>
          ))}
        </dl>
      )}
    </section>
  );
}
