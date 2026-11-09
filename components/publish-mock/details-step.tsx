"use client";

// MOCK (mock/publish-reports): the report's details as the metadata model read them from the PDF, for the author to
// correct. Openscholar keeps all of it and shows it on the report's page; the sections marked for Crossref go there too.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { OpenAlexLookupFilter } from "@/components/openalex-lookup-filter";
import { CountrySelector } from "@/components/country-selector";
import { OptionPicker } from "@/components/shared/option-picker";
import { Paged, pagerOf } from "@/components/settings/parts";
import { FunderName } from "@/components/papers/paper-entities";
import { OrcidIcon } from "@/components/icons/author-service-icons";
import { Button } from "@/components/ui/button";
import { CountryFlag } from "@/components/ui/country-flag";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TooltipHint } from "@/components/ui/tooltip";
import { AiIcon, ArrowDown, ArrowUp, CircleX, ExternalLink, Plus, ShieldCheck, Trash2 } from "@/components/icons";
import { SDGS, STUDY_DESIGNS, WORK_LANGUAGES, WORK_TYPES } from "@/lib/openalex/vocabulary";
import { searchTopicCatalog, topicName } from "@/lib/topics/search";
import { useFunderNames, rememberFunderNames } from "@/lib/openalex/use-record-names";
import { countryOfPlace } from "@/lib/publish-mock/read";
import { linkHref } from "@/components/publish-mock/report-extras";
import { CREDIT_ROLES, RELATION_KINDS, type Affiliation, type Author, type Metadata } from "@/lib/publish-mock/types";
import { cn } from "@/lib/utils";

const LANGUAGE = new Intl.DisplayNames(["en"], { type: "language" });
const REFS_PER_PAGE = 5;
const REF_ROW = 41;
const AUTHORS_PER_PAGE = 5;
const AUTHOR_ROW = 205;
const ROWS_PER_PAGE = 5;
const ROW = 53;
const BLANK_AUTHOR: Author = { name: "", orcid: "", openalexId: null, affiliations: [], corresponding: false, roles: [] };

/** A part of the details, and where it goes: Crossref as well as Openscholar, or Openscholar alone. */
function Section({ title, crossref, aside, children }: { title: string; crossref: boolean; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex min-h-7 flex-wrap items-center gap-2 border-b border-border-subtle pb-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside}
        <span className={cn("ms-auto rounded-full px-2 py-0.5 text-2xs font-medium", crossref ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
          {crossref ? "Crossref and Openscholar" : "Openscholar"}
        </span>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block min-w-0 space-y-1.5", className)}>
      <span className="ps-1 text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Words typed into a box that become chips: Enter or a comma adds one. */
function ChipInput({ values, onChange, placeholder, label, mono = false }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; label: string; mono?: boolean }) {
  const [text, setText] = useState("");
  const add = () => {
    const word = text.trim();
    if (word && !values.includes(word)) onChange([...values, word]);
    setText("");
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-field px-2 py-1.5">
      {values.map((v) => (
        <span key={v} className={cn("inline-flex h-6 items-center gap-1 rounded-md bg-inset ps-2 pe-1 text-xs", mono && "font-mono")}>
          {v}
          <button type="button" aria-label={`Remove ${v}`} className="rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => onChange(values.filter((x) => x !== v))}>
            <CircleX className="size-3" />
          </button>
        </span>
      ))}
      <input
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder={values.length ? "" : placeholder}
        className={cn("h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground", mono && "font-mono text-xs")}
      />
    </div>
  );
}

/** How sure the reader was of a topic, as a short bar; one an author added has none. */
function Sureness({ score }: { score: number }) {
  return (
    <span aria-hidden className="relative inline-block h-1.5 w-5 shrink-0 overflow-hidden rounded-full bg-foreground/10">
      <span className="absolute inset-y-0 start-0 rounded-full bg-primary" style={{ width: `${Math.round(score * 100)}%` }} />
    </span>
  );
}

const typedId = (name: string) => `typed:${name}`;

/** One page of an editable list, and where it starts; `last` turns to the page a new row lands on. */
function usePage<T>(list: T[], size: number) {
  const [page, setPage] = useState(1);
  const pager = pagerOf(list.length, size, page, setPage);
  const offset = (pager.page - 1) * size;
  return { pager, offset, shown: list.slice(offset, offset + size), last: (length: number) => setPage(Math.max(1, Math.ceil(length / size))) };
}

/** An author's places, from OpenAlex's institutions or as typed, each with its country's flag. */
function Affiliations({ value, onChange }: { value: Affiliation[]; onChange: (a: Affiliation[]) => void }) {
  const ids = value.map((a) => a.id ?? typedId(a.name));
  const names = Object.fromEntries(value.map((a) => [a.id ?? typedId(a.name), a.name]));
  return (
    <OpenAlexLookupFilter
      selected={ids}
      onChange={(next) => onChange(value.filter((a) => next.includes(a.id ?? typedId(a.name))))}
      onPicked={(option) =>
        onChange([...value, option.id.startsWith("typed:") ? { id: null, name: option.name, country: "" } : { id: option.id, name: option.name, country: countryOfPlace(option.detail) }])
      }
      icons={Object.fromEntries(value.filter((a) => a.country).map((a) => [a.id ?? typedId(a.name), <CountryFlag key={a.name} countryCode={a.country} />]))}
      lookup={{
        entity: "institutions",
        useNames: () => names,
        remember: () => {},
        typed: (query) => ({ id: typedId(query), name: query, detail: "As typed" }),
      }}
      labels={{ label: "Affiliations", placeholder: "Add an institution", searchPlaceholder: "Find an institution", typeToSearch: "Type an institution's name", unavailable: "Institutions can't be looked up now" }}
    />
  );
}

function AuthorRow({ author, index, count, onChange, onMove, onRemove }: { author: Author; index: number; count: number; onChange: (patch: Partial<Author>) => void; onMove: (by: -1 | 1) => void; onRemove: () => void }) {
  return (
    <li className="space-y-3 p-4">
      {/* On a narrow screen the ORCID iD takes a line of its own under the name. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-inset text-xs font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
        <Input aria-label="Name" placeholder="Name" value={author.name} onChange={(e) => onChange({ name: e.target.value })} className="w-auto min-w-0 flex-1 font-medium" />
        <div className="relative order-last w-full shrink-0 @xl:order-none @xl:w-52">
          <OrcidIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input aria-label="ORCID iD" placeholder="0000-0000-0000-0000" value={author.orcid} onChange={(e) => onChange({ orcid: e.target.value })} className="ps-8 font-mono text-xs" />
        </div>
        <span className="flex shrink-0">
          <TooltipHint label="Move up">
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${author.name || "author"} up`} disabled={index === 0} className="text-muted-foreground" onClick={() => onMove(-1)}>
              <ArrowUp />
            </Button>
          </TooltipHint>
          <TooltipHint label="Move down">
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${author.name || "author"} down`} disabled={index === count - 1} className="text-muted-foreground" onClick={() => onMove(1)}>
              <ArrowDown />
            </Button>
          </TooltipHint>
          <TooltipHint label="Remove author">
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${author.name || "author"}`} disabled={count === 1} className="text-muted-foreground hover:text-destructive" onClick={onRemove}>
              <Trash2 />
            </Button>
          </TooltipHint>
        </span>
      </div>
      <div className="grid gap-3 @xl:ps-9 @2xl:grid-cols-2">
        <div className="space-y-1.5">
          <span className="ps-1 text-xs font-medium text-muted-foreground">Affiliations</span>
          <Affiliations value={author.affiliations} onChange={(affiliations) => onChange({ affiliations })} />
        </div>
        <div className="space-y-1.5">
          <span className="ps-1 text-xs font-medium text-muted-foreground">Contributor roles</span>
          <OptionPicker
          label="Contributor roles"
          placeholder="Contributor roles"
          selectedText={author.roles.length === 1 ? "1 role" : `${author.roles.length} roles`}
          searchPlaceholder="Find a role"
          emptyText="No such role"
          removeLabel={(name) => `Remove ${name}`}
          options={CREDIT_ROLES.map((role) => ({ id: role, name: role }))}
          selected={author.roles}
          names={Object.fromEntries(CREDIT_ROLES.map((role) => [role, role]))}
          onToggle={(role) => onChange({ roles: author.roles.includes(role) ? author.roles.filter((r) => r !== role) : [...author.roles, role] })}
          />
        </div>
      </div>
      <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground @xl:ps-9">
        <Switch checked={author.corresponding} onCheckedChange={(corresponding) => onChange({ corresponding })} />
        Corresponding author
      </label>
    </li>
  );
}

/** How long after the last change the details are saved. */
const SAVE_AFTER_MS = 800;

export function DetailsStep({
  initial,
  onRun,
  onSave,
  onCancel,
}: {
  initial: Metadata;
  onRun: (m: Metadata) => Promise<void>;
  onSave?: (m: Metadata) => void;
  /** Given when a live report's details are being corrected: the form says so, and can be left without changing anything. */
  onCancel?: () => void;
}) {
  const [m, setM] = useState(initial);
  // Corrections are saved a moment after the last change, so leaving the step loses nothing. A timer, cleared when
  // the details change again; a change still waiting when the step closes is saved as it closes.
  const now = useRef({ m, onSave, saved: initial });
  useEffect(() => {
    now.current.m = m;
    now.current.onSave = onSave;
  });
  const send = () => {
    const { m: latest, onSave: save, saved } = now.current;
    if (latest === saved) return;
    now.current.saved = latest;
    save?.(latest);
  };
  useEffect(() => {
    const timer = setTimeout(send, SAVE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [m]);
  useEffect(() => send, []);
  const [topicSearch, setTopicSearch] = useState("");
  const [doi, setDoi] = useState("");
  const [refPage, setRefPage] = useState(1);
  const set = <K extends keyof Metadata>(key: K, value: Metadata[K]) => setM((was) => ({ ...was, [key]: value }));
  const setAuthor = (i: number, patch: Partial<Author>) => set("authors", m.authors.map((a, at) => (at === i ? { ...a, ...patch } : a)));
  const moveAuthor = (i: number, by: -1 | 1) => {
    const next = [...m.authors];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    set("authors", next);
  };
  const funderIds = m.funding.map((f) => f.funder.id ?? typedId(f.funder.name));
  const funderNames = { ...useFunderNames(funderIds.filter((id) => !id.startsWith("typed:"))), ...Object.fromEntries(m.funding.map((f) => [f.funder.id ?? typedId(f.funder.name), f.funder.name])) };
  const refs = pagerOf(m.references.length, REFS_PER_PAGE, refPage, setRefPage);
  const shownRefs = m.references.slice((refs.page - 1) * REFS_PER_PAGE, refs.page * REFS_PER_PAGE);
  const authors = usePage(m.authors, AUTHORS_PER_PAGE);
  const funders = usePage(m.funding, ROWS_PER_PAGE);
  const links = usePage(m.relations, ROWS_PER_PAGE);
  const addDoi = () => {
    const bare = doi.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
    if (/^10\.\d{4,9}\/\S+$/.test(bare) && !m.references.includes(bare)) set("references", [...m.references, bare]);
    setDoi("");
  };

  return (
    <div>
      <div className="mb-6 space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{onCancel ? "Correct the details" : "Check the details"}</h2>
          {onCancel ? null : <AiIcon className="size-4 text-primary" />}
        </div>
        {onCancel ? (
          <p className="max-w-xl text-sm text-muted-foreground">Your report stays live as it is while the checks read your changes. They show once the checks pass. The PDF stays the same.</p>
        ) : (
          <p className="max-w-xl text-sm text-muted-foreground">Filled in from your PDF. Correct anything that&apos;s wrong and add what&apos;s missing: the report&apos;s page shows all of it, and Crossref gets its part.</p>
        )}
      </div>
      <div className="space-y-8">
        <Section title="The work" crossref>
          <Field label="Title">
            <Textarea value={m.title} onChange={(e) => set("title", e.target.value)} rows={2} className="resize-none text-base font-medium" />
          </Field>
          <Field label="Subtitle">
            <Input value={m.subtitle} onChange={(e) => set("subtitle", e.target.value)} placeholder="None" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2 @3xl:grid-cols-4">
            <Field label="Type">
              <Select value={m.type} onValueChange={(type) => set("type", type)}>
                <SelectTrigger className="w-full" aria-label="Type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORK_TYPES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Language">
              <Select value={m.language} onValueChange={(language) => set("language", language)}>
                <SelectTrigger className="w-full" aria-label="Language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORK_LANGUAGES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {LANGUAGE.of(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Date published">
              <Input type="date" value={m.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
            <div className="space-y-1.5">
              <span className="ps-1 text-xs font-medium text-muted-foreground">Licence</span>
              <div className="flex h-9 items-center rounded-md border border-border-subtle bg-inset px-3 text-sm">{m.licence}</div>
            </div>
          </div>
        </Section>

        <Section title="Authors" crossref aside={<span className="text-xs tabular-nums text-muted-foreground">{m.authors.length}</span>}>
          <Paged pager={authors.pager} rowHeight={AUTHOR_ROW} label="authors">
          <ul className="divide-y divide-border-subtle rounded-2xl border border-border-subtle">
            {authors.shown.map((a, at) => {
              const i = authors.offset + at;
              return (
              <AuthorRow
                key={i}
                author={a}
                index={i}
                count={m.authors.length}
                onChange={(patch) => setAuthor(i, patch)}
                onMove={(by) => moveAuthor(i, by)}
                onRemove={() => set("authors", m.authors.filter((_, other) => other !== i))}
              />
              );
            })}
          </ul>
          </Paged>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              set("authors", [...m.authors, { ...BLANK_AUTHOR }]);
              authors.last(m.authors.length + 1);
            }}
          >
            <Plus /> Add an author
          </Button>
        </Section>

        <Section title="Abstract" crossref>
          <Textarea aria-label="Abstract" value={m.abstract} onChange={(e) => set("abstract", e.target.value)} rows={7} className="text-sm/6" />
        </Section>

        <Section title="Subjects" crossref={false}>
          <div className="grid gap-4 @3xl:grid-cols-2">
            <div className="space-y-1.5">
              <span className="ps-1 text-xs font-medium text-muted-foreground">Topics</span>
              <OptionPicker
                label="Topics"
                placeholder="Add a topic"
                selectedText={m.topics.length === 1 ? "1 topic" : `${m.topics.length} topics`}
                searchPlaceholder="Find a topic"
                emptyText="No topic found"
                removeLabel={(name) => `Remove ${name}`}
                options={searchTopicCatalog(topicSearch, 40).map((o) => ({ id: o.id, name: o.name, detail: o.path.join(" / ") }))}
                selected={m.topics.map((t) => t.id)}
                names={Object.fromEntries(m.topics.map((t) => [t.id, t.name]))}
                icons={Object.fromEntries(m.topics.filter((t) => t.score < 1).map((t) => [t.id, <Sureness key={t.id} score={t.score} />]))}
                onSearch={setTopicSearch}
                onToggle={(id) =>
                  set("topics", m.topics.some((t) => t.id === id) ? m.topics.filter((t) => t.id !== id) : [...m.topics, { id, name: topicName(id) ?? id, score: 1 }])
                }
              />
            </div>
            <Field label="Keywords">
              <ChipInput values={m.keywords} onChange={(keywords) => set("keywords", keywords)} placeholder="Add keywords" label="Add a keyword" />
            </Field>
            <div className="space-y-1.5">
              <span className="ps-1 text-xs font-medium text-muted-foreground">Sustainable Development Goals</span>
              <OptionPicker
                label="Sustainable Development Goals"
                placeholder="Add a goal"
                selectedText={m.sdgs.length === 1 ? "1 goal" : `${m.sdgs.length} goals`}
                searchPlaceholder="Find a goal"
                emptyText="No goal found"
                removeLabel={(name) => `Remove ${name}`}
                options={SDGS}
                selected={m.sdgs}
                names={Object.fromEntries(SDGS.map((g) => [g.id, g.name]))}
                onToggle={(id) => set("sdgs", m.sdgs.includes(id) ? m.sdgs.filter((g) => g !== id) : [...m.sdgs, id])}
              />
            </div>
            <div className="space-y-1.5">
              <span className="ps-1 text-xs font-medium text-muted-foreground">Study design</span>
              <OptionPicker
                label="Study design"
                placeholder="Add a design"
                selectedText={m.studyDesigns.length === 1 ? "1 design" : `${m.studyDesigns.length} designs`}
                searchPlaceholder="Find a design"
                emptyText="No design found"
                removeLabel={(name) => `Remove ${name}`}
                options={STUDY_DESIGNS}
                selected={m.studyDesigns}
                names={Object.fromEntries(STUDY_DESIGNS.map((d) => [d.id, d.name]))}
                onToggle={(id) => set("studyDesigns", m.studyDesigns.includes(id) ? m.studyDesigns.filter((d) => d !== id) : [...m.studyDesigns, id])}
              />
            </div>
          </div>
        </Section>

        <Section title="Places studied" crossref={false}>
          <CountrySelector label="Places studied" placeholder="Add a country or region" selectedRegions={m.countries} onSelectionChange={(countries) => set("countries", countries)} bypassLimit />
        </Section>

        <Section title="Funding" crossref>
          <OpenAlexLookupFilter
            selected={funderIds}
            onChange={(next) => set("funding", m.funding.filter((f) => next.includes(f.funder.id ?? typedId(f.funder.name))))}
            onPicked={(option) => set("funding", [...m.funding, { funder: option.id.startsWith("typed:") ? { id: null, name: option.name } : { id: option.id, name: option.name }, awards: [] }])}
            lookup={{ entity: "funders", useNames: () => funderNames, remember: rememberFunderNames, typed: (query) => ({ id: typedId(query), name: query, detail: "As typed" }) }}
            labels={{ label: "Funders", placeholder: "Add a funder", searchPlaceholder: "Find a funder", typeToSearch: "Type a funder's name", unavailable: "Funders can't be looked up now" }}
          />
          {m.funding.length ? (
            <Paged pager={funders.pager} rowHeight={ROW} label="funders">
            <ul className="divide-y divide-border-subtle rounded-2xl border border-border-subtle">
              {funders.shown.map((f, at) => {
                const i = funders.offset + at;
                return (
                <li key={f.funder.id ?? f.funder.name} className="grid items-center gap-2 px-3 py-2.5 @2xl:grid-cols-[minmax(0,14rem)_1fr]">
                  <FunderName id={f.funder.id} name={f.funder.name} className="truncate text-sm font-medium" />
                  <ChipInput
                    values={f.awards}
                    onChange={(awards) => set("funding", m.funding.map((x, n) => (n === i ? { ...x, awards } : x)))}
                    placeholder="Grant numbers"
                    label={`Add a grant number for ${f.funder.name}`}
                    mono
                  />
                </li>
                );
              })}
            </ul>
            </Paged>
          ) : null}
        </Section>

        <Section title="References" crossref aside={<span className="text-xs tabular-nums text-muted-foreground">{m.references.length}</span>}>
          {m.references.length ? (
            <Paged pager={refs} rowHeight={REF_ROW} label="references">
              <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
                {shownRefs.map((ref) => (
                  <li key={ref} style={{ height: REF_ROW - 1 }} className="flex items-center gap-2 px-3">
                    <a href={`https://doi.org/${ref}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-mono text-xs underline-offset-4 hover:underline">
                      {ref}
                    </a>
                    <TooltipHint label="Remove reference">
                      <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${ref}`} className="text-muted-foreground hover:text-destructive" onClick={() => set("references", m.references.filter((r) => r !== ref))}>
                        <Trash2 />
                      </Button>
                    </TooltipHint>
                  </li>
                ))}
              </ul>
            </Paged>
          ) : null}
          <div className="flex gap-2">
            <Input aria-label="Add a reference by DOI" placeholder="Add a DOI it cites" value={doi} onChange={(e) => setDoi(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addDoi())} className="font-mono text-xs" />
            <Button type="button" variant="outline" disabled={!doi.trim()} onClick={addDoi}>
              <Plus /> Add
            </Button>
          </div>
        </Section>

        <Section title="Data, code and other versions" crossref>
          {m.relations.length ? (
            <Paged pager={links.pager} rowHeight={ROW} label="links">
            <ul className="divide-y divide-border-subtle rounded-2xl border border-border-subtle">
              {links.shown.map((r, at) => {
                const i = links.offset + at;
                const href = linkHref(r.target);
                return (
                <li key={i} className="flex items-center gap-2 px-3 py-2">
                  <Select value={r.kind} onValueChange={(kind) => set("relations", m.relations.map((x, n) => (n === i ? { ...x, kind: kind as typeof r.kind } : x)))}>
                    <SelectTrigger size="sm" className="w-36 shrink-0" aria-label="Kind of link">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RELATION_KINDS.map((k) => (
                        <SelectItem key={k.id} value={k.id}>
                          {k.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input aria-label="Link or DOI" aria-invalid={r.target.trim() !== "" && !href} placeholder="https://… or a DOI" value={r.target} onChange={(e) => set("relations", m.relations.map((x, n) => (n === i ? { ...x, target: e.target.value } : x)))} className="h-8 min-w-0 flex-1 font-mono text-xs" />
                  {href ? (
                    <TooltipHint label="Open link">
                      <Button asChild variant="ghost" size="icon-xs" className="text-muted-foreground">
                        <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${r.target}`}>
                          <ExternalLink />
                        </a>
                      </Button>
                    </TooltipHint>
                  ) : null}
                  <TooltipHint label="Remove link">
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${r.target || "link"}`} className="text-muted-foreground hover:text-destructive" onClick={() => set("relations", m.relations.filter((_, other) => other !== i))}>
                      <Trash2 />
                    </Button>
                  </TooltipHint>
                </li>
                );
              })}
            </ul>
            </Paged>
          ) : null}
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => {
              set("relations", [...m.relations, { kind: "data", target: "" }]);
              links.last(m.relations.length + 1);
            }}>
            <Plus /> Add a link
          </Button>
        </Section>
      </div>
      <div className="mt-8 flex flex-wrap justify-end gap-2">
        {onCancel ? (
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        {/* Not in a transition: the page shows the checks running at once, which a transition would hold back until they end. */}
        <Button disabled={!m.title.trim() || !m.authors.some((a) => a.name.trim()) || (!!onCancel && m === initial)} onClick={() => void onRun(m)}>
          <ShieldCheck /> {onCancel ? "Check and publish the changes" : "Run the checks"}
        </Button>
      </div>
    </div>
  );
}
