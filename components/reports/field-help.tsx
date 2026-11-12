"use client";

// mock: the "?" beside every part of a report's details. Each says what the part is, how it was filled in, whether
// its values come from a list, where that list lives, and which of Crossref, Zenodo and Openscholar receive it.
// The words are English here; the real build moves them into messages/.

import type { ReactNode } from "react";
import { preload } from "react-dom";
import { Button } from "@/components/ui/button";
import { FadeImage } from "@/components/ui/fade-image";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AiIcon, Check, CircleCheck, CircleHelp, ExternalLink, Globe, ListChecks, Lock, Minus, Pencil, Search, type AppIcon } from "@/components/icons";
import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import { OrcidIcon, RorIcon } from "@/components/icons/author-service-icons";
import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";

/** How a part was filled in before its author saw it. */
const FILLED = {
  pdf: { icon: AiIcon, text: "Read from your PDF" },
  judged: { icon: AiIcon, text: "Judged from your PDF" },
  matched: { icon: Search, text: "Read from your PDF, then looked up" },
  classified: { icon: AiIcon, text: "Suggested by OpenAlex" },
  author: { icon: Pencil, text: "Starts as Author" },
  fixed: { icon: Lock, text: "Set by Openscholar" },
} as const satisfies Record<string, { icon: AppIcon; text: string }>;

/** What can be entered in it. */
const ENTRY = {
  list: { icon: ListChecks, text: "Picked from a list" },
  typed: { icon: Pencil, text: "Typed freely" },
  either: { icon: ListChecks, text: "From a list, or typed" },
  pasted: { icon: Pencil, text: "Pasted or uploaded" },
  toggle: { icon: Check, text: "On or off" },
  fixed: { icon: Lock, text: "Can't be changed" },
} as const satisfies Record<string, { icon: AppIcon; text: string }>;

type Mark = "openalex" | "orcid" | "ror" | "web";
type Source = { mark: Mark; name: string; detail: string; href: string };
type Help = {
  title: string;
  about: string;
  /** One more fact worth knowing, such as what happens when the PDF has none. */
  note?: string;
  filled: keyof typeof FILLED;
  entry: keyof typeof ENTRY;
  /** The lists and registries behind it. */
  sources?: Source[];
  crossref: boolean;
  zenodo: boolean;
};

const CROSSREF = "https://www.crossref.org/documentation/schema-library/markup-guide-metadata-segments";

/** The roles Crossref has for a person on a record (its `crossref` vocabulary), without Corresponding author, which is the switch. */
export const PERSON_KINDS = [
  { id: "author", name: "Author" },
  { id: "editor", name: "Editor" },
  { id: "chair", name: "Chair" },
  { id: "translator", name: "Translator" },
  { id: "reviewer", name: "Reviewer" },
  { id: "review-assistant", name: "Review assistant" },
  { id: "reviewer-external", name: "Reviewer (external)" },
  { id: "stats-reviewer", name: "Reviewer (statistics)" },
  { id: "reader", name: "Reader" },
  { id: "other", name: "Other" },
] as const;

/** Each CRediT role in a line, shortened from its definition at credit.niso.org. */
export const CONTRIBUTION_DETAIL: Record<string, string> = {
  Conceptualization: "Came up with the ideas, goals and aims",
  "Data curation": "Organised, cleaned and kept the data",
  "Formal analysis": "Ran the statistics or other formal analysis",
  "Funding acquisition": "Won the money for the project",
  Investigation: "Did the research and collected the evidence",
  Methodology: "Designed the methods or models",
  "Project administration": "Managed and coordinated the project",
  Resources: "Provided materials, samples, tools or computing",
  Software: "Wrote or tested the code",
  Supervision: "Led and mentored the team",
  Validation: "Checked that the results can be reproduced",
  Visualization: "Made the figures and data presentation",
  "Writing, original draft": "Wrote the first draft",
  "Writing, review and editing": "Reviewed and revised the text",
};

export const HELP = {
  title: {
    title: "Title",
    about: "The report's title as its cover prints it.",
    filled: "pdf",
    entry: "typed",
    crossref: true,
    zenodo: true,
  },
  subtitle: {
    title: "Subtitle",
    about: "The line under the title, when the cover has one.",
    note: "Empty when the PDF prints none.",
    filled: "pdf",
    entry: "typed",
    crossref: true,
    zenodo: true,
  },
  type: {
    title: "Type",
    about: "The kind of work this is.",
    note: "Crossref files every Openscholar Report as a report. Zenodo and Openscholar use the type chosen here.",
    filled: "pdf",
    entry: "list",
    sources: [
      { mark: "openalex", name: "OpenAlex work types", detail: "The list this picker shows", href: "https://docs.openalex.org/api-entities/works/work-object" },
      { mark: "web", name: "Zenodo resource types", detail: "What each type becomes on Zenodo", href: "https://help.zenodo.org/docs/deposit/describe-records/resource-type/" },
      { mark: "web", name: "Crossref reports", detail: "The record Crossref keeps", href: "https://www.crossref.org/documentation/schema-library/markup-guide-record-types/reports-and-working-papers/" },
    ],
    crossref: false,
    zenodo: true,
  },
  language: {
    title: "Language",
    about: "The language the report is written in.",
    filled: "pdf",
    entry: "list",
    sources: [{ mark: "web", name: "ISO 639 language codes", detail: "The two-letter codes OpenAlex uses", href: "https://www.loc.gov/standards/iso639-2/php/code_list.php" }],
    crossref: true,
    zenodo: true,
  },
  date: {
    title: "Date published",
    about: "The day the report was published, today at the latest.",
    note: "A PDF that states only a year gets 1 January of it. One that states no date gets today.",
    filled: "pdf",
    entry: "typed",
    crossref: true,
    zenodo: true,
  },
  licence: {
    title: "Licence",
    about: "Every Openscholar Report is published under CC BY 4.0, as the agreement you signed says.",
    filled: "fixed",
    entry: "fixed",
    sources: [{ mark: "web", name: "CC BY 4.0", detail: "Creative Commons Attribution 4.0", href: "https://creativecommons.org/licenses/by/4.0/" }],
    crossref: true,
    zenodo: true,
  },
  authors: {
    title: "Authors",
    about: "Everyone the report credits, in the order its citation lists them.",
    note: "The PDF's authors are filled in. Add editors and translators here and set their role.",
    filled: "pdf",
    entry: "typed",
    sources: [{ mark: "web", name: "Crossref contributors", detail: "How Crossref records people", href: `${CROSSREF}/contributors/` }],
    crossref: true,
    zenodo: true,
  },
  name: {
    title: "Name",
    about: "The name as the report prints it. An organisation's full name works too.",
    note: "Crossref and Zenodo keep it as family name, then given names. The last word is taken as the family name.",
    filled: "pdf",
    entry: "typed",
    crossref: true,
    zenodo: true,
  },
  kind: {
    title: "Role",
    about: "What this person is to the report. Most people are authors.",
    note: "What an author did goes under Contributions.",
    filled: "author",
    entry: "list",
    sources: [{ mark: "web", name: "Crossref contributor roles", detail: "The list this picker shows", href: `${CROSSREF}/contributors/` }],
    crossref: true,
    zenodo: true,
  },
  orcid: {
    title: "ORCID iD",
    about: "A free number that tells researchers with the same name apart.",
    note: "When the PDF prints none, ORCID is searched for one person with exactly this name at one of these institutions.",
    filled: "matched",
    entry: "either",
    sources: [
      { mark: "orcid", name: "ORCID", detail: "What an iD is", href: "https://info.orcid.org/what-is-orcid/" },
      { mark: "orcid", name: "Get an iD", detail: "Free, takes a minute", href: "https://orcid.org/register" },
    ],
    crossref: true,
    zenodo: true,
  },
  affiliations: {
    title: "Affiliations",
    about: "Where this person worked when the report was written.",
    note: "An institution with a ROR ID is sent with it, so Crossref and Zenodo know which one it is. One typed by hand goes as a name alone.",
    filled: "matched",
    entry: "either",
    sources: [
      { mark: "openalex", name: "OpenAlex institutions", detail: "Searched first", href: "https://docs.openalex.org/api-entities/institutions" },
      { mark: "ror", name: "Research Organization Registry", detail: "Searched for those OpenAlex lacks", href: "https://ror.org/" },
      { mark: "ror", name: "Ask ROR to add an organisation", detail: "For one that is on neither list", href: "https://curation-request.ror.org/" },
    ],
    crossref: true,
    zenodo: true,
  },
  contributions: {
    title: "Contributions",
    about: "What this person did for the work, in the 14 roles of CRediT.",
    note: "Filled in only when the PDF has a contributions statement. Leaving it empty is fine.",
    filled: "pdf",
    entry: "list",
    sources: [{ mark: "web", name: "CRediT", detail: "NISO's Contributor Role Taxonomy", href: "https://credit.niso.org/" }],
    crossref: true,
    zenodo: false,
  },
  corresponding: {
    title: "Corresponding author",
    about: "The person readers write to about the report.",
    note: "Switched on only when the PDF marks one.",
    filled: "pdf",
    entry: "toggle",
    sources: [{ mark: "web", name: "Crossref contributor roles", detail: "Sent as corresponding-author", href: `${CROSSREF}/contributors/` }],
    crossref: true,
    zenodo: true,
  },
  abstract: {
    title: "Abstract",
    about: "The abstract or summary your PDF prints, copied as it is.",
    note: "Empty when the PDF prints neither. Write from the PDF then drafts one for you to check.",
    filled: "pdf",
    entry: "typed",
    sources: [{ mark: "web", name: "Crossref abstracts", detail: "How Crossref keeps one", href: `${CROSSREF}/abstracts/` }],
    crossref: true,
    zenodo: true,
  },
  topics: {
    title: "Topics",
    about: "What the report is about, in OpenAlex's topics.",
    note: "OpenAlex's classifier reads the title and abstract. The bar on a topic shows how sure it was. Topics you add have none.",
    filled: "classified",
    entry: "list",
    sources: [{ mark: "openalex", name: "OpenAlex topics", detail: "The list this picker searches", href: "https://help.openalex.org/hc/en-us/articles/24736129405719-Topics" }],
    crossref: false,
    zenodo: true,
  },
  keywords: {
    title: "Keywords",
    about: "Your own words for what the report is about.",
    note: "The PDF's keywords. When it lists none, up to five from OpenAlex's classifier.",
    filled: "pdf",
    entry: "typed",
    crossref: false,
    zenodo: true,
  },
  sdgs: {
    title: "Sustainable Development Goals",
    about: "The UN goals the report is substantially about.",
    note: "At most three are filled in. Add or remove any.",
    filled: "judged",
    entry: "list",
    sources: [{ mark: "web", name: "The 17 goals", detail: "United Nations", href: "https://sdgs.un.org/goals" }],
    crossref: false,
    zenodo: true,
  },
  design: {
    title: "Study design",
    about: "How the study was done.",
    note: "Filled in only when the PDF makes it clear. Zenodo shows it as a methods note.",
    filled: "judged",
    entry: "list",
    sources: [{ mark: "openalex", name: "OpenAlex study designs", detail: "The list this picker shows", href: "https://api.openalex.org/study-designs" }],
    crossref: false,
    zenodo: true,
  },
  places: {
    title: "Places studied",
    about: "The countries and regions the report is about, not where its authors work.",
    filled: "judged",
    entry: "list",
    sources: [{ mark: "web", name: "ISO 3166 country codes", detail: "The countries this picker lists", href: "https://www.iso.org/iso-3166-country-codes.html" }],
    crossref: false,
    zenodo: true,
  },
  funding: {
    title: "Funding",
    about: "Who paid for the work, with the grant numbers as printed.",
    note: "A funder OpenAlex knows is sent with its Funder Registry ID and ROR ID. One typed by hand goes as a name alone.",
    filled: "matched",
    entry: "either",
    sources: [
      { mark: "openalex", name: "OpenAlex funders", detail: "The list this picker searches", href: "https://docs.openalex.org/api-entities/funders" },
      { mark: "web", name: "Crossref Funder Registry", detail: "The IDs Crossref matches funders by", href: "https://www.crossref.org/services/funder-registry/" },
      { mark: "ror", name: "Ask ROR to add a funder", detail: "For one that is on neither list", href: "https://curation-request.ror.org/" },
    ],
    crossref: true,
    zenodo: true,
  },
  references: {
    title: "References",
    about: "The works this report cites, as its reference list writes them.",
    note: "Paste the list, or upload it as a BibTeX, RIS or plain text file. Every DOI the PDF prints is filled in, and a reference with a DOI links to the work it cites.",
    filled: "pdf",
    entry: "pasted",
    sources: [
      { mark: "web", name: "DOI", detail: "What a DOI is", href: "https://www.doi.org/" },
      { mark: "web", name: "Crossref references", detail: "How citations are counted from them", href: `${CROSSREF}/references/` },
    ],
    crossref: true,
    zenodo: true,
  },
  links: {
    title: "Data, code and versions",
    about: "Where the report's data, code, other versions and supplements live.",
    note: "Each is a web address or a DOI.",
    filled: "pdf",
    entry: "either",
    sources: [{ mark: "web", name: "Crossref relationships", detail: "How Crossref links works together", href: `${CROSSREF}/relationships/` }],
    crossref: true,
    zenodo: true,
  },
} as const satisfies Record<string, Help>;
export type HelpKey = keyof typeof HELP;

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
  const Sign = takes ? CircleCheck : Minus;
  const row = (
    <>
      <Sign className={cn("size-4 shrink-0", takes ? "text-primary" : "text-muted-foreground")} />
      <span className="flex w-24 shrink-0 items-center gap-1.5">{children}</span>
      <span className="min-w-0 flex-1 font-normal text-muted-foreground">{does}</span>
    </>
  );
  const label = `${name}, ${takes ? "sent this" : "not sent this"}: ${does}`;
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

/** The "?" beside a part of the details. */
export function FieldHelp({ field, className }: { field: HelpKey; className?: string }) {
  const help: Help = HELP[field];
  // The registrars' logos are fetched with the page, so they are there when the first "?" opens.
  preload("/brands/crossref.svg", { as: "image" });
  preload("/brands/zenodo.svg", { as: "image" });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`About ${help.title}`} className={cn("-my-1 size-5 shrink-0 rounded-full text-muted-foreground hover:text-foreground aria-expanded:text-primary", className)}>
          <CircleHelp className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={`About ${help.title}`} className="w-80 p-0 font-normal text-foreground">
        <div className="space-y-3 p-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold">{help.title}</p>
            <p className="text-sm/5 text-pretty text-muted-foreground">{help.about}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Fact {...FILLED[help.filled]} />
            {help.entry === "fixed" ? null : <Fact {...ENTRY[help.entry]} />}
          </div>
          {help.note ? <p className="text-xs/5 text-pretty text-muted-foreground">{help.note}</p> : null}
        </div>
        {help.sources?.length ? (
          <ul className="border-t border-border-subtle p-1.5">
            {help.sources.map((source) => (
              <li key={source.href}>
                <a href={source.href} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-2.5 rounded-md px-2.5 py-2 hover:bg-accent">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center">{MARK[source.mark]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm/5 font-medium">{source.name}</span>
                    <span className="block text-xs/4 text-muted-foreground">{source.detail}</span>
                  </span>
                  <span className="flex h-5 shrink-0 items-center">
                    <ExternalLink className="size-3.5 text-muted-foreground group-hover:text-foreground" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="rounded-b-[inherit] border-t border-border-subtle bg-inset/60 p-1.5 text-xs font-medium">
          <p className="px-2.5 pt-1.5 pb-1 text-muted-foreground">Sent to</p>
          <ul>
            <Taker takes={help.crossref} name="Crossref" does="Registers the DOI" href="https://www.crossref.org/">
              <FadeImage src="/brands/crossref.svg" className="h-4 w-[47px]" />
            </Taker>
            <Taker takes={help.zenodo} name="Zenodo" does="Archives a copy" href="https://zenodo.org/">
              <FadeImage src="/brands/zenodo.svg" className="h-4 w-11" />
            </Taker>
            <Taker takes name="Openscholar" does="Shows the report">
              <LogoMark className="size-4" />
              Openscholar
            </Taker>
          </ul>
        </div>
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
