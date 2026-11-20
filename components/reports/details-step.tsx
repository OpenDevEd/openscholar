"use client";

// A report's details as the model read them from its PDF, for the author to correct (plans/publish-reports).
// Openscholar keeps all of it and shows it on the report's page; each part's "?" says which registrars are sent it.

import { useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { flushSync } from "react-dom";
import { OpenAlexLookupFilter } from "@/components/openalex-lookup-filter";
import { CountrySelector } from "@/components/country-selector";
import { OptionPicker } from "@/components/shared/option-picker";
import { Paged, pagerOf } from "@/components/settings/parts";
import { FunderName, RorLink } from "@/components/papers/paper-entities";
import { findRor } from "@/app/actions/people-lookup";
import { AffiliationPicker } from "@/components/people/affiliation-picker";
import { OrcidButton, OrcidSearch } from "@/components/people/orcid-search";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { AutoHeight } from "@/components/ui/auto-height";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { NextButton } from "@/components/reports/next-button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TooltipHint } from "@/components/ui/tooltip";
import { AiIcon, ArrowDown, ArrowLeft, ArrowUp, BadgeCheck, CircleX, ExternalLink, Pencil, Plus, ShieldCheck, Trash2 } from "@/components/icons";
import { WORK_LANGUAGES } from "@/lib/openalex/vocabulary";
import { useVocabulary } from "@/lib/openalex/use-vocabulary";
import { searchTopicCatalog, topicName } from "@/lib/topics/search";
import { useFunderNames, rememberFunderNames } from "@/lib/openalex/use-record-names";
import { useKindName, useRelationName, useRoleDetail, useRoleName } from "@/components/reports/words";
import { CREDIT_ROLES, DETAIL_CAPS, DETAIL_TEXT, EARLIEST_YEAR, dateParts, licenceName, licenceUrl, daysIn, RELATION_KINDS, doiIn, doiWithin, linkHref, PERSON_KINDS, referenceFrom, type Author, type Metadata, type PersonKind, type Reference } from "@/lib/reports/report";
import { FieldHelp, FieldLabel, RegistrarsProvider, type HelpKey } from "@/components/reports/field-help";
import { ReferenceBox } from "@/components/reports/reference-box";
import { cn } from "@/lib/utils";
import { FieldMessage, StepNav, useStepForm } from "@/components/reports/form";

const REFS_PER_PAGE = 5;
const REF_ROW = 41;
const AUTHORS_PER_PAGE = 5;
const AUTHOR_ROW = 226;
const ROWS_PER_PAGE = 5;
const ROW = 53;
const BLANK_AUTHOR: Author = { name: "", orcid: "", openalexId: null, affiliations: [], corresponding: false, roles: [] };

function Section({ title, aside, help, children }: { title: string; aside?: ReactNode; /** The "?" beside the title, for a part that is one box. */ help?: HelpKey; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex min-h-7 flex-wrap items-center gap-2 border-b border-border-subtle pb-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {help ? <FieldHelp field={help} className="-ms-1" /> : null}
        {aside}
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
/** No month, or no day: the date stops at the year, or at the month. */
const NONE = "none";
const pad = (n: number) => String(n).padStart(2, "0");
const dateOf = (year: number, month?: number, day?: number) => `${year}${month ? `-${pad(month)}${day ? `-${pad(day)}` : ""}` : ""}`;

/**
 * A report's date as its PDF states it: a year, then a month and a day where it gives them. The form saves as it is
 * typed and saving refuses what isn't a date, so a year is saved only once it is a whole one; until then it is held
 * here, and the form says so, which keeps the month and day while a year is typed over. Leaving the year box empty
 * clears the date; leaving it unfinished puts the saved year back, so the box never shows what isn't saved. A day the
 * month doesn't have goes when the month changes.
 */
function DateField({ yearId, errorId, date, typed, onTyped, onDate, invalid, children }: { /** The message under the date, which the year box names while it is wrong. */ errorId: string; /** The year's box, for the step's Next to take the person to. */ yearId: string; date: string; /** A year being typed that isn't one yet. */ typed: string | null; onTyped: (typed: string | null) => void; onDate: (date: string) => void; invalid: boolean; children?: ReactNode }) {
  const t = useTranslations("publishReports.details");
  const format = useFormatter();
  const id = useId();
  const parts = dateParts(date);
  const year = parts?.year;
  const dayIn = (y: number, month: number) => (parts?.day && parts.day <= daysIn(y, month) ? parts.day : undefined);
  const typeYear = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 4);
    if (digits.length < 4 || Number(digits) < EARLIEST_YEAR) return onTyped(digits);
    onTyped(null);
    const y = Number(digits);
    onDate(dateOf(y, parts?.month, parts?.month ? dayIn(y, parts.month) : undefined));
  };
  const name = (month: number) => format.dateTime(new Date(Date.UTC(2000, month - 1, 1)), { month: "short", timeZone: "UTC" });
  return (
    <div role="group" aria-labelledby={id} className="@container min-w-0 space-y-1.5">
      {/* Its "?" sits beside the name that labels the group, not inside it. */}
      <span className="flex items-center gap-0.5 ps-1 text-xs font-medium text-muted-foreground">
        <span id={id}>{t("date")}</span>
        <FieldHelp field="date" />
      </span>
      {/* On a phone at large text the three don't fit a row: they stack, each full width. */}
      <div className="flex gap-1.5 max-sm:@max-[14.5rem]:flex-col">
        <Input
          id={yearId}
          aria-label={t("dateYear")}
          inputMode="numeric"
          autoComplete="off"
          value={typed ?? (year ? String(year) : "")}
          aria-invalid={typed !== null || !parts || invalid || undefined}
          aria-describedby={typed !== null || !parts || invalid ? errorId : undefined}
          onChange={(e) => typeYear(e.target.value)}
          onBlur={() => {
            if (typed === null) return;
            onTyped(null);
            if (typed === "") onDate("");
          }}
          className="w-[4.25rem] shrink-0 tabular-nums max-sm:@max-[14.5rem]:w-full"
        />
        <Select value={parts?.month ? pad(parts.month) : ""} disabled={!year || typed !== null} onValueChange={(month) => year && onDate(month === NONE ? dateOf(year) : dateOf(year, Number(month), dayIn(year, Number(month))))}>
          <SelectTrigger className="min-w-0 flex-1 max-sm:@max-[14.5rem]:w-full max-sm:@max-[14.5rem]:flex-none" aria-label={t("dateMonth")}>
            <SelectValue placeholder={t("dateMonth")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("noMonth")}</SelectItem>
            {Array.from({ length: 12 }, (_, i) => (
              <SelectItem key={i} value={pad(i + 1)}>
                {name(i + 1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={parts?.day ? pad(parts.day) : ""} disabled={!year || !parts?.month || typed !== null} onValueChange={(day) => year && parts?.month && onDate(dateOf(year, parts.month, day === NONE ? undefined : Number(day)))}>
          {/* As wide as its word, in every language: "Day", "Jour", "Tag". */}
          <SelectTrigger className="min-w-[4.25rem] shrink-0 max-sm:@max-[14.5rem]:w-full max-sm:@max-[14.5rem]:min-w-0" aria-label={t("dateDay")}>
            <SelectValue placeholder={t("dateDay")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("noDay")}</SelectItem>
            {year && parts?.month
              ? Array.from({ length: daysIn(year, parts.month) }, (_, i) => (
                  <SelectItem key={i} value={pad(i + 1)}>
                    {format.number(i + 1)}
                  </SelectItem>
                ))
              : null}
          </SelectContent>
        </Select>
      </div>
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

/** A ROR ID as one key, however it was written (`https://ror.org/037wke960` or `037wke960`). */
const rorOf = (ror: string | undefined) => ror?.replace(/^https?:\/\/ror\.org\//i, "").toLowerCase();
/** A funder's chip: OpenAlex's by its ID, one only ROR knows by its ROR ID, or the name as typed. */
const funderChip = (funder: Metadata["funding"][number]["funder"]) => funder.id ?? (funder.ror ? `ror:${funder.ror}` : typedId(funder.name));
/** The funder a picked option is: OpenAlex's with the ROR ID it has, one found on ROR by its ROR ID, or the name as typed. */
const funderOf = (option: { id: string; name: string; ror?: string }): Metadata["funding"][number]["funder"] =>
  option.id.startsWith("typed:") ? { id: null, name: option.name } : { id: option.id.startsWith("ror:") ? null : option.id, name: option.name, ...(option.ror && { ror: option.ror }) };

/** One page of an editable list, and where it starts; `last` turns to the page a new row lands on. */
function usePage<T>(list: T[], size: number) {
  const [page, setPage] = useState(1);
  const pager = pagerOf(list.length, size, page, setPage);
  const offset = (pager.page - 1) * size;
  return { pager, offset, shown: list.slice(offset, offset + size), last: (length: number) => setPage(Math.max(1, Math.ceil(length / size))), show: (index: number) => setPage(Math.floor(index / size) + 1) };
}

function AuthorRow({ author, index, count, onChange, onMove, onRemove, nameId, nameError }: { author: Author; index: number; count: number; onChange: (patch: Partial<Author>) => void; onMove: (by: -1 | 1) => void; onRemove: () => void; /** The name's box, for the step's Next to take the person to (the first row's). */ nameId?: string; /** No author is named yet: the list says so under it. */ nameError?: boolean }) {
  const t = useTranslations("publishReports.details");
  const tp = useTranslations("people");
  const roleName = useRoleName();
  const roleDetail = useRoleDetail();
  const kindName = useKindName();
  const [finding, setFinding] = useState(false);
  const who = author.name || t("author");
  const id = useId();
  return (
    <li className="space-y-3 p-4">
      {/* The people found on ORCID open under the whole line: a name, its institutions and an iD don't fit under the
          iD's box. On a narrow screen the iD's box takes a line of its own under the name. */}
      <Popover modal open={finding} onOpenChange={setFinding}>
      <PopoverAnchor asChild>
      {/* Each box on the line has its name and "?" over it; the number and the buttons sit level with the boxes. */}
      <div className="relative flex flex-wrap items-end gap-2">
        <span className="mb-1 flex size-7 shrink-0 items-center justify-center rounded-lg bg-inset text-xs font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
        <div className="min-w-0 flex-1 basis-44 space-y-1.5">
          <FieldLabel label={t("name")} help="name" htmlFor={`${id}-name`} />
          <Input id={nameId ?? `${id}-name`} placeholder={t("name")} maxLength={DETAIL_TEXT.name} value={author.name} onChange={(e) => onChange({ name: e.target.value })} className="font-medium" aria-invalid={nameError || undefined} aria-describedby={nameError ? `${nameId?.replace(/-author-name$/, "-authors-error")}` : undefined} />
        </div>
        {/* What the person is to the report, in Crossref's own roles: an author unless set. */}
        <div className="w-full shrink-0 space-y-1.5 @md:w-44">
          <FieldLabel label={t("role")} help="kind" htmlFor={`${id}-kind`} />
          <Select value={author.kind ?? "author"} onValueChange={(kind) => onChange({ kind: kind as PersonKind })}>
            <SelectTrigger id={`${id}-kind`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERSON_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {kindName(kind)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="order-last w-full shrink-0 space-y-1.5 @xl:order-none @xl:w-56">
          <FieldLabel label={t("orcidLabel")} help="orcid" />
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
      <PopoverContent align="end" aria-label={tp("find")} className="w-[min(var(--radix-popover-trigger-width),28rem)] p-0">
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
          {/* What the person did, each with CRediT's meaning: "Contributor roles" read as a second kind of person. */}
          <FieldLabel label={t("contributions")} help="contributions" />
          <OptionPicker
          label={t("contributions")}
          placeholder={t("contributionsPlaceholder")}
          selectedText={t("contributionCount", { count: author.roles.length })}
          searchPlaceholder={t("findContribution")}
          emptyText={t("noContribution")}
          removeLabel={(name) => t("remove", { name })}
          options={CREDIT_ROLES.map((role) => ({ id: role, name: roleName(role), detail: roleDetail(role) }))}
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

/** The button that has an abstract written from the PDF. Over one already there, it asks first. */
function WriteAbstract({ filled, writing, onWrite }: { filled: boolean; writing: boolean; onWrite: () => void }) {
  const t = useTranslations("publishReports.details");
  const button = (onClick?: () => void) => (
    <Button type="button" variant="outline" size="xs" disabled={writing} onClick={onClick}>
      {writing ? <Spinner className="size-3" /> : <AiIcon className="size-3" />} {t("writeAbstract")}
    </Button>
  );
  if (!filled) return button(onWrite);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{button()}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("replaceAbstractTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("replaceAbstractBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("keepAbstract")}</AlertDialogCancel>
          <AlertDialogAction onClick={onWrite}>{t("replaceAbstract")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** How long after the last change the details are saved. */
/** Today as the person's own calendar has it, as a date input takes it. */
const localToday = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
const SAVE_AFTER_MS = 250;

export function DetailsStep({
  initial,
  onRun,
  onSave,
  onTouched,
  onCancel,
  onBack,
  onReturn,
  ref,
  resend = false,
  waits = false,
  words,
  unread = false,
  version,
  writing: writingFor,
  registrars,
}: {
  /** The report an abstract is written from, and the workspace its author asks from; none for a reviewer. Without it the form offers none. */
  writing?: { key: string; workspaceId?: Id<"workspaces"> };
  /** The registrars the report is sent to, so each part's "?" leaves out one that isn't used. */
  registrars?: { crossref: boolean; zenodo: boolean };
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
  /** Back to the checks it was taken from, as they were. Offered until something in the form changes. */
  onReturn?: () => void;
  /** Sends an edit still waiting to be saved now: the page does before it moves the report to another step, which a save arriving after would be refused by. */
  ref?: Ref<{ flush: () => void }>;
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
  const tPeople = useTranslations("people");
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
  const held = useRef({ own: {} as Partial<Metadata>, timer: undefined as ReturnType<typeof setTimeout> | undefined, send: undefined as (() => void) | undefined, /** Run or given up: nothing arriving later, such as an abstract, may change it. */ closed: false });
  const sendNow = () => {
    clearTimeout(held.current.timer);
    held.current.send?.();
    held.current.send = undefined;
  };
  useImperativeHandle(ref, () => ({ flush: sendNow }));
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
    // A date in the future shows its warning and is kept back, as a year still being typed is: saving refuses it.
    const { date, ...rest } = own;
    const sendable = date !== undefined && date > localToday() ? rest : own;
    held.current.send = onSave && Object.keys(sendable).length ? () => onSave(sendable, opened) : undefined;
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
  const [refPage, setRefPage] = useState(1);
  const set = <K extends keyof Metadata>(key: K, value: Metadata[K]) => change((was) => ({ ...was, [key]: value }));
  const setAuthor = (i: number, patch: Partial<Author>) => set("authors", m.authors.map((a, at) => (at === i ? { ...a, ...patch } : a)));
  const moveAuthor = (i: number, by: -1 | 1) => {
    const next = [...m.authors];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    set("authors", next);
  };
  const funderIds = m.funding.map((f) => funderChip(f.funder));
  const funderNames = { ...useFunderNames(funderIds.filter((id) => /^F\d/.test(id))), ...Object.fromEntries(m.funding.map((f) => [funderChip(f.funder), f.funder.name])) };
  // The works cited as their list writes them; a report read before these were kept has its DOIs alone. `references`
  // stays the DOIs among them, which the checks and registrars read.
  const cited: Reference[] = m.citations ?? m.references.map((doi) => ({ text: "", doi }));
  const setCited = (next: Reference[]) => change((was) => ({ ...was, citations: next, references: next.flatMap((reference) => reference.doi ?? []) }));
  // A reference open to be corrected in its row, as it is being typed. Enter or leaving the field keeps it; Escape, or
  // emptying it, leaves the reference as it was.
  const [editing, setEditing] = useState<{ at: number; from: Reference; text: string } | null>(null);
  // Enter and Escape both leave the field, so leaving it is the one way an edit ends: Escape marks it to be dropped.
  const dropEdit = useRef(false);
  const openEdit = (at: number, reference: Reference) => {
    dropEdit.current = false;
    setEditing({ at, from: reference, text: reference.text || reference.doi! });
  };
  // Found again by what it was: a reference removed meanwhile, here or in another tab, moves the rest up a row.
  const sameAs = (from: Reference) => (reference: Reference) => reference.text === from.text && reference.doi === from.doi;
  const editRow = !editing ? -1 : cited[editing.at] && sameAs(editing.from)(cited[editing.at]!) ? editing.at : cited.findIndex(sameAs(editing.from));
  const endEdit = () => {
    if (!editing) return;
    setEditing(null);
    if (dropEdit.current) return;
    const row = editRow;
    const was = cited[row];
    const edited = referenceFrom(editing.text);
    // Opened and left as it was, it stays exactly as it was.
    if (!was || !edited || editing.text.trim() === (was.text || was.doi)) return;
    // A DOI kept beside the words rather than in them, as a BibTeX record gives one, stays with the corrected words
    // unless they now carry a DOI of their own.
    const beside = !!was.text && !!was.doi && doiWithin(was.text) !== was.doi;
    const kept = beside && !edited.doi ? { ...edited, doi: was.doi } : edited;
    setCited(cited.map((reference, at) => (at === row ? kept : reference)));
  };
  const refs = pagerOf(cited.length, REFS_PER_PAGE, refPage, setRefPage);
  const refsFrom = (refs.page - 1) * REFS_PER_PAGE;
  const shownRefs = cited.slice(refsFrom, refsFrom + REFS_PER_PAGE);
  const authors = usePage(m.authors, AUTHORS_PER_PAGE);
  const funders = usePage(m.funding, ROWS_PER_PAGE);
  const links = usePage(m.relations, ROWS_PER_PAGE);
  // An abstract being written from the PDF, in the report's language.
  const [writing, setWriting] = useState(false);
  const write = useAction(api.reports.abstract.write);
  const writeAbstract = async () => {
    if (!writingFor) return;
    setWriting(true);
    try {
      const abstract = await write({ ...writingFor, language: m.language });
      if (!held.current.closed) set("abstract", abstract);
    } catch {
      toast.error(t("abstractFailed"));
    } finally {
      setWriting(false);
    }
  };
  // The references a pasted list or an uploaded file holds, added after the ones already listed. One listed already, by
  // its DOI or its words, is left out, but a DOI listed alone (read from the PDF) takes the words the list gives it.
  // While a list is being read (ReferenceBox says so), the details aren't sent: what it adds would come after them and be lost.
  const [adding, setAdding] = useState(false);
  const addReferences = async (text: string) => {
    const { referencesIn } = await import("@/lib/reports/reference-list");
    const found = referencesIn(text);
    const worded = new Map(found.flatMap((reference) => (reference.doi && reference.text ? [[reference.doi, reference] as const] : [])));
    const filled = cited.map((reference) => (reference.doi && !reference.text && worded.get(reference.doi)) || reference);
    const enriched = filled.filter((reference, at) => reference !== cited[at]).length;
    const key = (reference: Reference) => reference.doi ?? reference.text.toLowerCase();
    const listed = new Set(filled.map(key));
    const fresh = found.filter((reference) => !listed.has(key(reference)) && listed.add(key(reference)));
    const added = fresh.slice(0, DETAIL_CAPS.references - cited.length);
    if (!found.length) return void toast.error(t("noReferencesFound"));
    if (!fresh.length && !enriched) return void toast(t("referencesListed"));
    if (fresh.length && !added.length && !enriched) return void toast.error(t("tooManyRefs", { max: format.number(DETAIL_CAPS.references) }));
    setCited([...filled, ...added]);
    setRefPage(Math.ceil((cited.length + added.length) / REFS_PER_PAGE));
    toast(t("referencesAdded", { count: added.length + enriched }), { id: "references-added", action: { label: t("undo"), onClick: () => setCited(cited) } });
  };
  // A year as it is typed, until it is a whole one: only a date that is one is ever saved.
  const [typedYear, setTypedYear] = useState<string | null>(null);
  const dated = dateParts(m.date);
  // A year, a month or a day compares with today as text does: 2026-11 isn't after 2026-11-12, and 2026-12 is.
  const future = m.date > localToday();
  const early = !!dated && dated.year < EARLIEST_YEAR;
  // A link that is neither a web address nor a DOI leads nowhere: it holds the checks until it is one, or removed.
  const wrongLinks = m.relations.some((r) => r.target.trim() !== "" && !linkHref(r.target));
  // A form (components/reports/form.tsx): what is missing or wrong is said at its field once Next was pressed, and Next
  // takes the person to the first of them. The date says what is wrong with it as it is typed.
  const { tried, go } = useStepForm();
  const noTitle = !m.title.trim();
  const noAuthor = !m.authors.some((a) => a.name.trim());
  const firstWrongLink = m.relations.findIndex((r) => r.target.trim() !== "" && !linkHref(r.target));
  // A correction with nothing changed yet has nothing to send: said beside the button once it is pressed.
  const unchanged = !!onCancel && !resend && !touched;
  const wrongFields = [noTitle && `${id}-title`, noAuthor && (m.authors.length ? `${id}-author-name` : `${id}-add-author`), (!dated || typedYear !== null || future || early) && `${id}-year`, wrongLinks && `${id}-link-${firstWrongLink}`, unchanged && `${id}-unchanged`];
  // Busy: a person being added, or a summary being written.
  const working = adding || writing;
  // Not in a transition: the page shows the checks running at once, which a transition would hold back until they end.
  const tryRun = () => {
    // A wrong link on another page of the list is put on screen first, so Next can take the person to it.
    if (wrongLinks && firstWrongLink >= 0) flushSync(() => links.show(firstWrongLink));
    go(wrongFields, run);
  };
  const run = () => {
    // The run carries the details as they are, so a save still waiting has nothing left to send.
    clearTimeout(held.current.timer);
    held.current.send = undefined;
    held.current.closed = true;
    void onRun(m, opened);
  };

  return (
    <RegistrarsProvider value={registrars ?? { crossref: true, zenodo: true }}>
    <div className="flex flex-1 flex-col">
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
        <Section title={t("work")}>
          <Field label={t("title")} help="title" id={`${id}-title`} counter={used(m.title, DETAIL_TEXT.title)}>
            <Textarea id={`${id}-title`} value={m.title} maxLength={DETAIL_TEXT.title} onChange={(e) => set("title", e.target.value)} rows={2} className="resize-none text-base font-medium" aria-invalid={tried && noTitle ? true : undefined} aria-describedby={tried && noTitle ? `${id}-title-error` : undefined} />
            {tried && noTitle ? <FieldMessage id={`${id}-title-error`}>{t("titleMissing")}</FieldMessage> : null}
          </Field>
          <Field label={t("subtitle")} help="subtitle" id={`${id}-subtitle`} counter={m.subtitle ? used(m.subtitle, DETAIL_TEXT.subtitle) : undefined}>
            <Input id={`${id}-subtitle`} value={m.subtitle} maxLength={DETAIL_TEXT.subtitle} onChange={(e) => set("subtitle", e.target.value)} placeholder={t("none")} />
          </Field>
          {/* The date takes a little more of the row: a year, a month and a day side by side. */}
          <div className="grid gap-3 sm:grid-cols-2 @3xl:grid-cols-[1fr_1fr_1.45fr_1fr]">
            <Field label={t("type")} help="type" id={`${id}-type`}>
              <Select value={m.type} onValueChange={(type) => set("type", type)}>
                <SelectTrigger id={`${id}-type`} className="w-full" aria-label={t("type")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {vocabulary.reportTypes.map((type) => (
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
            <DateField yearId={`${id}-year`} errorId={`${id}-date-error`} date={m.date} typed={typedYear} onTyped={setTypedYear} onDate={(date) => set("date", date)} invalid={future || early}>
              {/* A report is published by today, as the author's own calendar has it. A date past it says so here, before the checks are asked for. */}
              {(typedYear !== null && typedYear.length < 4) || (typedYear === null && !dated) ? (
                <FieldMessage id={`${id}-date-error`} className="pt-0">{t("yearInvalid")}</FieldMessage>
              ) : typedYear !== null || future || early ? (
                <FieldMessage id={`${id}-date-error`} className="pt-0">{t(typedYear === null && future ? "future" : "tooEarly")}</FieldMessage>
              ) : null}
            </DateField>
            <div className="space-y-1.5">
              <FieldLabel label={t("licence")} help="licence" />
              <div className="flex h-9 items-center rounded-md border border-border-subtle bg-inset px-3 text-sm">
                <a href={licenceUrl(m.licence)} target="_blank" rel="noreferrer license" className="inline-flex min-w-0 items-center gap-1.5 underline-offset-2 hover:underline">
                  <span className="truncate">{licenceName(m.licence)}</span>
                  <ExternalLink className="size-3.5 text-muted-foreground" />
                </a>
              </div>
            </div>
          </div>
        </Section>

        <Section title={t("authors")} help="authors" aside={<span className="text-xs tabular-nums text-muted-foreground">{m.authors.length}</span>}>
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
                nameId={i === 0 ? `${id}-author-name` : undefined}
                nameError={i === 0 && tried && noAuthor}
              />
              );
            })}
          </ul>
          </Paged>
          {/* Said under the list, so it shows with no row too: Next goes to the first name, or to Add a person. */}
          {tried && noAuthor ? <FieldMessage id={`${id}-authors-error`}>{t("authorsMissing")}</FieldMessage> : null}
          <Button
            id={`${id}-add-author`}
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              set("authors", [...m.authors, { ...BLANK_AUTHOR }]);
              authors.last(m.authors.length + 1);
            }}
          >
            <Plus /> {t("addPerson")}
          </Button>
        </Section>

        <Section
          title={t("abstract")}
          help="abstract"
          aside={
            <>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{used(m.abstract, DETAIL_TEXT.abstract)}</span>
              {/* An abstract written from the PDF when its author asks, since the reading copies only one the PDF prints. */}
              {writingFor ? <WriteAbstract filled={!!m.abstract.trim()} writing={writing} onWrite={() => void writeAbstract()} /> : null}
            </>
          }
        >
          {/* The box is as tall as its words, so a written abstract makes it taller: it slides to that height. */}
          <AutoHeight>
            <Textarea
              aria-label={t("abstract")}
              value={m.abstract}
              maxLength={DETAIL_TEXT.abstract}
              disabled={writing}
              placeholder={writingFor ? t("noAbstract") : undefined}
              onChange={(e) => set("abstract", e.target.value)}
              rows={7}
              className="text-sm/6"
            />
          </AutoHeight>
        </Section>

        <Section title={t("subjects")}>
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

        <Section title={t("places")} help="places">
          <CountrySelector label={t("places")} placeholder={t("addPlace")} selectedRegions={m.countries} onSelectionChange={(countries) => set("countries", countries)} bypassLimit />
        </Section>

        <Section title={t("funding")} help="funding">
          <OpenAlexLookupFilter
            selected={funderIds}
            onChange={(next) => set("funding", m.funding.filter((f) => next.includes(funderChip(f.funder))))}
            onPicked={(option) => {
              // A funder already listed under its ROR ID is the same funder found again: it gains the record and keeps its grants.
              const funder = funderOf(option);
              const at = funder.ror ? m.funding.findIndex((f) => rorOf(f.funder.ror) === rorOf(funder.ror)) : -1;
              set("funding", at < 0 ? [...m.funding, { funder, awards: [] }] : m.funding.map((f, n) => (n === at ? { ...f, funder: f.funder.id ? f.funder : funder } : f)));
            }}
            lookup={{ entity: "funders", useNames: () => funderNames, remember: rememberFunderNames, typed: (query) => ({ id: typedId(query), name: query, detail: t("asTyped") }) }}
            // Governments and foundations that fund work are often on ROR and not among OpenAlex's funders.
            also={{ key: "ror", search: async (query) => (await findRor(query)).map((o) => ({ id: `ror:${o.ror}`, name: o.name, detail: o.place, ror: o.ror, aliases: o.aliases })) }}
            after={Object.fromEntries(m.funding.filter((f) => f.funder.ror).map((f) => [funderChip(f.funder), <RorLink key="ror" ror={f.funder.ror!} label={tPeople("onRor", { name: f.funder.name })} />]))}
            labels={{ label: t("funders"), placeholder: t("addFunder"), searchPlaceholder: t("findFunder"), typeToSearch: t("typeFunder"), unavailable: t("fundersDown") }}
          />
          {m.funding.length ? (
            <Paged pager={funders.pager} rowHeight={ROW} label={t("fundersPager")}>
            <ul className="divide-y divide-border-subtle rounded-2xl border border-border-subtle">
              {funders.shown.map((f, at) => {
                const i = funders.offset + at;
                return (
                <li key={funderChip(f.funder)} className="grid grid-cols-[minmax(0,1fr)] items-center gap-2 px-3 py-2.5 @2xl:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                  <span className="flex min-w-0 items-center gap-1">
                    {/* The full name shows on hover once the ROR mark beside it leaves too little room for it. */}
                    <TooltipHint label={f.funder.name} onlyWhenClipped>
                      <span className="min-w-0 truncate text-sm font-medium">
                        <FunderName id={f.funder.id} name={f.funder.name} />
                      </span>
                    </TooltipHint>
                    {f.funder.ror ? <RorLink ror={f.funder.ror} label={tPeople("onRor", { name: f.funder.name })} /> : null}
                  </span>
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

        <Section title={t("references")} help="references" aside={<span className="text-xs tabular-nums text-muted-foreground">{format.number(cited.length)}</span>}>
          {cited.length ? (
            <Paged pager={refs} rowHeight={REF_ROW} label={t("referencesPager")}>
              <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
                {shownRefs.map((reference, at) => {
                  const i = refsFrom + at;
                  const href = reference.doi ? `https://doi.org/${reference.doi}` : undefined;
                  return (
                    <li key={i} style={{ height: REF_ROW - 1 }} className="flex items-center gap-2 px-3">
                      <span className="w-7 shrink-0 text-end text-xs tabular-nums text-muted-foreground">{format.number(i + 1)}</span>
                      {editRow === i ? (
                        <Input
                          autoFocus
                          aria-label={t("referenceLabel", { number: format.number(i + 1) })}
                          maxLength={DETAIL_TEXT.citation}
                          value={editing!.text}
                          onChange={(event) => setEditing({ ...editing!, text: event.target.value })}
                          onBlur={endEdit}
                          onKeyDown={(event) => {
                            // Enter and Escape inside an input method's composition belong to the composition.
                            if (event.nativeEvent.isComposing || (event.key !== "Enter" && event.key !== "Escape")) return;
                            event.preventDefault();
                            dropEdit.current = event.key === "Escape";
                            event.currentTarget.blur();
                          }}
                          className="h-8 min-w-0 flex-1 text-sm"
                        />
                      ) : (
                        // One line a reference, so a page of them is always as tall; the rest of a long one shows on hover.
                        // Clicking it opens it to be corrected, as the pencil does.
                        <TooltipHint label={reference.text || reference.doi!} onlyWhenClipped>
                          <button type="button" tabIndex={-1} onClick={() => openEdit(i, reference)} className={cn("min-w-0 flex-1 cursor-text truncate text-start", reference.text ? "text-sm" : "font-mono text-xs")}>
                            {reference.text || reference.doi}
                          </button>
                        </TooltipHint>
                      )}
                      {editRow === i ? null : (
                        <TooltipHint label={t("editReference")}>
                          <Button type="button" variant="ghost" size="icon-xs" aria-label={t("editReferenceLabel", { number: format.number(i + 1) })} className="text-muted-foreground" onClick={() => openEdit(i, reference)}>
                            <Pencil />
                          </Button>
                        </TooltipHint>
                      )}
                      {href ? (
                        <TooltipHint label={t("openItsDoi")}>
                          <Button asChild variant="ghost" size="icon-xs" className="text-muted-foreground">
                            <a href={href} target="_blank" rel="noopener noreferrer" aria-label={t("openReferenceDoi", { number: format.number(i + 1) })}>
                              <ExternalLink />
                            </a>
                          </Button>
                        </TooltipHint>
                      ) : null}
                      <TooltipHint label={t("removeReference")}>
                        <Button type="button" variant="ghost" size="icon-xs" aria-label={t("remove", { name: reference.text || reference.doi! })} className="text-muted-foreground hover:text-destructive" onClick={() => setCited(cited.filter((_, other) => other !== i))}>
                          <Trash2 />
                        </Button>
                      </TooltipHint>
                    </li>
                  );
                })}
              </ul>
            </Paged>
          ) : null}
          <ReferenceBox onAdd={addReferences} onBusy={setAdding} onTrouble={(words) => void toast.error(words)} />
        </Section>

        <Section title={t("links")} help="links">
          {wrongLinks ? <FieldMessage id={`${id}-links-error`} className="pt-0">{t("wrongLink")}</FieldMessage> : null}
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
                  <Input id={`${id}-link-${i}`} aria-label={t("linkLabel")} aria-invalid={r.target.trim() !== "" && !href} aria-describedby={r.target.trim() !== "" && !href ? `${id}-links-error` : undefined} maxLength={DETAIL_TEXT.link} placeholder={t("linkPlaceholder")} value={r.target} onChange={(e) => set("relations", m.relations.map((x, n) => (n === i ? { ...x, target: e.target.value } : x)))} className="order-last h-8 min-w-0 basis-full font-mono text-xs @xl:order-none @xl:flex-1 @xl:basis-0" />
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
      {/* Back and the ways on, at the foot of the step as every step's are (components/reports/form.tsx `StepNav`). */}
      <StepNav
        onBack={
          onBack
            ? () => {
                // An edit still waiting to be saved goes first: once the report is back at its PDF, a save of its details is refused.
                sendNow();
                onBack();
              }
            : undefined
        }
        between={
          <>
            <p id={`${id}-unchanged`} tabIndex={-1} className={cn("min-w-0 text-xs text-destructive outline-none", !(tried && unchanged) && "sr-only")}>
              {tried && unchanged ? t("unchanged") : null}
            </p>
            {onReturn && !touched ? (
              <Button variant="outline" onClick={onReturn}>
                {t("backToChecks")}
              </Button>
            ) : null}
            {onCancel ? (
              <Button
                variant="outline"
                onClick={() => {
                  // What was typed is given up, so a save still waiting must never arrive after it.
                  clearTimeout(held.current.timer);
                  held.current.send = undefined;
                  held.current.closed = true;
                  onCancel(opened);
                }}
              >
                {t("cancel")}
              </Button>
            ) : null}
          </>
        }
        next={
          // A report on its way out goes on to its next step; a live report's changes are sent.
          words || onCancel ? (
            // A long label ("Vérifier les modifications et les envoyer en relecture") wraps on a phone rather than leaving the screen.
            <Button disabled={working} onClick={tryRun} className="max-sm:h-auto max-sm:min-h-9 max-sm:shrink max-sm:py-1 max-sm:whitespace-normal">
              <ShieldCheck /> {words ? words.action : t(waits ? "sendForReview" : "checkAndPublish")}
            </Button>
          ) : (
            <NextButton busy={working} onClick={tryRun}>{t("runChecks")}</NextButton>
          )
        }
      />
    </div>
    </RegistrarsProvider>
  );
}
