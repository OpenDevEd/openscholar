"use client";

// The licence a report is published under, chosen on the agreement it fills in (#1354): CC BY or CC BY-SA at the
// standard price, the licences that hold back reuse or the author's own at the other. A "?" says what each part of a Creative
// Commons licence means and what every one of them allows.

import { useId, type ReactNode } from "react";
import { preload } from "react-dom";
import { useTranslations } from "next-intl";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { FadeImage } from "@/components/ui/fade-image";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CircleHelp, ExternalLink } from "@/components/icons";
import { LogoMark } from "@/components/logo";
import { useMoney } from "@/lib/hooks/use-money";
import { DETAIL_TEXT, LICENCE_NAME_MAX, LICENCES, LICENCE_NAMES, pickedLicence, priceOf, type LicenceName, type Prices } from "@/lib/reports/report";
import { cn } from "@/lib/utils";

/** What the author has picked: a Creative Commons licence by name, or their own, as typed and answered so far. */
export type LicencePick = LicenceName | { name: string; url: string; /** Whether it lets anyone share the report: unanswered until the author says. */ open?: boolean };

/** The licences at the standard price, offered on their own; the rest are behind "Another licence". */
const STANDARD = LICENCE_NAMES.filter((name) => LICENCES[name].tier === "standard");
const OTHERS = LICENCE_NAMES.filter((name) => LICENCES[name].tier !== "standard");
const OWN = "own";


export function LicenceChoice({ value, onChange, prices, disabled = false }: { value: LicencePick; onChange: (pick: LicencePick) => void; /** What a report costs under each kind of licence, in US dollars. */ prices: Prices; disabled?: boolean }) {
  const t = useTranslations("publishReports.flow.licence");
  const id = useId();
  const other = typeof value !== "string" || !STANDARD.includes(value);
  // Each licence by its price, whatever pays it: what picking one leaves to pay is the bill's to say.
  const dollars = useMoney();
  const cards = [
    ...STANDARD.map((name) => ({ id: name, title: name, body: t(name === "CC BY 4.0" ? "by" : "bySa"), price: prices.standard })),
    // An own licence that isn't open has its own price, which its card shows once the author says so.
    { id: "other", title: t("other"), body: t("otherBody"), price: other ? priceOf(pickedLicence(value), prices) : prices.other },
  ];
  return (
    <div className="space-y-3">
      {/* Named as the step's other sections are. */}
      <h3 className="flex items-center gap-1 text-sm font-semibold">
        <span id={`${id}-label`}>{t("label")}</span>
        <LicenceHelp />
      </h3>
      <RadioGroup
        aria-labelledby={`${id}-label`}
        value={other ? "other" : (value as string)}
        disabled={disabled}
        // "Another licence" opens on the first of them, which the list beneath it changes.
        onValueChange={(picked) => onChange(picked === "other" ? OTHERS[0]! : (picked as LicenceName))}
        className="grid-cols-1 gap-3 sm:grid-cols-3"
      >
        {cards.map((card) => (
          <PricedCard key={card.id} id={`${id}-${card.id}`} value={card.id} on={card.id === "other" ? other : value === card.id} disabled={disabled} title={card.title} price={dollars(card.price)} body={card.body} />
        ))}
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
            {typeof value === "string" ? null : <OwnOpen value={value.open} prices={prices} disabled={disabled} onChange={(open) => onChange({ ...value, open })} />}
          </div>
        ) : null}
      </AutoHeight>
    </div>
  );
}

/** One choice of the step's: its title with its price, and what it means beneath. */
function PricedCard({ id, value, on, disabled, title, price, body }: { id: string; value: string; on: boolean; disabled: boolean; title: string; price: string; body: string }) {
  return (
    <label htmlFor={id} className={cn("flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors", disabled ? "opacity-60" : "cursor-pointer", on ? "border-primary bg-primary/[0.06]" : cn("border-border", !disabled && "hover:border-foreground/25 hover:bg-muted/50"))}>
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
          <span className="min-w-0 break-words">{title}</span>
          <span className="ms-auto shrink-0 text-xs font-normal tabular-nums text-muted-foreground">{price}</span>
        </span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{body}</span>
      </span>
    </label>
  );
}

/**
 * Whether the author's own licence lets anyone share the report: the answer sets its price and who may get its file,
 * so each answer shows both, as the licences above do.
 */
function OwnOpen({ value, onChange, prices, disabled }: { value: boolean | undefined; onChange: (open: boolean) => void; prices: Prices; disabled: boolean }) {
  const t = useTranslations("publishReports.flow.licence");
  const dollars = useMoney();
  const id = useId();
  return (
    <div className="space-y-2 sm:col-span-2">
      <p id={`${id}-label`} className="text-sm font-medium">
        {t("ownOpen")}
      </p>
      <RadioGroup aria-labelledby={`${id}-label`} value={value === undefined ? "" : value ? "yes" : "no"} disabled={disabled} onValueChange={(answer) => onChange(answer === "yes")} className="grid-cols-1 gap-3 sm:grid-cols-2">
        <PricedCard id={`${id}-yes`} value="yes" on={value === true} disabled={disabled} title={t("ownOpenYes")} price={dollars(prices.other)} body={t("ownOpenYesBody")} />
        <PricedCard id={`${id}-no`} value="no" on={value === false} disabled={disabled} title={t("ownOpenNo")} price={dollars(prices.closed)} body={t("ownOpenNoBody")} />
      </RadioGroup>
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
