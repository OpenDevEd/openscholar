"use client";

// A report's details as the model read them from its PDF, for the author to correct (plans/publish-reports).
// Openscholar keeps all of it and shows it on the report's page; the sections marked for Crossref go there too.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { OpenAlexLookupFilter } from "@/components/openalex-lookup-filter";
import { CountrySelector } from "@/components/country-selector";
import { OptionPicker } from "@/components/shared/option-picker";
import { Paged, pagerOf } from "@/components/settings/parts";
import { FunderName } from "@/components/papers/paper-entities";
import { AffiliationPicker } from "@/components/people/affiliation-picker";
import { OrcidButton, OrcidSearch } from "@/components/people/orcid-search";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TooltipHint } from "@/components/ui/tooltip";
import { AiIcon, ArrowDown, ArrowLeft, ArrowUp, BadgeCheck, CircleX, ExternalLink, Plus, ShieldCheck, Trash2 } from "@/components/icons";
import { WORK_LANGUAGES } from "@/lib/openalex/vocabulary";
import { useVocabulary } from "@/lib/openalex/use-vocabulary";
import { searchTopicCatalog, topicName } from "@/lib/topics/search";
import { useFunderNames, rememberFunderNames } from "@/lib/openalex/use-record-names";
import { useRelationName, useRoleName } from "@/components/reports/words";
import { CONTRIBUTION_DETAIL, FieldHelp, FieldLabel, PERSON_KINDS, type HelpKey } from "@/components/reports/field-help";
import { CREDIT_ROLES, DETAIL_CAPS, DETAIL_TEXT, EARLIEST_DATE, LICENCE_URL, RELATION_KINDS, doiIn, linkHref, type Author, type Metadata } from "@/lib/reports/report";
import { cn } from "@/lib/utils";

const REFS_PER_PAGE = 5;
const REF_ROW = 41;
const AUTHORS_PER_PAGE = 5;
const AUTHOR_ROW = 226;
const ROWS_PER_PAGE = 5;
const ROW = 53;
const BLANK_AUTHOR: Author = { name: "", orcid: "", openalexId: null, affiliations: [], corresponding: false, roles: [] };

/** A part of the details, and where it goes: Crossref as well as Openscholar, or Openscholar alone. */
function Section({ title, crossref, aside, help, children }: { title: string; crossref: boolean; aside?: ReactNode; /** mock: the "?" beside the title, for a part that is one box. */ help?: HelpKey; children: ReactNode }) {
  const t = useTranslations("publishReports.details");
  return (
    <section className="space-y-3">
      <div className="flex min-h-7 flex-wrap items-center gap-2 border-b border-border-subtle pb-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {help ? <FieldHelp field={help} className="-ms-1" /> : null}
        {aside}
        <span className={cn("ms-auto rounded-full px-2 py-0.5 text-2xs font-medium", crossref ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
          {t(crossref ? "crossrefAndOpenscholar" : "openscholar")}
        </span>
      </div>
      {children}
    </section>
  );
}

function Field({ label, help, id, children, className, counter }: { label: string; help: HelpKey; /** The id of the box inside, which the name is the label of. */ id: string; children: ReactNode; className?: string; /** How much of the box is used, for one with a limit. */ counter?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <FieldLabel label={label} help={help} htmlFor={id} counter={counter} />
      {children}
    </div>
  );
}
/** How much of a box with a limit is used, in the reader's numerals. */
function useUsed() {
  const format = useFormatter();
  return (text: string, max: number) => `${format.number(text.length)} / ${format.number(max)}`;
}

/** Words typed into a box that become chips: Enter or a comma adds one. */
function ChipInput({ values, onChange, placeholder, label, id, mono = false, max = DETAIL_TEXT.keyword }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; label: string; id?: string; mono?: boolean; /** The longest a chip's words may be. */ max?: number }) {
  const [text, setText] = useState("");
  const t = useTranslations("publishReports.details");
  const add = () => {
    const word = text.trim();
    if (word && !values.includes(word)) onChange([...values, word]);
    setText("");
  };
  return (
    <div className="flex min-h-9 min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-input bg-field px-2 py-1.5">
      {values.map((v) => (
        // A long one is cut inside its chip, so its remove button stays in the box and in reach.
        <span key={v} className={cn("inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-md bg-inset ps-2 pe-1 text-xs", mono && "font-mono")}>
          <span className="truncate">{v}</span>
          <button type="button" aria-label={t("remove", { name: v })} className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => onChange(values.filter((x) => x !== v))}>
            <CircleX className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        aria-label={label}
        value={text}
        maxLength={max}
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

function AuthorRow({ author, index, count, onChange, onMove, onRemove }: { author: Author; index: number; count: number; onChange: (patch: Partial<Author>) => void; onMove: (by: -1 | 1) => void; onRemove: () => void }) {
  const t = useTranslations("publishReports.details");
  const roleName = useRoleName();
  const [finding, setFinding] = useState(false);
  const who = author.name || t("author");
  const id = useId();
  return (
    <li className="space-y-3 p-4">
      {/* The people found on ORCID open under the whole line: a name, its institutions and an iD don't fit under the
          iD's box. On a narrow screen the iD's box takes a line of its own under the name. */}
      <Popover modal open={finding} onOpenChange={setFinding}>
      <PopoverAnchor asChild>
      {/* mock: each box on the line has its name and "?" over it; the number and the buttons sit level with the boxes. */}
      <div className="relative flex flex-wrap items-end gap-2">
        <span className="mb-1 flex size-7 shrink-0 items-center justify-center rounded-lg bg-inset text-xs font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
        <div className="min-w-0 flex-1 basis-44 space-y-1.5">
          <FieldLabel label={t("name")} help="name" htmlFor={`${id}-name`} />
          <Input id={`${id}-name`} placeholder={t("name")} maxLength={DETAIL_TEXT.name} value={author.name} onChange={(e) => onChange({ name: e.target.value })} className="font-medium" />
        </div>
        {/* mock: what the person is to the report, from Crossref's own roles. Held on this page only: nothing new is saved. */}
        <div className="w-full shrink-0 space-y-1.5 @md:w-44">
          <FieldLabel label="Role" help="kind" htmlFor={`${id}-kind`} />
          <Select value={author.kind ?? "author"} onValueChange={(kind) => onChange({ kind })}>
            <SelectTrigger id={`${id}-kind`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERSON_KINDS.map((kind) => (
                <SelectItem key={kind.id} value={kind.id}>
                  {kind.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="order-last w-full shrink-0 space-y-1.5 @xl:order-none @xl:w-56">
          <FieldLabel label="ORCID iD" help="orcid" />
          {/* The list's trigger, so focus comes back to it when the list closes; it opens under the whole line. */}
          <PopoverTrigger asChild>
            <OrcidButton orcid={author.orcid} open={finding} className="w-full" />
          </PopoverTrigger>
        </div>
        <span className="absolute -top-1.5 end-0 flex">
          <TooltipHint label={t("moveUp")}>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("moveUpLabel", { name: who })} disabled={index === 0} className="size-7 text-muted-foreground" onClick={() => onMove(-1)}>
              <ArrowUp />
            </Button>
          </TooltipHint>
          <TooltipHint label={t("moveDown")}>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("moveDownLabel", { name: who })} disabled={index === count - 1} className="size-7 text-muted-foreground" onClick={() => onMove(1)}>
              <ArrowDown />
            </Button>
          </TooltipHint>
          <TooltipHint label={t("removeAuthor")}>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("remove", { name: who })} disabled={count === 1} className="size-7 text-muted-foreground hover:text-destructive" onClick={onRemove}>
              <Trash2 />
            </Button>
          </TooltipHint>
        </span>
      </div>
      </PopoverAnchor>
      <PopoverContent align="end" className="w-[min(var(--radix-popover-trigger-width),28rem)] p-0">
        <OrcidSearch
          name={author.name}
          institutions={author.affiliations.map((a) => a.name)}
          current={author.orcid}
          onPick={(orcid, name) => {
            // The name stays as the report prints it; an empty one takes ORCID's.
            onChange({ orcid, orcidFound: undefined, ...(!author.name.trim() && name && { name }) });
            setFinding(false);
          }}
          onRemove={() => {
            onChange({ orcid: "", orcidFound: undefined });
            setFinding(false);
          }}
        />
      </PopoverContent>
      </Popover>
      {author.orcidFound && author.orcid ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground @xl:ps-9">
          <BadgeCheck className="size-3.5 shrink-0 text-primary" />
          <span className="min-w-0">{t("orcidFound", { institution: author.orcidFound })}</span>
        </p>
      ) : null}
      {/* min-w-0: a long institution's name is cut inside its column, and never widens the form past a phone's screen. */}
      <div className="grid gap-3 @xl:ps-9 @2xl:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <FieldLabel label={t("affiliations")} help="affiliations" />
          <AffiliationPicker value={author.affiliations} onChange={(affiliations) => onChange({ affiliations })} />
        </div>
        <div className="min-w-0 space-y-1.5">
          {/* mock: "Contributor roles" read as a second kind of person. It is what the person did, each with CRediT's meaning. */}
          <FieldLabel label="Contributions" help="contributions" />
          <OptionPicker
          label="Contributions"
          placeholder="What this person did"
          selectedText={`${author.roles.length} ${author.roles.length === 1 ? "contribution" : "contributions"}`}
          searchPlaceholder="Find a contribution"
          emptyText={t("noRole")}
          removeLabel={(name) => t("remove", { name })}
          options={CREDIT_ROLES.map((role) => ({ id: role, name: roleName(role), detail: CONTRIBUTION_DETAIL[role] }))}
          selected={author.roles}
          names={Object.fromEntries(CREDIT_ROLES.map((role) => [role, roleName(role)]))}
          onToggle={(role) => onChange({ roles: author.roles.includes(role) ? author.roles.filter((r) => r !== role) : [...author.roles, role] })}
          />
        </div>
      </div>
      <div className="flex w-fit items-center gap-0.5 @xl:ps-9">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={author.corresponding} onCheckedChange={(corresponding) => onChange({ corresponding })} />
          {t("corresponding")}
        </label>
        <FieldHelp field="corresponding" />
      </div>
    </li>
  );
}

/** How long after the last change the details are saved. */
/** Today as the person's own calendar has it, as a date input takes it. */
const localToday = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
const SAVE_AFTER_MS = 250;
/** mock: the details without each person's role, which the server has no place for yet. */
const saved = <M extends Partial<Metadata>>(m: M): M => (m.authors ? { ...m, authors: m.authors.map(({ kind: _kind, ...author }) => author) } : m);

export function DetailsStep({
  initial,
  onRun,
  onSave,
  onTouched,
  onCancel,
  onBack,
  resend = false,
  waits = false,
  words,
  unread = false,
  version,
}: {
  initial: Metadata;
  /** Given the details, and the `version` the form opened on. */
  onRun: (m: Metadata, version: number | undefined) => Promise<void>;
  /** What the details were when the form opened, by the number that tells one state of the report from the next. It
   * is kept as it was then, so details saved since by someone else are never written over by this form. */
  version?: number;
  /** Given the fields this form changed and the `version` it opened on, a moment after each change. Only those
   * fields: the rest may have been saved since by another tab, which a whole snapshot would write over. */
  onSave?: (changes: Partial<Metadata>, version: number | undefined) => void;
  /** Called at the first change made to the form: from then on it holds something that isn't saved anywhere. */
  onTouched?: () => void;
  /** Given when a live report's details are being corrected: the form says so, and can be left without changing
   * anything. Given the `version` the form opened on. */
  onCancel?: (version: number | undefined) => void;
  /** Back to the PDF, while the report is still being made. */
  onBack?: () => void;
  /** The details shown are changes already made and not yet live, so they can be sent to the checks as they are. */
  resend?: boolean;
  /** A reviewer approves this report's changes before they go live, whatever the checks say. */
  waits?: boolean;
  /** The form's heading, what it says under it and its button, where someone other than the author fills it in: a reviewer editing a report's details. */
  words?: { title: string; intro: string; action: string };
  /** The details couldn't be read from the PDF, so the form starts nearly empty and says so instead of "Filled in". */
  unread?: boolean;
}) {
  // Only the fields changed in this form are its own; the rest follow the report as it is now. Another tab's newer
  // title is then shown here, and sent back unchanged with this form's next save instead of being written over.
  const [own, setOwn] = useState<Partial<Metadata>>({});
  const m: Metadata = { ...initial, ...own };
  const t = useTranslations("publishReports.details");
  const format = useFormatter();
  const vocabulary = useVocabulary();
  const locale = useLocale();
  const used = useUsed();
  const relationName = useRelationName();
  const languageName = new Intl.DisplayNames([locale], { type: "language" });
  const [opened] = useState(version);
  const id = useId();
  const [touched, setTouched] = useState(false);
  // Corrections are saved a moment after the last change, by the change itself: each one restarts the wait. The wait
  // runs out whether or not the step is still open, so leaving it loses nothing, and a save that arrives once the
  // report has moved on changes nothing (saveDetails).
  const held = useRef({ own: {} as Partial<Metadata>, timer: undefined as ReturnType<typeof setTimeout> | undefined, send: undefined as (() => void) | undefined });
  const sendNow = () => {
    clearTimeout(held.current.timer);
    held.current.send?.();
    held.current.send = undefined;
  };
  const change = (update: (was: Metadata) => Metadata) => {
    const was: Metadata = { ...initial, ...held.current.own };
    const next = update(was);
    const own = { ...held.current.own, ...Object.fromEntries(Object.entries(next).filter(([field, value]) => value !== was[field as keyof Metadata])) };
    // Told once, at the first change: the report's own details can arrive anew at any time, so what the form was
    // opened with is no way to tell an untouched form from a changed one.
    if (!touched) {
      setTouched(true);
      onTouched?.();
    }
    held.current.own = own;
    setOwn(own);
    clearTimeout(held.current.timer);
    held.current.send = onSave ? () => onSave(saved(own), opened) : undefined;
    held.current.timer = setTimeout(sendNow, SAVE_AFTER_MS);
  };
  // The browser's page lifecycle is the outside system here. A reload or a closed tab inside the wait would lose
  // what the wait is holding, and nothing sent while a page unloads is sure to arrive: the browser asks first, as it
  // does for any unsaved form, and the change is sent meanwhile.
  useEffect(() => {
    const ask = (event: BeforeUnloadEvent) => {
      if (!held.current.send) return;
      sendNow();
      event.preventDefault();
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, []);
  const [topicSearch, setTopicSearch] = useState("");
  const [doi, setDoi] = useState("");
  const [refPage, setRefPage] = useState(1);
  const set = <K extends keyof Metadata>(key: K, value: Metadata[K]) => change((was) => ({ ...was, [key]: value }));
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
  // Why the DOI typed wasn't added, said under its box until it is typed again.
  const [doiTrouble, setDoiTrouble] = useState<string | null>(null);
  const addDoi = () => {
    const bare = doiIn(doi);
    if (!bare) return setDoiTrouble(t("notDoi"));
    if (m.references.includes(bare)) return setDoiTrouble(t("doiListed"));
    if (m.references.length >= DETAIL_CAPS.references) return setDoiTrouble(t("tooManyRefs", { max: format.number(DETAIL_CAPS.references) }));
    set("references", [...m.references, bare]);
    setDoi("");
  };
  const future = m.date > localToday();
  const early = !!m.date && m.date < EARLIEST_DATE;
  // A link that is neither a web address nor a DOI leads nowhere: it holds the checks until it is one, or removed.
  const wrongLinks = m.relations.some((r) => r.target.trim() !== "" && !linkHref(r.target));

  return (
    <div>
      <div className="mb-6 space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{words?.title ?? t(onCancel ? "correctTitle" : "checkTitle")}</h2>
          {onCancel ? null : <AiIcon className="size-4 text-primary" />}
        </div>
        {words ? (
          <p className="max-w-xl text-sm text-muted-foreground">{words.intro}</p>
        ) : onCancel ? (
          <p className="max-w-xl text-sm text-muted-foreground">{t(waits ? "correctWaits" : "correctLive")}</p>
        ) : (
          <p className="max-w-xl text-sm text-muted-foreground">
            {t(unread ? "introUnread" : "introRead")}
          </p>
        )}
      </div>
      <div className="space-y-8">
        <Section title={t("work")} crossref>
          <Field label={t("title")} help="title" id={`${id}-title`} counter={used(m.title, DETAIL_TEXT.title)}>
            <Textarea id={`${id}-title`} value={m.title} maxLength={DETAIL_TEXT.title} onChange={(e) => set("title", e.target.value)} rows={2} className="resize-none text-base font-medium" />
          </Field>
          <Field label={t("subtitle")} help="subtitle" id={`${id}-subtitle`} counter={m.subtitle ? used(m.subtitle, DETAIL_TEXT.subtitle) : undefined}>
            <Input id={`${id}-subtitle`} value={m.subtitle} maxLength={DETAIL_TEXT.subtitle} onChange={(e) => set("subtitle", e.target.value)} placeholder={t("none")} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2 @3xl:grid-cols-4">
            <Field label={t("type")} help="type" id={`${id}-type`}>
              <Select value={m.type} onValueChange={(type) => set("type", type)}>
                <SelectTrigger id={`${id}-type`} className="w-full" aria-label={t("type")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {vocabulary.workTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("language")} help="language" id={`${id}-language`}>
              <Select value={m.language} onValueChange={(language) => set("language", language)}>
                <SelectTrigger id={`${id}-language`} className="w-full" aria-label={t("language")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORK_LANGUAGES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {languageName.of(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("date")} help="date" id={`${id}-date`}>
              {/* A report is published by today, as the author's own calendar has it. A date typed past it says so here, before the checks are asked for. */}
              <Input id={`${id}-date`} type="date" value={m.date} min={EARLIEST_DATE} max={localToday()} aria-invalid={future || early || undefined} onChange={(e) => set("date", e.target.value)} />
              {future || early ? <span className="block ps-1 text-xs text-destructive">{t(future ? "future" : "tooEarly")}</span> : null}
            </Field>
            <div className="space-y-1.5">
              <FieldLabel label={t("licence")} help="licence" />
              <div className="flex h-9 items-center rounded-md border border-border-subtle bg-inset px-3 text-sm">
                <a href={LICENCE_URL[m.licence]} target="_blank" rel="noreferrer license" className="inline-flex items-center gap-1.5 underline-offset-2 hover:underline">
                  {m.licence}
                  <ExternalLink className="size-3.5 text-muted-foreground" />
                </a>
              </div>
            </div>
          </div>
        </Section>

        <Section title={t("authors")} help="authors" crossref aside={<span className="text-xs tabular-nums text-muted-foreground">{m.authors.length}</span>}>
          <Paged pager={authors.pager} rowHeight={AUTHOR_ROW} label={t("authorsPager")}>
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
            <Plus /> {t("addAuthor")}
          </Button>
        </Section>

        <Section title={t("abstract")} help="abstract" crossref aside={<span className="font-mono text-xs tabular-nums text-muted-foreground">{used(m.abstract, DETAIL_TEXT.abstract)}</span>}>
          <Textarea aria-label={t("abstract")} value={m.abstract} maxLength={DETAIL_TEXT.abstract} onChange={(e) => set("abstract", e.target.value)} rows={7} className="text-sm/6" />
        </Section>

        <Section title={t("subjects")} crossref={false}>
          <div className="grid gap-4 @3xl:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <FieldLabel label={t("topics")} help="topics" />
              <OptionPicker
                label={t("topics")}
                placeholder={t("addTopic")}
                selectedText={t("topicCount", { count: m.topics.length })}
                searchPlaceholder={t("findTopic")}
                emptyText={t("noTopic")}
                removeLabel={(name) => t("remove", { name })}
                options={searchTopicCatalog(topicSearch, 40).map((o) => ({ id: o.id, name: o.name, detail: o.path.join(" / ") }))}
                selected={m.topics.map((topic) => topic.id)}
                names={Object.fromEntries(m.topics.map((topic) => [topic.id, topic.name]))}
                icons={Object.fromEntries(m.topics.filter((topic) => topic.score < 1).map((topic) => [topic.id, <Sureness key={topic.id} score={topic.score} />]))}
                onSearch={setTopicSearch}
                onToggle={(id) =>
                  set("topics", m.topics.some((topic) => topic.id === id) ? m.topics.filter((topic) => topic.id !== id) : [...m.topics, { id, name: topicName(id) ?? id, score: 1 }])
                }
              />
            </div>
            <Field label={t("keywords")} help="keywords" id={`${id}-keywords`}>
              <ChipInput id={`${id}-keywords`} values={m.keywords} onChange={(keywords) => set("keywords", keywords)} placeholder={t("addKeywords")} label={t("addKeyword")} />
            </Field>
            <div className="min-w-0 space-y-1.5">
              <FieldLabel label={t("sdgs")} help="sdgs" />
              <OptionPicker
                label={t("sdgs")}
                placeholder={t("addGoal")}
                selectedText={t("goalCount", { count: m.sdgs.length })}
                searchPlaceholder={t("findGoal")}
                emptyText={t("noGoal")}
                removeLabel={(name) => t("remove", { name })}
                options={vocabulary.sdgs}
                selected={m.sdgs}
                names={Object.fromEntries(vocabulary.sdgs.map((g) => [g.id, g.name]))}
                onToggle={(id) => set("sdgs", m.sdgs.includes(id) ? m.sdgs.filter((g) => g !== id) : [...m.sdgs, id])}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <FieldLabel label={t("design")} help="design" />
              <OptionPicker
                label={t("design")}
                placeholder={t("addDesign")}
                selectedText={t("designCount", { count: m.studyDesigns.length })}
                searchPlaceholder={t("findDesign")}
                emptyText={t("noDesign")}
                removeLabel={(name) => t("remove", { name })}
                options={vocabulary.studyDesigns}
                selected={m.studyDesigns}
                names={Object.fromEntries(vocabulary.studyDesigns.map((d) => [d.id, d.name]))}
                onToggle={(id) => set("studyDesigns", m.studyDesigns.includes(id) ? m.studyDesigns.filter((d) => d !== id) : [...m.studyDesigns, id])}
              />
            </div>
          </div>
        </Section>

        <Section title={t("places")} help="places" crossref={false}>
          <CountrySelector label={t("places")} placeholder={t("addPlace")} selectedRegions={m.countries} onSelectionChange={(countries) => set("countries", countries)} bypassLimit />
        </Section>

        <Section title={t("funding")} help="funding" crossref>
          <OpenAlexLookupFilter
            selected={funderIds}
            onChange={(next) => set("funding", m.funding.filter((f) => next.includes(f.funder.id ?? typedId(f.funder.name))))}
            onPicked={(option) => set("funding", [...m.funding, { funder: option.id.startsWith("typed:") ? { id: null, name: option.name } : { id: option.id, name: option.name }, awards: [] }])}
            lookup={{ entity: "funders", useNames: () => funderNames, remember: rememberFunderNames, typed: (query) => ({ id: typedId(query), name: query, detail: t("asTyped") }) }}
            labels={{ label: t("funders"), placeholder: t("addFunder"), searchPlaceholder: t("findFunder"), typeToSearch: t("typeFunder"), unavailable: t("fundersDown") }}
          />
          {m.funding.length ? (
            <Paged pager={funders.pager} rowHeight={ROW} label={t("fundersPager")}>
            <ul className="divide-y divide-border-subtle rounded-2xl border border-border-subtle">
              {funders.shown.map((f, at) => {
                const i = funders.offset + at;
                return (
                <li key={f.funder.id ?? f.funder.name} className="grid grid-cols-[minmax(0,1fr)] items-center gap-2 px-3 py-2.5 @2xl:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                  <FunderName id={f.funder.id} name={f.funder.name} className="truncate text-sm font-medium" />
                  <ChipInput
                    values={f.awards}
                    onChange={(awards) => set("funding", m.funding.map((x, n) => (n === i ? { ...x, awards } : x)))}
                    placeholder={t("grants")}
                    label={t("addGrant", { name: f.funder.name })}
                    mono
                  />
                </li>
                );
              })}
            </ul>
            </Paged>
          ) : null}
        </Section>

        <Section title={t("references")} help="references" crossref aside={<span className="text-xs tabular-nums text-muted-foreground">{m.references.length}</span>}>
          {m.references.length ? (
            <Paged pager={refs} rowHeight={REF_ROW} label={t("referencesPager")}>
              <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
                {shownRefs.map((ref) => (
                  <li key={ref} style={{ height: REF_ROW - 1 }} className="flex items-center gap-2 px-3">
                    <a href={`https://doi.org/${ref}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-mono text-xs underline-offset-4 hover:underline">
                      {ref}
                    </a>
                    <TooltipHint label={t("removeReference")}>
                      <Button type="button" variant="ghost" size="icon-xs" aria-label={t("remove", { name: ref })} className="text-muted-foreground hover:text-destructive" onClick={() => set("references", m.references.filter((r) => r !== ref))}>
                        <Trash2 />
                      </Button>
                    </TooltipHint>
                  </li>
                ))}
              </ul>
            </Paged>
          ) : null}
          <div className="flex gap-2">
            <Input aria-label={t("addReference")} aria-invalid={!!doiTrouble} placeholder={t("doiPlaceholder")} value={doi} onChange={(e) => (setDoi(e.target.value), setDoiTrouble(null))} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addDoi())} className="font-mono text-xs" />
            <Button type="button" variant="outline" disabled={!doi.trim()} onClick={addDoi}>
              <Plus /> {t("add")}
            </Button>
          </div>
          {doiTrouble ? <p role="alert" className="ps-1 text-xs text-destructive">{doiTrouble}</p> : null}
        </Section>

        <Section title={t("links")} help="links" crossref>
          {wrongLinks ? <p role="alert" className="ps-1 text-xs text-destructive">{t("wrongLink")}</p> : null}
          {m.relations.length ? (
            <Paged pager={links.pager} rowHeight={ROW} label={t("linksPager")}>
            <ul className="divide-y divide-border-subtle rounded-2xl border border-border-subtle">
              {links.shown.map((r, at) => {
                const i = links.offset + at;
                const href = linkHref(r.target);
                return (
                // On a narrow screen the address takes a line of its own, under its kind and its buttons: beside them it had no room to be read.
                <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <Select value={r.kind} onValueChange={(kind) => set("relations", m.relations.map((x, n) => (n === i ? { ...x, kind: kind as typeof r.kind } : x)))}>
                    <SelectTrigger size="sm" className="w-36 shrink-0" aria-label={t("linkKind")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RELATION_KINDS.map((k) => (
                        <SelectItem key={k.id} value={k.id}>
                          {relationName(k.id)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input aria-label={t("linkLabel")} aria-invalid={r.target.trim() !== "" && !href} maxLength={DETAIL_TEXT.link} placeholder={t("linkPlaceholder")} value={r.target} onChange={(e) => set("relations", m.relations.map((x, n) => (n === i ? { ...x, target: e.target.value } : x)))} className="order-last h-8 min-w-0 basis-full font-mono text-xs @xl:order-none @xl:flex-1 @xl:basis-0" />
                  <span className="ms-auto flex items-center gap-2 @xl:ms-0">
                  {href ? (
                    <TooltipHint label={t("openLink")}>
                      <Button asChild variant="ghost" size="icon-xs" className="text-muted-foreground">
                        <a href={href} target="_blank" rel="noopener noreferrer" aria-label={t("openLabel", { target: r.target })}>
                          <ExternalLink />
                        </a>
                      </Button>
                    </TooltipHint>
                  ) : null}
                  <TooltipHint label={t("removeLink")}>
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={t("remove", { name: r.target || t("link") })} className="text-muted-foreground hover:text-destructive" onClick={() => set("relations", m.relations.filter((_, other) => other !== i))}>
                      <Trash2 />
                    </Button>
                  </TooltipHint>
                  </span>
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
            <Plus /> {t("addLink")}
          </Button>
        </Section>
      </div>
      <div className="mt-8 flex flex-wrap justify-end gap-2">
        {onBack ? (
          <Button variant="ghost" className="-ms-3 me-auto text-muted-foreground" onClick={() => {
            // An edit still waiting to be saved goes first: once the report is back at its PDF, a save of its details is refused.
            sendNow();
            onBack();
          }}>
            <ArrowLeft /> {t("back")}
          </Button>
        ) : null}
        {onCancel ? (
          <Button variant="outline" onClick={() => {
            // What was typed is given up, so a save still waiting must never arrive after it.
            clearTimeout(held.current.timer);
            held.current.send = undefined;
            onCancel(opened);
          }}>
            {t("cancel")}
          </Button>
        ) : null}
        {/* Not in a transition: the page shows the checks running at once, which a transition would hold back until they end. */}
        <Button disabled={!m.title.trim() || !m.authors.some((a) => a.name.trim()) || future || early || wrongLinks || (!!onCancel && !resend && !touched)} onClick={() => {
          // The run carries the details as they are, so a save still waiting has nothing left to send.
          clearTimeout(held.current.timer);
          held.current.send = undefined;
          void onRun(saved(m), opened);
        }}>
          <ShieldCheck /> {words ? words.action : t(onCancel ? (waits ? "sendForReview" : "checkAndPublish") : "runChecks")}
        </Button>
      </div>
    </div>
  );
}
