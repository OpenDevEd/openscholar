"use client";

// MOCK (mock/publish-reports): a report's details that a paper's record has no place for, in the paper page's own sections.
import { Section } from "@/components/papers/paper-page";
import { CountryFlag } from "@/components/ui/country-flag";
import { ExternalLink } from "@/components/icons";
import { STUDY_DESIGNS } from "@/lib/openalex/vocabulary";
import { RELATION_KINDS, type Metadata } from "@/lib/publish-mock/types";

const CHIP = "inline-flex h-6 items-center gap-1.5 rounded-md bg-inset px-2 text-xs text-muted-foreground";
const COUNTRY = new Intl.DisplayNames(["en"], { type: "region" });
const REFS_SHOWN = 8;

/** Under the authors: who did what, what the report cites, and where its data and code are. */
export function ReportMain({ m }: { m: Metadata }) {
  const credited = m.authors.filter((a) => a.roles.length);
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
      {m.relations.length ? (
        <Section id="report-links" title="Data, code and other versions">
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle">
            {m.relations.map((r) => (
              <li key={r.target}>
                <a href={r.target} target="_blank" rel="noopener noreferrer" className="flex h-11 items-center gap-3 px-3 text-sm transition-colors hover:bg-muted">
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
          <ul className="space-y-1.5">
            {m.references.slice(0, REFS_SHOWN).map((doi) => (
              <li key={doi}>
                <a href={`https://doi.org/${doi}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline">
                  {doi}
                </a>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

/** In the sidebar: the places the report is about and how it was studied. */
export function ReportSide({ m }: { m: Metadata }) {
  const designs = STUDY_DESIGNS.filter((d) => m.studyDesigns.includes(d.id));
  return (
    <>
      {m.countries.length ? (
        <Section id="report-places" title="Places studied">
          <div className="flex flex-wrap gap-1.5">
            {m.countries.map((code) => (
              <span key={code} className={CHIP}>
                {code.length === 2 ? <CountryFlag countryCode={code} /> : null}
                {code.length === 2 ? COUNTRY.of(code.toUpperCase()) : code}
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
