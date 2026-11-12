"use client";

// The licence a report is published under, chosen on the agreement it fills in (#1354): CC BY or CC BY-SA at one
// activation, the licences that hold back reuse or the author's own at three. A "?" says what each part of a Creative
// Commons licence means and what every one of them allows.

import { useId, type ReactNode } from "react";
import { preload } from "react-dom";
import { useFormatter, useTranslations } from "next-intl";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { FadeImage } from "@/components/ui/fade-image";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CircleHelp, ExternalLink } from "@/components/icons";
import { LogoMark } from "@/components/logo";
import { DETAIL_TEXT, LICENCE_NAME_MAX, LICENCES, LICENCE_NAMES, activationsFor, type LicenceName } from "@/lib/reports/report";
import { cn } from "@/lib/utils";

/** What the author has picked: a Creative Commons licence by name, or their own, as typed so far. */
export type LicencePick = LicenceName | { name: string; url: string };

/** The licences at one activation, offered on their own; the rest are behind "Another licence". */
const STANDARD = LICENCE_NAMES.filter((name) => LICENCES[name].activations === 1);
const OTHERS = LICENCE_NAMES.filter((name) => LICENCES[name].activations !== 1);
const OWN = "own";

/** What each choice costs in US dollars: the activation plan's price, and the three-activation one's; null while there is none. */
export type LicenceCost = { price: number | null; priceOfThree: number | null };

export function LicenceChoice({ value, onChange, cost, disabled = false }: { value: LicencePick; onChange: (pick: LicencePick) => void; cost: LicenceCost; disabled?: boolean }) {
  const t = useTranslations("publishReports.flow.licence");
  const format = useFormatter();
  const id = useId();
  const other = typeof value !== "string" || !STANDARD.includes(value);
  // Each licence by its price, whatever the balance holds: a balance pays it the same way a card does.
  const costOf = (activations: number) => {
    const price = activations === 1 ? cost.price : cost.priceOfThree;
    return price === null ? null : format.number(price, { style: "currency", currency: "USD", minimumFractionDigits: price % 1 ? 2 : 0 });
  };
  const cards = [
    ...STANDARD.map((name) => ({ id: name, title: name, body: t(name === "CC BY 4.0" ? "by" : "bySa"), activations: 1 })),
    { id: "other", title: t("other"), body: t("otherBody"), activations: activationsFor(OTHERS[0]!) },
  ];
  return (
    <div className="space-y-3">
      <span className="flex items-center gap-0.5 ps-1 text-xs font-medium text-muted-foreground">
        <span id={`${id}-label`}>{t("label")}</span>
        <LicenceHelp />
      </span>
      <RadioGroup
        aria-labelledby={`${id}-label`}
        value={other ? "other" : (value as string)}
        disabled={disabled}
        // "Another licence" opens on the first of them, which the list beneath it changes.
        onValueChange={(picked) => onChange(picked === "other" ? OTHERS[0]! : (picked as LicenceName))}
        className="gap-3 sm:grid-cols-3"
      >
        {cards.map((card) => {
          const on = card.id === "other" ? other : value === card.id;
          return (
            <label key={card.id} htmlFor={`${id}-${card.id}`} className={cn("flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors", disabled ? "opacity-60" : "cursor-pointer", on ? "border-primary bg-primary/[0.06]" : cn("border-border", !disabled && "hover:border-primary/60 hover:bg-muted/50"))}>
              <RadioGroupItem id={`${id}-${card.id}`} value={card.id} className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2 text-sm font-medium">
                  <span className="min-w-0">{card.title}</span>
                  <span className="ms-auto shrink-0 text-xs font-normal tabular-nums text-muted-foreground">{costOf(card.activations)}</span>
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{card.body}</span>
              </span>
            </label>
          );
        })}
      </RadioGroup>
      {/* Opens under the cards as it is picked, rather than pushing the agreement down in one frame. Its top space is
          inside it, so closed it takes none. */}
      <AutoHeight className="!mt-0">
        {other ? (
          <div className="grid gap-3 pt-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:items-start">
            <Select value={typeof value === "string" ? value : OWN} disabled={disabled} onValueChange={(picked) => onChange(picked === OWN ? { name: "", url: "" } : (picked as LicenceName))}>
              <SelectTrigger aria-label={t("which")} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OTHERS.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
                <SelectItem value={OWN}>{t("own")}</SelectItem>
              </SelectContent>
            </Select>
            {typeof value === "string" ? (
              <a href={LICENCES[value].url} target="_blank" rel="noreferrer license" className="inline-flex h-9 min-w-0 items-center gap-1.5 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                <span className="truncate">{LICENCES[value].title}</span>
                <ExternalLink className="size-3.5 shrink-0" />
              </a>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input value={value.name} maxLength={LICENCE_NAME_MAX} disabled={disabled} aria-label={t("ownName")} placeholder={t("ownName")} onChange={(e) => onChange({ ...value, name: e.target.value })} />
                <Input value={value.url} maxLength={DETAIL_TEXT.link} disabled={disabled} type="url" inputMode="url" aria-label={t("ownUrl")} placeholder="https://" onChange={(e) => onChange({ ...value, url: e.target.value })} />
              </div>
            )}
          </div>
        ) : null}
      </AutoHeight>
    </div>
  );
}

/** What the parts of a Creative Commons licence mean, what every one of them allows, and who is sent the licence chosen. */
function LicenceHelp() {
  const t = useTranslations("publishReports.flow.licence.help");
  // The registrars' logos are fetched with the page, so they are there when the "?" opens.
  preload("/brands/crossref.svg", { as: "image" });
  preload("/brands/zenodo.svg", { as: "image" });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t("about")} className="-my-1 size-5 shrink-0 rounded-full text-muted-foreground hover:text-foreground aria-expanded:text-primary">
          <CircleHelp className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={t("about")} className="w-80 p-0 font-normal text-foreground">
        <div className="space-y-3 p-4">
          <p className="text-sm font-semibold">{t("title")}</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm/5">
            {(["by", "sa", "nc", "nd"] as const).map((part) => (
              <div key={part} className="contents">
                <dt className="font-mono text-xs/5 font-medium">{part.toUpperCase()}</dt>
                <dd className="text-pretty text-muted-foreground">{t(part)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs/5 text-pretty text-muted-foreground">{t("mining")}</p>
        </div>
        <a href="https://creativecommons.org/licenses/" target="_blank" rel="noopener noreferrer" className="group mx-1.5 mb-1.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-accent">
          <span className="min-w-0 flex-1 text-sm/5 font-medium">{t("compare")}</span>
          <ExternalLink className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
        </a>
        <div className="rounded-b-[inherit] border-t border-border-subtle bg-inset/60 p-1.5 text-xs font-medium">
          <p className="px-2.5 pt-1.5 pb-1 text-muted-foreground">{t("sentTo")}</p>
          <ul>
            <Taker name="Crossref" does={t("crossref")} href="https://www.crossref.org/">
              <FadeImage src="/brands/crossref.svg" className="h-4 w-[47px]" />
            </Taker>
            <Taker name="Zenodo" does={t("zenodo")} href="https://zenodo.org/">
              <FadeImage src="/brands/zenodo.svg" className="h-4 w-11" />
            </Taker>
            <Taker name="Openscholar" does={t("openscholar")}>
              <LogoMark className="size-4" />
              Openscholar
            </Taker>
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** One of those the licence is sent to, with what it does with the report. */
function Taker({ name, does, href, children }: { name: string; does: string; href?: string; children: ReactNode }) {
  const body = (
    <>
      <span className="flex h-5 w-24 shrink-0 items-center gap-1.5" aria-label={href ? undefined : name}>
        {children}
      </span>
      <span className="min-w-0 flex-1 font-normal text-muted-foreground">{does}</span>
      {href ? <ExternalLink className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" /> : null}
    </>
  );
  return (
    <li>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${name}: ${does}`} className="group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-accent">
          {body}
        </a>
      ) : (
        <span className="flex items-center gap-2.5 px-2.5 py-1.5">{body}</span>
      )}
    </li>
  );
}
