"use client";

// A report's details that a paper's record has no place for, in the paper page's own sections (plans/publish-reports).
import { parseAsInteger, useQueryState } from "nuqs";
import { useLocale, useTranslations } from "next-intl";
import { Section } from "@/components/papers/paper-page";
import { Paged, pagerOf } from "@/components/settings/parts";
import { getRegionDisplayName } from "@/lib/i18n/region-names";
import { CountryFlag } from "@/components/ui/country-flag";
import { ExternalLink, PenLine } from "@/components/icons";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useVocabulary } from "@/lib/openalex/use-vocabulary";
import { useRelationName, useRoleName } from "@/components/reports/words";
import { linkHref, type Metadata } from "@/lib/reports/report";
import { CONTACT_EMAIL } from "@/lib/billing/contact";

const CHIP = "inline-flex h-6 items-center gap-1.5 rounded-md bg-inset px-2 text-xs text-muted-foreground";
const REFS_PER_PAGE = 8;
const REF_ROW = 24;

/** A place's name: a country's, or a region's as the country filter names it ("africa", "eastern_africa"). */
export function usePlaceName() {
  const locale = useLocale();
  const tf = useTranslations("searchFilters");
  return (id: string) => getRegionDisplayName(id, locale, (key) => (tf as (key: string) => string)(key));
}

/** Under the authors: who did what, what the report cites, and where its data and code are. */
export function ReportMain({ m }: { m: Metadata }) {
  const t = useTranslations("publishReports.page");
  const roleName = useRoleName();
  const relationName = useRelationName();
  const credited = m.authors.filter((a) => a.roles.length);
  const links = m.relations.flatMap((r) => {
    const href = linkHref(r.target);
    return href ? [{ ...r, href }] : [];
  });
  // The page of references is in the address, and turning it is a step in the browser's history.
  const [page, setPage] = useQueryState("refs", parseAsInteger.withDefault(1).withOptions({ history: "push", scroll: false }));
  const refs = pagerOf(m.references.length, REFS_PER_PAGE, page, (next) => void setPage(next));
  const shownRefs = m.references.slice((refs.page - 1) * REFS_PER_PAGE, refs.page * REFS_PER_PAGE);
  return (
    <>
      {credited.length ? (
        <Section id="report-contributions" title={t("contributions")}>
          <ul className="space-y-3">
            {credited.map((a) => (
              <li key={a.name} className="text-sm">
                <p className="font-medium">{a.name}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {a.roles.map((role) => (
                    <span key={role} className={CHIP}>
                      {roleName(role)}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {links.length ? (
        <Section id="report-links" title={t("links")}>
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle">
            {links.map((r) => (
              <li key={r.href}>
                <a href={r.href} target="_blank" rel="noopener noreferrer" className="flex h-11 items-center gap-3 px-3 text-sm transition-colors hover:bg-muted">
                  <span className={CHIP}>{relationName(r.kind)}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{r.target}</span>
                  <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
                </a>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {m.references.length ? (
        <Section id="report-references" title={t("references")} count={m.references.length}>
          <Paged pager={refs} rowHeight={REF_ROW} label={t("referencesPager")}>
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
export function ReportSide({ m, reportKey }: { m: Metadata; /** Its key, which a request to take it down names. */ reportKey: string }) {
  const t = useTranslations("publishReports.page");
  const tf = useTranslations("publishReports.flow");
  const placeName = usePlaceName();
  const designs = useVocabulary().studyDesigns.filter((d) => m.studyDesigns.includes(d.id));
  return (
    <>
      {m.countries.length ? (
        <Section id="report-places" title={t("places")}>
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
        <Section id="report-design" title={t("studyDesign")}>
          <div className="flex flex-wrap gap-1.5">
            {designs.map((d) => (
              <span key={d.id} className={CHIP}>
                {d.name}
              </span>
            ))}
          </div>
        </Section>
      ) : null}
      {/* Anyone reading it, not only its workspace, is told how a report comes down: by writing to us. */}
      <Section id="report-take-down" title={t("takeDownTitle")}>
        <p className="text-sm text-muted-foreground">
          {tf.rich("takeDown", {
            email: CONTACT_EMAIL,
            key: reportKey,
            mail: (chunks) => (
              <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(reportKey)}`} className="text-foreground underline underline-offset-2">
                {chunks}
              </a>
            ),
          })}
        </p>
      </Section>
    </>
  );
}

/** On a report's own page, for its workspace, at the end of the row of actions: the way to correct its details, which opens them on the Publish page.
 * With changes already waiting, it opens where they stand. */
export function CorrectReport({ id, waiting, slug }: { id: string; waiting: boolean; /** Its workspace's address: an organisation's slug, or null for its owner's own. */ slug: string | null }) {
  // The report's own workspace, whichever the page was opened in: a plain address, not one this workspace's links make.
  const t = useTranslations("publishReports.page");
  const publish = `${slug ? `/o/${slug}` : ""}/publish?report=${id}`;
  return (
    <Button size="sm" variant="outline" asChild>
      <Link href={waiting ? publish : `${publish}&correct=true`}>
        <PenLine aria-hidden />
        {t(waiting ? "seeChanges" : "correct")}
      </Link>
    </Button>
  );
}
