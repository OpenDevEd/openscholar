"use client";

// Where a report's permanent copy is kept (#1237): in Openscholar's Zenodo account, or the author's own. A DOI has
// to lead to the work for good, and the Crossref terms ask whoever registers it to have it kept in an archive. Either
// way the report keeps its Crossref DOI. The "?" says why there is an archive at all.

import { ZenodoMark } from "@/components/icons/zenodo-mark";
import { useId } from "react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CircleHelp, ExternalLink, PersonIcon } from "@/components/icons";
import { LogoMark } from "@/components/logo";
import { EASE } from "@/components/ui/opening";
import type { ZenodoAccount } from "@/lib/mock/zenodo-account";
import { cn } from "@/lib/utils";

export type Archive = "openscholar" | "own";

export function ArchiveChoice({ value, onChange, account, onConnect, connecting = false, disabled = false }: { value: Archive; onChange: (archive: Archive) => void; /** The author's Zenodo account, null when none is connected. */ account: ZenodoAccount | null; /** Goes to Zenodo to connect it, and comes back here. */ onConnect: () => void; /** On its way to Zenodo. */ connecting?: boolean; disabled?: boolean }) {
  const t = useTranslations("publishReports.flow.archive");
  const id = useId();
  const cards = [
    { id: "openscholar" as const, title: t("openscholar"), body: t("openscholarBody"), mark: <LogoMark className="size-5" /> },
    { id: "own" as const, title: t("own"), body: account ? null : t("ownBody"), mark: <ZenodoMark className="size-5 rounded-[5px]" /> },
  ];
  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1 text-sm font-semibold">
        <span id={`${id}-label`}>{t("label")}</span>
        <ArchiveHelp />
      </h3>
      <RadioGroup aria-labelledby={`${id}-label`} value={value} disabled={disabled} onValueChange={(picked) => onChange(picked as Archive)} className="grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map((card) => {
          const on = value === card.id;
          return (
            <label key={card.id} htmlFor={`${id}-${card.id}`} className={cn("flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors", disabled ? "opacity-60" : "cursor-pointer", on ? "border-primary bg-primary/[0.06]" : cn("border-border", !disabled && "hover:border-foreground/25 hover:bg-muted/50"))}>
              <RadioGroupItem id={`${id}-${card.id}`} value={card.id} className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span className="min-w-0 truncate">{card.title}</span>
                  <span className="ms-auto shrink-0">{card.mark}</span>
                </span>
                {/* The account it goes to, once one is connected: its name in place of what connecting would do. */}
                {card.id === "own" && account ? (
                  <motion.span key="account" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25, ease: EASE }} className="mt-0.5 flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
                    <PersonIcon className="size-3.5 shrink-0" />
                    <span className="truncate">{account.name}</span>
                  </motion.span>
                ) : (
                  <span className="mt-0.5 block text-sm text-muted-foreground">{card.body}</span>
                )}
              </span>
            </label>
          );
        })}
      </RadioGroup>
      {/* Their own account picked and none connected yet: connecting opens under the cards, rather than pushing the
          agreement down in one frame. Its top space is inside it, so closed it takes none. */}
      <AutoHeight className="!mt-0">
        {value === "own" && !account ? (
          <div className="pt-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-inset px-3.5 py-3">
              <p className="min-w-0 flex-1 basis-56 text-sm text-pretty">{t("connectFirst")}</p>
              <Button size="sm" className="relative" disabled={disabled || connecting} onClick={onConnect}>
                <ZenodoMark className="size-4 rounded-[4px]" />
                {t("connect")}
              </Button>
            </div>
          </div>
        ) : null}
      </AutoHeight>
    </div>
  );
}

/** Why a report with a DOI is archived, and what the archive keeps. */
function ArchiveHelp() {
  const t = useTranslations("publishReports.flow.archive.help");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t("about")} className="-my-1 size-5 shrink-0 rounded-full text-muted-foreground hover:text-foreground aria-expanded:text-primary">
          <CircleHelp className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={t("about")} className="w-80 p-0 font-normal text-foreground">
        <div className="space-y-2 p-4">
          <p className="text-sm font-semibold">{t("title")}</p>
          <p className="text-sm text-pretty text-muted-foreground">{t("why")}</p>
          <p className="text-sm text-pretty text-muted-foreground">{t("same")}</p>
        </div>
        <a href="https://about.zenodo.org/policies/" target="_blank" rel="noopener noreferrer" className="group mx-1.5 mb-1.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-accent">
          <ZenodoMark className="size-4 rounded-[4px]" />
          <span className="min-w-0 flex-1 text-sm/5 font-medium">{t("policies")}</span>
          <ExternalLink className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
        </a>
      </PopoverContent>
    </Popover>
  );
}
