"use client";

import { useTranslations } from "next-intl";
import Link from "@/components/workspace-link";
import { AuthorHoverCard, InstitutionHoverCard } from "@/components/entity-cards";
import { FilterName } from "@/components/paper-card/shared";
import { authorValue, useAuthorFilter, useInstitutionFilter, useJournalFilter } from "@/components/paper-card/hooks";
import { buildShareableUrl } from "@/lib/search-params";
import { rememberFunderNames } from "@/lib/openalex/use-record-names";
import { RorIcon } from "@/components/icons/author-service-icons";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PaperInstitution } from "@/lib/papers/paper-detail";

/**
 * An author's name as the search's cards show it: a hover card with their papers and page, and a click that searches by them.
 * A paper's page has no search to narrow, so the click starts one (`useAuthorFilter`).
 */
export function AuthorName({ id, name, className }: { id: string | null; name: string; className?: string }) {
  const tf = useTranslations("searchFilters");
  const filter = useAuthorFilter();
  const value = authorValue({ id, display_name: name });
  if (!value) return <span className={className}>{name}</span>;
  return (
    <AuthorHoverCard value={value} name={name}>
      <FilterName pressed={false} label={tf("filterByAuthor", { name })} onToggle={() => filter.toggle({ value, name })} className={className}>{name}</FilterName>
    </AuthorHoverCard>
  );
}

/** An institution, with its hover card and a click that searches its papers. One without an ID is its name. */
export function InstitutionName({ institution, className }: { institution: PaperInstitution; className?: string }) {
  const tf = useTranslations("searchFilters");
  const filter = useInstitutionFilter();
  const { id, name } = institution;
  if (!id) return <span className={className}>{name}</span>;
  return (
    <InstitutionHoverCard id={id} name={name}>
      <FilterName pressed={false} label={tf("filterByThisInstitution", { name })} onToggle={() => filter.toggle({ value: id, name })} className={className}>{name}</FilterName>
    </InstitutionHoverCard>
  );
}

/** An institution's ROR mark, which opens its record on ror.org; `label` names the institution for a screen reader. */
export function RorLink({ ror, label, className }: { ror: string; label: string; className?: string }) {
  return (
    <TooltipHint label={label}>
      <a href={ror} target="_blank" rel="noreferrer" aria-label={label} className={cn("inline-flex h-4 shrink-0 items-center rounded-sm px-0.5 opacity-80 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-ring", className)}>
        <RorIcon />
      </a>
    </TooltipHint>
  );
}

/** The journal, as a click that searches its papers. */
export function JournalName({ journal, className }: { journal: { id: string | null; name: string }; className?: string }) {
  const tf = useTranslations("searchFilters");
  const filter = useJournalFilter();
  const { id, name } = journal;
  if (!id) return <span className={className}>{name}</span>;
  return <FilterName pressed={false} label={tf("filterByJournal", { name })} onToggle={() => filter.toggle({ value: id, name })} className={className}>{name}</FilterName>;
}

/** A funder, linking to a search of the papers it funded; its name is kept so the search's chip can show it. */
export function FunderName({ id, name, className }: { id: string | null; name: string; className?: string }) {
  if (!id) return <span className={className}>{name}</span>;
  return (
    <Link href={buildShareableUrl("", { funder: [id] })} onNavigate={() => rememberFunderNames({ [id]: name })} className={cn("rounded-sm underline-offset-2 hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring", className)}>
      {name}
    </Link>
  );
}
