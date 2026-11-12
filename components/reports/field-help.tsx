"use client";

// The "?" beside the parts of a report's details and the publish steps. Each says what the part is, how it was filled
// in, whether its values come from a list, where that list lives (with links), and which registrars receive it. The
// words are in messages/ under publishReports.help.

import { createContext, useContext, type ReactNode } from "react";
import { preload } from "react-dom";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FadeImage } from "@/components/ui/fade-image";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AiIcon, Check, CircleCheck, CircleHelp, ExternalLink, Globe, ListChecks, Lock, Minus, Pencil, Search, type AppIcon } from "@/components/icons";
import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import { OrcidIcon, RorIcon } from "@/components/icons/author-service-icons";
import { LogoMark } from "@/components/logo";
import { useIsMobile } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/** How a part was filled in before its author saw it. */
const FILLED = { pdf: AiIcon, judged: AiIcon, matched: Search, classified: AiIcon, author: Pencil, fixed: Lock, reserved: Lock } as const satisfies Record<string, AppIcon>;
/** What can be entered in it. */
const ENTRY = { list: ListChecks, typed: Pencil, either: ListChecks, pasted: Pencil, toggle: Check, chosen: Check } as const satisfies Record<string, AppIcon>;

type Mark = "openalex" | "orcid" | "ror" | "web";
const CROSSREF = "https://www.crossref.org/documentation/schema-library/markup-guide-metadata-segments";
/** Where each list or registry behind a part lives; its name and what it is for are in messages/. */
const SOURCES = {
  openalexWorkTypes: { mark: "openalex", href: "https://help.openalex.org/data/works/attributes/" },
  zenodoTypes: { mark: "web", href: "https://help.zenodo.org/docs/deposit/describe-records/resource-type/" },
  crossrefReports: { mark: "web", href: "https://www.crossref.org/documentation/schema-library/markup-guide-record-types/reports-and-working-papers/" },
  iso639: { mark: "web", href: "https://www.loc.gov/standards/iso639-2/php/code_list.php" },
  ccBy: { mark: "web", href: "https://creativecommons.org/licenses/by/4.0/" },
  crossrefContributors: { mark: "web", href: `${CROSSREF}/contributors/` },
  crossrefRoles: { mark: "web", href: `${CROSSREF}/contributors/` },
  orcid: { mark: "orcid", href: "https://info.orcid.org/what-is-orcid/" },
  orcidRegister: { mark: "orcid", href: "https://orcid.org/register" },
  openalexInstitutions: { mark: "openalex", href: "https://help.openalex.org/data/institutions/" },
  ror: { mark: "ror", href: "https://ror.org/" },
  rorAdd: { mark: "ror", href: "https://curation-request.ror.org/" },
  credit: { mark: "web", href: "https://credit.niso.org/" },
  crossrefAbstracts: { mark: "web", href: `${CROSSREF}/abstracts/` },
  openalexTopics: { mark: "openalex", href: "https://help.openalex.org/data/topics/" },
  sdgs: { mark: "web", href: "https://sdgs.un.org/goals" },
  openalexDesigns: { mark: "openalex", href: "https://help.openalex.org/data/study-designs/" },
  iso3166: { mark: "web", href: "https://www.iso.org/iso-3166-country-codes.html" },
  openalexFunders: { mark: "openalex", href: "https://help.openalex.org/data/funders/" },
  rorFunders: { mark: "ror", href: "https://ror.org/" },
  funderRegistry: { mark: "web", href: "https://www.crossref.org/services/funder-registry/" },
  doi: { mark: "web", href: "https://www.doi.org/" },
  crossrefReferences: { mark: "web", href: `${CROSSREF}/references/` },
  crossrefRelations: { mark: "web", href: `${CROSSREF}/relationships/` },
  issn: { mark: "web", href: "https://www.issn.org/understanding-the-issn/what-is-an-issn/" },
} as const satisfies Record<string, { mark: Mark; href: string }>;
type SourceKey = keyof typeof SOURCES;

type Help = {
  /** Whether messages/ hold a note for it: one more fact worth knowing, such as what happens when the PDF has none. */
  note?: true;
  filled?: keyof typeof FILLED;
  entry?: keyof typeof ENTRY;
  sources?: readonly SourceKey[];
  /** Whether each registrar is sent it; a part that is never sent anywhere, such as a step, says neither. */
  sent?: { crossref: boolean; zenodo: boolean };
};
const BOTH = { crossref: true, zenodo: true } as const;

/** Each part's facts. Its title, what it is and its note are in messages/ under publishReports.help.parts. */
const HELP = {
  title: { filled: "pdf", entry: "typed", sent: BOTH },
  subtitle: { note: true, filled: "pdf", entry: "typed", sent: BOTH },
  type: { note: true, filled: "pdf", entry: "list", sources: ["openalexWorkTypes", "zenodoTypes", "crossrefReports"], sent: { crossref: false, zenodo: true } },
  language: { filled: "pdf", entry: "list", sources: ["iso639"], sent: BOTH },
  date: { note: true, filled: "pdf", entry: "typed", sent: BOTH },
  licence: { filled: "fixed", sources: ["ccBy"], sent: BOTH },
  authors: { note: true, filled: "pdf", entry: "typed", sources: ["crossrefContributors"], sent: BOTH },
  name: { note: true, filled: "pdf", entry: "typed", sent: BOTH },
  kind: { note: true, filled: "author", entry: "list", sources: ["crossrefRoles"], sent: BOTH },
  orcid: { note: true, filled: "matched", entry: "either", sources: ["orcid", "orcidRegister"], sent: BOTH },
  affiliations: { note: true, filled: "matched", entry: "either", sources: ["openalexInstitutions", "ror", "rorAdd"], sent: BOTH },
  contributions: { note: true, filled: "pdf", entry: "list", sources: ["credit"], sent: { crossref: true, zenodo: false } },
  corresponding: { note: true, filled: "pdf", entry: "toggle", sources: ["crossrefRoles"], sent: BOTH },
  abstract: { note: true, filled: "pdf", entry: "typed", sources: ["crossrefAbstracts"], sent: BOTH },
  topics: { note: true, filled: "classified", entry: "list", sources: ["openalexTopics"], sent: { crossref: false, zenodo: true } },
  keywords: { note: true, filled: "pdf", entry: "typed", sent: { crossref: false, zenodo: true } },
  sdgs: { note: true, filled: "judged", entry: "list", sources: ["sdgs"], sent: { crossref: false, zenodo: true } },
  design: { note: true, filled: "judged", entry: "list", sources: ["openalexDesigns"], sent: { crossref: false, zenodo: true } },
  places: { filled: "judged", entry: "list", sources: ["iso3166"], sent: { crossref: false, zenodo: true } },
  funding: { note: true, filled: "matched", entry: "either", sources: ["openalexFunders", "rorFunders", "funderRegistry", "rorAdd"], sent: BOTH },
  references: { note: true, filled: "pdf", entry: "pasted", sources: ["doi", "crossrefReferences"], sent: BOTH },
  links: { note: true, filled: "pdf", entry: "either", sources: ["crossrefRelations"], sent: BOTH },
  agreement: { note: true, sources: ["ccBy"] },
  doi: { note: true, filled: "reserved", sources: ["doi"] },
  byline: { note: true, entry: "chosen", sources: ["issn"] },
  checks: { note: true },
  issn: { note: true, sources: ["issn"] },
  activation: { note: true },
} as const satisfies Record<string, Help>;
export type HelpKey = keyof typeof HELP;

/** The registrars a report is sent to, as its series has them set: a "?" leaves out the one that isn't used. */
const Registrars = createContext<{ crossref: boolean; zenodo: boolean }>(BOTH);
export const RegistrarsProvider = Registrars.Provider;

const MARK: Record<Mark, ReactNode> = {
  openalex: <OpenAlexIcon className="size-4" />,
  orcid: <OrcidIcon />,
  ror: <RorIcon />,
  web: <Globe className="size-4 text-muted-foreground" />,
};

function Fact({ icon: Icon, text }: { icon: AppIcon; text: string }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-inset px-2 text-xs font-medium">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      {text}
    </span>
  );
}

/** Who is sent this part or isn't, with what they do with a report in a few words: few authors know Crossref or Zenodo by name. */
function Taker({ takes, name, does, href, children }: { takes: boolean; name: string; does: string; href?: string; children: ReactNode }) {
  const t = useTranslations("publishReports.help");
  const Sign = takes ? CircleCheck : Minus;
  const row = (
    <>
      <Sign className={cn("size-4 shrink-0", takes ? "text-primary" : "text-muted-foreground")} />
      <span className="flex w-24 shrink-0 items-center gap-1.5">{children}</span>
      <span className="min-w-0 flex-1 font-normal text-muted-foreground">{does}</span>
    </>
  );
  const label = t(takes ? "sent" : "notSent", { name, does });
  const className = cn("flex h-7 items-center gap-2 rounded-md px-2.5", !takes && "opacity-45 grayscale");
  return (
    <li>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className={cn(className, "group hover:bg-accent")}>
          {row}
          <ExternalLink className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
        </a>
      ) : (
        <span role="img" aria-label={label} className={className}>
          {row}
        </span>
      )}
    </li>
  );
}

/** The "?" beside a part of a report's details or a publish step. */
export function FieldHelp({ field, className }: { field: HelpKey; className?: string }) {
  const t = useTranslations("publishReports.help");
  // Beside its "?" where the screen is wide, where the whole window's height is free: above or below a field low on a
  // laptop's screen, the longest help ran past the window and hid where the field is sent.
  const beside = !useIsMobile();
  const registrars = useContext(Registrars);
  const help: Help = HELP[field];
  const title = t(`parts.${field}.title`);
  // The registrars' logos are fetched with the page, so they are there when the first "?" opens.
  preload("/brands/crossref.svg", { as: "image" });
  preload("/brands/zenodo.svg", { as: "image" });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t("aboutLabel", { title })} className={cn("-my-1 size-5 shrink-0 rounded-full text-muted-foreground hover:text-foreground aria-expanded:text-primary", className)}>
          <CircleHelp className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side={beside ? "right" : "bottom"} align="start" aria-label={t("aboutLabel", { title })} className="w-80 p-0 font-normal text-foreground">
        <div className="space-y-3 p-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-sm/5 text-pretty text-muted-foreground">{t(`parts.${field}.about`)}</p>
          </div>
          {help.filled || help.entry ? (
            <div className="flex flex-wrap gap-1.5">
              {help.filled ? <Fact icon={FILLED[help.filled]} text={t(`filled.${help.filled}`)} /> : null}
              {help.entry ? <Fact icon={ENTRY[help.entry]} text={t(`entry.${help.entry}`)} /> : null}
            </div>
          ) : null}
          {help.note ? <p className="text-xs/5 text-pretty text-muted-foreground">{t(`parts.${field}.note` as Parameters<typeof t>[0])}</p> : null}
        </div>
        {help.sources?.length ? (
          <ul className="border-t border-border-subtle p-1.5">
            {help.sources.map((key) => (
              <li key={key}>
                <a href={SOURCES[key].href} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-2.5 rounded-md px-2.5 py-2 hover:bg-accent">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center">{MARK[SOURCES[key].mark]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm/5 font-medium">{t(`sources.${key}.name`)}</span>
                    <span className="block text-xs/4 text-muted-foreground">{t(`sources.${key}.detail`)}</span>
                  </span>
                  <span className="flex h-5 shrink-0 items-center">
                    <ExternalLink className="size-3.5 text-muted-foreground group-hover:text-foreground" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {help.sent ? (
          <div className="rounded-b-[inherit] border-t border-border-subtle bg-inset/60 p-1.5 text-xs font-medium">
            <p className="px-2.5 pt-1.5 pb-1 text-muted-foreground">{t("sentTo")}</p>
            <ul>
              {registrars.crossref ? (
                <Taker takes={help.sent.crossref} name="Crossref" does={t("does.crossref")} href="https://www.crossref.org/">
                  <FadeImage src="/brands/crossref.svg" className="h-4 w-[47px]" />
                </Taker>
              ) : null}
              {registrars.zenodo ? (
                <Taker takes={help.sent.zenodo} name="Zenodo" does={t("does.zenodo")} href="https://zenodo.org/">
                  <FadeImage src="/brands/zenodo.svg" className="h-4 w-11" />
                </Taker>
              ) : null}
              <Taker takes name="Openscholar" does={t("does.openscholar")}>
                <LogoMark className="size-4" />
                Openscholar
              </Taker>
            </ul>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** A part's name with its "?", over its box. `htmlFor` ties the name to a box that has that id. */
export function FieldLabel({ label, help, htmlFor, counter }: { label: string; help: HelpKey; htmlFor?: string; /** How much of a box with a limit is used. */ counter?: string }) {
  return (
    <span className="flex items-center gap-0.5 ps-1 text-xs font-medium text-muted-foreground">
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
      <FieldHelp field={help} />
      {counter ? <span className="ms-auto font-mono font-normal tabular-nums">{counter}</span> : null}
    </span>
  );
}
