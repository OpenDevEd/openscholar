"use client";

// Where a report's permanent copy is kept (#1237): in Openscholar's Zenodo account, or the author's own. A DOI has
// to lead to the work for good, and the Crossref terms ask whoever registers it to have it kept in an archive. Either
// way the report keeps its Crossref DOI. The "?" says why there is an archive at all.

import { ZenodoMark } from "@/components/icons/zenodo-mark";
import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CircleHelp, ExternalLink, PersonIcon } from "@/components/icons";
import { LogoMark } from "@/components/logo";
import { EASE } from "@/components/ui/opening";
import { useConnectZenodo, useZenodoAccount, type ZenodoAccount } from "@/lib/zenodo/account";
import { cn } from "@/lib/utils";

export type Archive = "openscholar" | "own";

/** Why their Zenodo account is wanted, beside the button that connects it: under the archive choice, and on a live report its own account refused. */
function ConnectZenodoBox({ id, invalid = false, disabled = false, onConnect, children }: { /** The button's, for a step's Next to take the person to. */ id?: string; invalid?: boolean; disabled?: boolean; onConnect: () => void; children: ReactNode }) {
  const t = useTranslations("publishReports.flow.archive");
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-inset px-3.5 py-3", invalid ? "border-destructive" : "border-transparent")}>
      <p id={id ? `${id}-why` : undefined} className={cn("min-w-0 flex-1 basis-56 text-sm text-pretty", invalid && "text-destructive")}>{children}</p>
      <Button id={id} aria-describedby={id ? `${id}-why` : undefined} size="sm" className="relative" disabled={disabled} onClick={onConnect}>
        <ZenodoMark className="size-4 rounded-[4px]" />
        {t("connect")}
      </Button>
    </div>
  );
}

/**
 * A live report whose copy its author's own Zenodo account refused: why, and their way on. A connection Zenodo stopped
 * taking is theirs to connect again, which sends the report there at once (convex/zenodo/connection.ts); anything else
 * Openscholar's team hears of and sends again.
 */
export function OwnArchiveRefused() {
  const t = useTranslations("publishReports.flow.archive");
  const account = useZenodoAccount();
  const connect = useConnectZenodo();
  const [connecting, setConnecting] = useState(false);
  if (account === undefined) return null;
  if (account && !account.broken) return <p className="pt-3 text-xs text-muted-foreground">{t("refusedTeam")}</p>;
  return (
    <div className="pt-3">
      <ConnectZenodoBox
        disabled={connecting}
        onConnect={() => {
          // A window of its own, so the report's page stays as it is while Zenodo is connected.
          setConnecting(true);
          void connect(window.location.pathname + window.location.search, { window: true }).finally(() => setConnecting(false));
        }}
      >
        {t("refusedReconnect")}
      </ConnectZenodoBox>
    </div>
  );
}

export function ArchiveChoice({ value, onChange, account: held, onConnect, connecting = false, disabled = false, connectId, invalid = false }: { value: Archive; onChange: (archive: Archive) => void; /** The author's Zenodo account, null when none is connected. */ account: ZenodoAccount | null; /** Goes to Zenodo to connect it, and comes back here. */ onConnect: () => void; /** On its way to Zenodo. */ connecting?: boolean; disabled?: boolean; /** The Connect button, for the step's Next to take the person to. */ connectId?: string; /** Next was pressed with their own account picked and none connected. */ invalid?: boolean }) {
  const t = useTranslations("publishReports.flow.archive");
  const id = useId();
  // One Zenodo stopped accepting is no account to archive in: connecting again is asked for, saying why.
  const account = held && !held.broken ? held : null;
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
                    <span className="truncate">{account.name ?? (account.zenodoUserId ? `Zenodo ${account.zenodoUserId}` : "Zenodo")}</span>
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
            <ConnectZenodoBox id={connectId} invalid={invalid} disabled={disabled || connecting} onConnect={onConnect}>
              {t(held?.broken ? "broken" : "connectFirst")}
            </ConnectZenodoBox>
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
