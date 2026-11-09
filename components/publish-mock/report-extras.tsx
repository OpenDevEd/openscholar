"use client";

// MOCK (mock/publish-reports): a report's details that a paper's record has no place for, in the paper page's own sections.
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Section } from "@/components/papers/paper-page";
import { Paged, pagerOf } from "@/components/settings/parts";
import { getRegionDisplayName } from "@/lib/i18n/region-names";
import { CountryFlag } from "@/components/ui/country-flag";
import { ExternalLink, PenLine } from "@/components/icons";
import { BAR_ACTION, BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { Button } from "@/components/ui/button";
import Link from "@/components/workspace-link";
import { STUDY_DESIGNS } from "@/lib/openalex/vocabulary";
import { RELATION_KINDS, type Metadata } from "@/lib/publish-mock/types";

const CHIP = "inline-flex h-6 items-center gap-1.5 rounded-md bg-inset px-2 text-xs text-muted-foreground";
const REFS_PER_PAGE = 8;
const REF_ROW = 24;

/** A place's name: a country's, or a region's as the country filter names it ("africa", "eastern_africa"). */
export function usePlaceName() {
  const locale = useLocale();
  const tf = useTranslations("searchFilters");
  return (id: string) => getRegionDisplayName(id, locale, (key) => (tf as (key: string) => string)(key));
}

/** A link's address: a bare DOI goes to doi.org; anything that isn't a web address or a DOI has none. */
export function linkHref(target: string) {
  const text = target.trim();
  if (/^https?:\/\/\S+$/i.test(text)) return text;
  const doi = text.replace(/^doi:\s*/i, "");
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? `https://doi.org/${doi}` : null;
}

/** Under the authors: who did what, what the report cites, and where its data and code are. */
export function ReportMain({ m }: { m: Metadata }) {
  const credited = m.authors.filter((a) => a.roles.length);
  const links = m.relations.flatMap((r) => {
    const href = linkHref(r.target);
    return href ? [{ ...r, href }] : [];
  });
  const [page, setPage] = useState(1);
  const refs = pagerOf(m.references.length, REFS_PER_PAGE, page, setPage);
  const shownRefs = m.references.slice((refs.page - 1) * REFS_PER_PAGE, refs.page * REFS_PER_PAGE);
  return (
    <>
      {credited.length ? (
        <Section id="report-contributions" title="Contributions">
          <ul className="space-y-3">
            {credited.map((a) => (
              <li key={a.name} className="text-sm">
                <p className="font-medium">{a.name}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {a.roles.map((role) => (
                    <span key={role} className={CHIP}>
                      {role}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {links.length ? (
        <Section id="report-links" title="Data, code and other versions">
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle">
            {links.map((r) => (
              <li key={r.href}>
                <a href={r.href} target="_blank" rel="noopener noreferrer" className="flex h-11 items-center gap-3 px-3 text-sm transition-colors hover:bg-muted">
                  <span className={CHIP}>{RELATION_KINDS.find((k) => k.id === r.kind)?.name}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{r.target}</span>
                  <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
                </a>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {m.references.length ? (
        <Section id="report-references" title="References" count={m.references.length}>
          <Paged pager={refs} rowHeight={REF_ROW} label="references">
          <ul>
            {shownRefs.map((doi) => (
              <li key={doi} style={{ height: REF_ROW }} className="flex items-center">
                <a href={`https://doi.org/${doi}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline">
                  {doi}
                </a>
              </li>
            ))}
          </ul>
          </Paged>
        </Section>
      ) : null}
    </>
  );
}

/** In the sidebar: the places the report is about and how it was studied. */
export function ReportSide({ m }: { m: Metadata }) {
  const placeName = usePlaceName();
  const designs = STUDY_DESIGNS.filter((d) => m.studyDesigns.includes(d.id));
  return (
    <>
      {m.countries.length ? (
        <Section id="report-places" title="Places studied">
          <div className="flex flex-wrap gap-1.5">
            {m.countries.map((code) => (
              <span key={code} className={CHIP}>
                {code.length === 2 ? <CountryFlag countryCode={code} /> : null}
                {placeName(code)}
              </span>
            ))}
          </div>
        </Section>
      ) : null}
      {designs.length ? (
        <Section id="report-design" title="Study design">
          <div className="flex flex-wrap gap-1.5">
            {designs.map((d) => (
              <span key={d.id} className={CHIP}>
                {d.name}
              </span>
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}

/** On a report's own page, for its author: the way to correct its details, which opens them on the Publish page. */
export function CorrectReport({ id }: { id: string }) {
  return (
    <Button size="sm" variant="outline" className={BAR_ACTION} asChild>
      <Link href={`/publish?correct=${id}`}>
        <PenLine aria-hidden />
        <span className={BAR_LABEL}>Correct the details</span>
      </Link>
    </Button>
  );
}
