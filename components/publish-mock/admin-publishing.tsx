"use client";

// MOCK (mock/publish-reports): the admin page for publishing in Openscholar Reports. Submissions: every report, with
// approve and decline for those waiting. Settings: the Publish button, human review, the series and its DOIs, the
// model that reads PDFs, the checks, and the agreement. State lives in the mock's local store.

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { toast } from "sonner";
import Link from "@/components/workspace-link";
import { Enter, LIST, Paged, Segmented, Tile, Working, Zone, pagerOf } from "@/components/settings/parts";
import { NodeCard, tintOf } from "@/components/settings/model-map";
import { getModelIcon } from "@/components/icons/provider-icons";
import { isDecisionModel } from "@/lib/ai/decisions";
import { ModelPicker } from "@/components/models/model-picker";
import { StatusChip, StatusIcon } from "@/components/evidence-libraries/configuration/status-chip";
import { MarkdownContent } from "@/components/markdown-content";
import { Button } from "@/components/ui/button";
import { CountryFlag } from "@/components/ui/country-flag";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TooltipHint } from "@/components/ui/tooltip";
import {
  ArrowUpRight,
  BadgeCheck,
  Check,
  Mail,
  CircleCheck,
  CircleX,
  FileText,
  Hash,
  PenLine,
  Pencil,
  RotateCcw,
  Plus,
  PublishIcon,
  RefreshCw,
  ReviewQueueIcon,
  Search,
  SearchX,
  ShieldCheck,
  TriangleAlert,
  Trash2,
} from "@/components/icons";
import { CheckRow } from "@/components/publish-mock/publish-flow";
import { usePlaceName } from "@/components/publish-mock/report-extras";
import { removeCheck, retryDeposit, review, saveCheck, savePublication, updateAgreement, updateSettings } from "@/app/actions/publish-mock";
import { SDGS } from "@/lib/openalex/vocabulary";
import { FunderName } from "@/components/papers/paper-entities";
import { ConvexError } from "convex/values";
import { CONTACT_EMAIL } from "@/lib/billing/contact";
import { Field } from "@/components/evidence-libraries/configuration/section-card";
import { PublicationForm } from "@/components/evidence-libraries/configuration/sections/publication-section";
import { PROVIDER_NAME, RegistrationChips, standingOf, stepTone, stepWords } from "@/components/publish-mock/registration";
import { JEV, REVIEW_TEXT_MAX, bylineOf, canRegister, doiOf, stageOf, type Check as CheckDef, type Email, type MockState, type Settings, type Stage, type Submission } from "@/lib/publish-mock/types";
import { cn } from "@/lib/utils";

const VIEWS = ["submissions", "settings"] as const;
const SHOWS = ["all", "review", "ready", "live", "failed", "declined"] as const;
type Show = (typeof SHOWS)[number];
type Sort = "newest" | "oldest" | "title";
const PER_PAGE = 8;
const ROW = 65;

const STATUS: Record<Exclude<Stage, "draft">, { label: string; tone: "running" | "success" | "danger" | "neutral"; icon: typeof Check }> = {
  review: { label: "In review", tone: "running", icon: ReviewQueueIcon },
  ready: { label: "Ready to activate", tone: "success", icon: CircleCheck },
  live: { label: "Live", tone: "success", icon: BadgeCheck },
  failed: { label: "Failed checks", tone: "danger", icon: CircleX },
  declined: { label: "Declined", tone: "neutral", icon: CircleX },
};
/** A report's status in words. A declined report that had been live was withdrawn. */
const labelOf = (s: Submission, stage: Stage) => (stage === "declined" && s.withdrawnAt ? "Withdrawn" : stage === "draft" ? "Draft" : STATUS[stage].label);
const SHOW_LABEL: Record<Show, string> = { all: "All", review: "In review", ready: "Ready to activate", live: "Live", failed: "Failed", declined: "Declined" };
const day = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function failed(error: unknown) {
  toast.error(error instanceof Error ? error.message : "Something went wrong");
}

export function AdminPublishing({ initial }: { initial: MockState }) {
  const [view, setView] = useQueryState("view", parseAsStringLiteral(VIEWS).withDefault("submissions"));
  const [settings, setSettings] = useState(initial.settings);
  const [submissions, setSubmissions] = useState(initial.submissions.filter((s) => s.status !== "draft"));
  // MOCK: the emails kept in the store when the page loaded, so each report can show what the team's inbox was told.
  const outbox = initial.outbox ?? [];
  const waiting = submissions.filter((s) => stageOf(s, settings) === "review").length;
  const replace = (next: Submission) => setSubmissions((all) => all.map((s) => (s.id === next.id ? next : s)));

  return (
    <Enter ready>
      <div className="space-y-6">
        <Segmented
          label="Publishing"
          value={view}
          onChange={(v) => void setView(v)}
          options={[
            { id: "submissions", label: "Submissions", icon: FileText, detail: waiting ? <span className="rounded-full bg-primary/15 px-1.5 text-2xs tabular-nums text-primary">{waiting}</span> : undefined },
            { id: "settings", label: "Settings", icon: PublishIcon },
          ]}
          size="md"
        />
        {view === "submissions" ? (
          <Submissions settings={settings} submissions={submissions} outbox={outbox} onChange={replace} />
        ) : (
          <SettingsView settings={settings} onChange={setSettings} />
        )}
      </div>
    </Enter>
  );
}

function Submissions({ settings, submissions, outbox, onChange }: { settings: Settings; submissions: Submission[]; outbox: Email[]; onChange: (s: Submission) => void }) {
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const counts = useMemo(() => Object.fromEntries(SHOWS.map((s) => [s, s === "all" ? submissions.length : submissions.filter((x) => stageOf(x, settings) === s).length])) as Record<Show, number>, [submissions, settings]);
  const list = useMemo(() => {
    const words = query.trim().toLowerCase();
    const kept = submissions.filter((s) => (show === "all" || stageOf(s, settings) === show) && (!words || [s.metadata?.title, s.id, s.doi, ...(s.metadata?.authors.map((a) => a.name) ?? [])].some((v) => v?.toLowerCase().includes(words))));
    return kept.sort((a, b) => (sort === "title" ? (a.metadata?.title ?? "").localeCompare(b.metadata?.title ?? "") : sort === "oldest" ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
  }, [submissions, settings, query, show, sort]);
  const pager = pagerOf(list.length, PER_PAGE, page, setPage);
  const shown = list.slice((pager.page - 1) * PER_PAGE, pager.page * PER_PAGE);
  const opened = submissions.find((s) => s.id === open) ?? null;

  return (
    <Zone label={settings.series.name}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Find a report, author or DOI"
              aria-label="Find a report"
              className="h-9 ps-9"
            />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger size="sm" className="w-32" aria-label="Sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
              <SelectItem value="title">Title</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Segmented
          label="Which reports"
          value={show}
          fill="labels"
          onChange={(next) => {
            setShow(next);
            setPage(1);
          }}
          options={SHOWS.map((id) => ({ id, label: SHOW_LABEL[id], detail: <span className="tabular-nums opacity-70">{counts[id]}</span> }))}
        />
        <Paged pager={pager} rowHeight={ROW} label="reports">
          {shown.length ? (
            <ul className={LIST}>
              {shown.map((s) => (
                <SubmissionRow key={s.id} submission={s} stage={stageOf(s, settings)} onOpen={() => setOpen(s.id)} onChange={onChange} />
              ))}
            </ul>
          ) : (
            <div className="flex min-h-52 flex-col items-center justify-center gap-2 rounded-2xl border border-border-subtle text-center">
              <SearchX className="size-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{query || show !== "all" ? "No reports match" : "No reports yet"}</p>
            </div>
          )}
        </Paged>
      </div>
      <SubmissionDialog submission={opened} settings={settings} emails={opened ? outbox.filter((e) => e.report === opened.id) : []} onClose={() => setOpen(null)} onChange={onChange} />
    </Zone>
  );
}

function SubmissionRow({ submission: s, stage, onOpen, onChange }: { submission: Submission; stage: Stage; onOpen: () => void; onChange: (s: Submission) => void }) {
  const [busy, start] = useTransition();
  const status = stage === "draft" ? undefined : STATUS[stage];
  // A live report's registrations: the one refused, else the one under way, else the last one done.
  const standing = s.status === "live" ? standingOf(s) : null;
  const refused = standing?.state === "failed";
  const first = s.metadata?.authors[0];
  const act = (run: () => Promise<Submission>, done: string) =>
    start(async () => {
      try {
        onChange(await run());
        toast.success(done);
      } catch (error) {
        failed(error);
      }
    });
  return (
    <li style={{ height: ROW - 1 }} className="flex items-center gap-3 px-4">
      <div className="min-w-0 flex-1">
        <TooltipHint label={s.metadata?.title ?? s.id} onlyWhenClipped>
          <button type="button" onClick={onOpen} className="block max-w-full truncate text-start text-sm font-medium underline-offset-4 hover:underline">
            {s.metadata?.title ?? "Untitled"}
          </button>
        </TooltipHint>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {first?.affiliations[0]?.country ? <CountryFlag countryCode={first.affiliations[0].country} /> : null}
          <span className="truncate">{first?.name}</span>
          <span className="shrink-0 font-mono">{s.id}</span>
          <span className="hidden shrink-0 tabular-nums sm:inline">{day(s.createdAt)}</span>
        </div>
      </div>
      {standing ? (
        refused ? (
          <TooltipHint label={`Send to ${PROVIDER_NAME[standing.provider]} again`}>
            <Button variant="ghost" size="icon-sm" aria-label={`Send ${s.id} to ${PROVIDER_NAME[standing.provider]} again`} className="relative ink-warning" disabled={busy} onClick={() => act(() => retryDeposit(s.id), `Sent to ${PROVIDER_NAME[standing.provider]}`)}>
              <Working busy={busy}>
                <RefreshCw />
              </Working>
            </Button>
          </TooltipHint>
        ) : (
          <StatusIcon tone={stepTone(standing)} label={stepWords(standing)} icon={standing.state === "done" ? Hash : undefined} />
        )
      ) : null}
      {status ? (
        <StatusChip tone={refused ? "warning" : status.tone} icon={refused ? TriangleAlert : status.icon} className="hidden shrink-0 sm:inline-flex">
          {standing && refused ? `${PROVIDER_NAME[standing.provider]} refused` : labelOf(s, stage)}
        </StatusChip>
      ) : null}
      <span className="flex w-[4.5rem] shrink-0 justify-end gap-1">
        {stage === "review" ? (
          <>
            <TooltipHint label="Decline">
              <Button variant="ghost" size="icon-sm" aria-label={`Decline ${s.id}`} className="text-muted-foreground hover:text-destructive" onClick={onOpen}>
                <CircleX />
              </Button>
            </TooltipHint>
            <TooltipHint label="Approve">
              <Button variant="ghost" size="icon-sm" aria-label={`Approve ${s.id}`} className="relative text-primary" disabled={busy} onClick={() => act(() => review(s.id, "approve"), "Approved: its author can activate it")}>
                <Working busy={busy}>
                  <Check />
                </Working>
              </Button>
            </TooltipHint>
          </>
        ) : s.status === "live" ? (
          <TooltipHint label="Open its page">
            <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground">
              <Link href={`/papers/${s.id}`} aria-label={`Open ${s.id}`}>
                <ArrowUpRight />
              </Link>
            </Button>
          </TooltipHint>
        ) : (
          <TooltipHint label="Open">
            <Button variant="ghost" size="icon-sm" aria-label={`Open ${s.id}`} className="text-muted-foreground" onClick={onOpen}>
              <FileText />
            </Button>
          </TooltipHint>
        )}
      </span>
    </li>
  );
}

function SubmissionDialog({ submission: s, settings, emails, onClose, onChange }: { submission: Submission | null; settings: Settings; emails: Email[]; onClose: () => void; onChange: (s: Submission) => void }) {
  const [note, setNote] = useState("");
  const [busy, start] = useTransition();
  const decide = (decision: "approve" | "decline" | "reinstate") =>
    start(async () => {
      if (!s) return;
      try {
        onChange(await review(s.id, decision, note.trim() || undefined));
        toast.success(decision === "approve" ? "Approved: its author can activate it" : decision === "reinstate" ? "Reinstated: it is live again" : s.status === "live" ? "Withdrawn" : "Declined");
        setNote("");
        onClose();
      } catch (error) {
        failed(error);
      }
    });
  const stage = s ? stageOf(s, settings) : undefined;
  const status = stage && stage !== "draft" ? STATUS[stage] : undefined;
  return (
    <Dialog open={!!s} onOpenChange={(open) => !open && onClose()}>
      {/* One column no wider than the dialog: a long title or link wraps or is cut, and never widens it. */}
      <DialogContent className="max-h-[85vh] grid-cols-1 overflow-y-auto sm:max-w-2xl">
        {s ? (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{s.id}</span>
                {status && stage ? <StatusChip tone={status.tone} icon={status.icon}>{labelOf(s, stage)}</StatusChip> : null}
              </div>
              <DialogTitle className="break-words text-lg leading-snug">{s.metadata?.title}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {s.metadata?.authors.map((a) => (
                  <span key={a.name} className="inline-flex items-center gap-1.5">
                    {a.affiliations[0]?.country ? <CountryFlag countryCode={a.affiliations[0].country} /> : null}
                    {a.name}
                  </span>
                ))}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-5">
              {s.reviewRequest ? (
                <div className="space-y-2 rounded-xl bg-inset p-3">
                  <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <ReviewQueueIcon className="size-3.5 text-primary" /> The author asked for a review
                    <span className="tabular-nums">{day(s.reviewRequest.at)}</span>
                  </span>
                  <p className="whitespace-pre-wrap break-words text-sm">{s.reviewRequest.comment || "No comment"}</p>
                </div>
              ) : null}
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <Fact icon={Hash} label="DOI" wide>
                  <span className="font-mono text-xs">{s.doi}</span>
                </Fact>
                <Fact icon={FileText} label="PDF">
                  {s.pdf ? (
                    <a href={`/publish/files/${s.id}`} target="_blank" rel="noopener noreferrer" className="truncate underline-offset-4 hover:underline">
                      {s.pdf.pages} {s.pdf.pages === 1 ? "page" : "pages"}
                    </a>
                  ) : (
                    "None"
                  )}
                </Fact>
                <Fact icon={PenLine} label="Signed">
                  {s.signedBy?.name} <Tag>v{s.agreementVersion}</Tag>
                </Fact>
                <Fact icon={ShieldCheck} label="Checks">
                  {s.results?.filter((r) => r.pass).length ?? 0} of {s.results?.length ?? 0} passed <Tag>v{s.checksVersion}</Tag>
                </Fact>
              </div>
              {s.status === "live" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <RegistrationChips report={s} />
                </div>
              ) : null}
              {emails.length ? (
                // MOCK: each opens the email as it would arrive. The real build sends them and has no such links.
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Mail className="size-3.5" /> Emailed to {CONTACT_EMAIL}
                  </span>
                  {emails.map((email) => (
                    <a key={email.id} href={`/publish/emails/${email.id}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-medium text-foreground/80 underline-offset-4 hover:underline">
                      {email.event} <ArrowUpRight className="size-3" />
                    </a>
                  ))}
                </div>
              ) : null}
              {s.metadata?.abstract ? <p className="line-clamp-5 text-sm/6 text-muted-foreground">{s.metadata.abstract}</p> : null}
              {s.metadata ? <Subjects m={s.metadata} /> : null}
              {s.results?.length ? (
                <ul className={LIST}>
                  {s.results.map((r) => (
                    <CheckRow key={r.checkId} name={r.name} result={r} />
                  ))}
                </ul>
              ) : null}
              {s.status === "declined" && s.note ? <p className="rounded-xl bg-inset p-3 text-sm">{s.note}</p> : null}
              {stage && stage !== "declined" && stage !== "draft" ? (
                <Field label={stage === "live" ? "Note to the author, if you withdraw it" : "Note to the author, if you decline"} counter={`${note.length} / ${REVIEW_TEXT_MAX}`}>
                  {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={REVIEW_TEXT_MAX} />}
                </Field>
              ) : null}
            </div>
            {/* A reviewer acts on any report, whatever its checks said: approve one not yet cleared, decline it, withdraw a live one, or reinstate a withdrawn one. */}
            {stage === "declined" && s.withdrawnAt ? (
              <DialogFooter>
                <Button className="relative" disabled={busy} onClick={() => decide("reinstate")}>
                  <Working busy={busy}>
                    <span className="flex items-center gap-2">
                      <RotateCcw /> Reinstate
                    </span>
                  </Working>
                </Button>
              </DialogFooter>
            ) : stage && stage !== "declined" && stage !== "draft" ? (
              <DialogFooter>
                <Button variant="outline" className="relative" disabled={busy} onClick={() => decide("decline")}>
                  <CircleX /> {stage === "live" ? "Withdraw" : "Decline"}
                </Button>
                {stage === "failed" || stage === "review" ? (
                  <Button className="relative" disabled={busy} onClick={() => decide("approve")}>
                    <Working busy={busy}>
                      <span className="flex items-center gap-2">
                        <Check /> Approve
                      </span>
                    </Working>
                  </Button>
                ) : null}
              </DialogFooter>
            ) : null}
            <span className="sr-only">{settings.series.name}</span>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** What the report is about and who paid for it, as chips: topics, goals, places and funders. */
function Subjects({ m }: { m: NonNullable<Submission["metadata"]> }) {
  const placeName = usePlaceName();
  const groups: Array<{ label: string; chips: ReactNode[] }> = [
    { label: "Topics", chips: m.topics.map((t) => <Chip key={t.id}>{t.name}</Chip>) },
    { label: "Goals", chips: m.sdgs.map((g) => <Chip key={g}>{SDGS.find((x) => x.id === g)?.name ?? g}</Chip>) },
    { label: "Places", chips: m.countries.map((c) => <Chip key={c}>{c.length === 2 ? <CountryFlag countryCode={c} /> : null}{placeName(c)}</Chip>) },
    { label: "Funders", chips: m.funding.map((f) => <Chip key={f.funder.name}><FunderName id={f.funder.id} name={f.funder.name} /></Chip>) },
  ].filter((g) => g.chips.length);
  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <div key={g.label} className="flex items-start gap-3">
          <span className="w-16 shrink-0 pt-0.5 text-xs text-muted-foreground">{g.label}</span>
          <span className="flex min-w-0 flex-wrap gap-1.5">{g.chips}</span>
        </div>
      ))}
    </div>
  );
}

const Chip = ({ children }: { children: ReactNode }) => <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-inset px-2 text-xs">{children}</span>;

function Fact({ icon: Icon, label, wide = false, children }: { icon: typeof Hash; label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5 rounded-xl bg-inset px-3 py-2", wide && "sm:col-span-2")}>
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="w-14 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 truncate">{children}</span>
    </div>
  );
}

const Tag = ({ children }: { children: ReactNode }) => <span className="shrink-0 rounded bg-background px-1.5 text-2xs tabular-nums text-muted-foreground">{children}</span>;

/** A row of a settings list: a name and a short hint, with its control on the right. */
function Row({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <li className={cn("flex gap-x-6 gap-y-2 px-4 py-3.5", wide ? "flex-col" : "flex-wrap items-center justify-between")}>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      {children}
    </li>
  );
}

function SettingsView({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [editing, setEditing] = useState<CheckDef | "new" | null>(null);
  const [agreementOpen, setAgreementOpen] = useState(false);
  const save = (patch: Parameters<typeof updateSettings>[0]) => {
    onChange({ ...settings, ...patch, series: { ...settings.series, ...patch.series } } as Settings);
    updateSettings(patch).then(onChange, failed);
  };
  const sampleDoi = doiOf(settings, "R100015");
  const { zenodo, crossref } = settings.publication;
  const registers = canRegister(settings);
  return (
    <div className="space-y-8">
      <Zone label="Publishing">
        <ul className={LIST}>
          <li>
            <label className={cn("flex items-center justify-between gap-6 px-4 py-3.5 transition-colors", registers && "cursor-pointer hover:bg-muted")}>
              <span className="min-w-0">
                <span className="block text-sm font-medium">Publish button</span>
                <span className="block text-xs text-muted-foreground">{registers ? "Publish in the sidebar, for everyone signed in" : "Off until Crossref or Zenodo is on under DOI registration"}</span>
              </span>
              <Switch checked={settings.enabled && registers} disabled={!registers} onCheckedChange={(enabled) => save({ enabled })} />
            </label>
          </li>
          <li>
            <label className="flex cursor-pointer items-center justify-between gap-6 px-4 py-3.5 transition-colors hover:bg-muted">
              <span className="min-w-0">
                <span className="block text-sm font-medium">Human review</span>
                <span className="block text-xs text-muted-foreground">A reviewer approves each report that passes its checks before its DOI goes live</span>
              </span>
              <Switch checked={settings.humanReview} onCheckedChange={(humanReview) => save({ humanReview })} />
            </label>
          </li>
        </ul>
      </Zone>

      <Zone label="Series">
        <ul className={LIST}>
          <Row label="Series">
            <SavedInput value={settings.series.name} onSave={(name) => save({ series: { name } })} className="w-64" />
          </Row>
          <Row label="ISSN" hint="Pending until the ISSN centre assigns it">
            <SavedInput value={settings.series.issn} placeholder="Pending" onSave={(issn) => save({ series: { issn } })} className="w-40 font-mono" />
          </Row>
          <Row label="Byline" hint="{series}, {issn} and {doi} are filled in for each report" wide>
            <SavedInput value={settings.series.byline} onSave={(byline) => save({ series: { byline } })} className="w-full" />
            <p className="flex items-start gap-2 rounded-xl bg-inset px-3 py-2.5 text-xs text-muted-foreground">
              <FileText className="mt-px size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{bylineOf(settings, sampleDoi)}</span>
            </p>
          </Row>
        </ul>
      </Zone>

      {/* The form a community's settings use. Here Crossref can be on alone: Openscholar chooses whether Zenodo archives its reports. */}
      <Zone
        label="DOI registration"
        aside={
          <span className="flex flex-wrap items-center justify-end gap-2">
            {zenodo.mode !== "off" ? <StatusChip tone={zenodo.mode === "sandbox" ? "warning" : "success"}>{zenodo.mode === "sandbox" ? "Zenodo sandbox" : "Zenodo"}</StatusChip> : null}
            {crossref.mode !== "off" ? <StatusChip tone={crossref.mode === "sandbox" ? "warning" : "success"}>{crossref.mode === "sandbox" ? "Crossref sandbox" : "Crossref"}</StatusChip> : null}
            {registers ? null : <StatusChip tone="neutral">Off</StatusChip>}
          </span>
        }
      >
        <div className="space-y-5 rounded-2xl border border-border-subtle p-4">
          <PublicationForm
            key={settings.publicationSavedAt}
            saved={{ settings: settings.publication, updatedAt: settings.publicationSavedAt, verifiedAt: null }}
            crossrefAlone
            words={{
              zenodoHint: "Archives each report's PDF. Off, reports register with Crossref alone.",
              crossrefHint: "Each report gets a DOI under your prefix. Off, it gets the DOI Zenodo reserves.",
              namespaceHint: "Comes before each report's key in its DOI.",
              namespacePlaceholder: "openscholar-r",
              savedHint: "New reports register this way. Reports with a DOI keep theirs.",
            }}
            onSave={async (input) => {
              const result = await savePublication(input);
              // The form shows a ConvexError's message under itself, as it does a community's refusal.
              if ("refused" in result) throw new ConvexError({ message: result.refused });
              onChange(result.settings);
            }}
          />
          <p className="flex items-center gap-2 rounded-xl bg-inset px-3 py-2.5 font-mono text-xs text-muted-foreground">
            <Hash className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{sampleDoi}</span>
          </p>
        </div>
      </Zone>

      <Zone label="Metadata">
        <div className="space-y-2">
          <ModelPicker
            current={settings.metadataModel}
            efforts
            onChange={(m, effort) => save({ metadataModel: { id: m.id, name: m.name, inputPricePerMillion: m.inputPricePerMillion, outputPricePerMillion: m.outputPricePerMillion, reasoningEfforts: m.reasoningEfforts, ...(effort ? { effort } : {}) } })}
            trigger={<NodeCard model={settings.metadataModel} paidBy="credits" interactive />}
          />
          <p className="ps-1 text-xs text-muted-foreground">Reads each PDF and fills in its title, authors, abstract and keywords for the author to correct.</p>
        </div>
      </Zone>

      <Zone
        label="Checks"
        aside={
          <span className="flex items-center gap-2">
            <StatusChip tone="neutral">Version {settings.checksVersion}</StatusChip>
            <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
              <Plus /> Add a check
            </Button>
          </span>
        }
      >
        <ul className={LIST}>
          {settings.checks.map((check) => (
            <CheckSettingRow key={check.id} check={check} onEdit={() => setEditing(check)} onToggle={(enabled) => saveCheck({ ...check, enabled }).then(onChange, failed)} />
          ))}
        </ul>
        <p className="ps-1 text-xs text-muted-foreground">Each change makes a new version. A report keeps the version it was checked with.</p>
      </Zone>

      <Zone label="Agreement">
        <ul className={LIST}>
          <li className="flex items-center gap-3 px-4 py-3.5">
            <Tile icon={PenLine} tint="var(--primary)" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                Publishing agreement, single work <Tag>v{settings.agreement.version}</Tag>
              </span>
              <span className="block truncate font-mono text-xs text-muted-foreground">{settings.agreement.source}</span>
            </span>
            <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">{day(settings.agreement.updatedAt)}</span>
            <Button variant="outline" size="sm" onClick={() => setAgreementOpen(true)}>
              <Pencil /> Edit
            </Button>
          </li>
        </ul>
      </Zone>

      <CheckDialog
        check={editing}
        onClose={() => setEditing(null)}
        onSaved={(next) => {
          onChange(next);
          setEditing(null);
          toast.success(`Checks version ${next.checksVersion}`);
        }}
      />
      <AgreementDialog open={agreementOpen} settings={settings} onClose={() => setAgreementOpen(false)} onSaved={onChange} />
    </div>
  );
}

/** An input that saves when it loses focus or Enter is pressed. */
function SavedInput({ value, onSave, className, placeholder }: { value: string; onSave: (v: string) => void; className?: string; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  const [was, setWas] = useState(value);
  if (value !== was) {
    setWas(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft.trim() !== value) onSave(draft.trim());
  };
  return (
    <Input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      className={cn("h-8", className)}
    />
  );
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

function CheckSettingRow({ check, onEdit, onToggle }: { check: CheckDef; onEdit: () => void; onToggle: (on: boolean) => void }) {
  const Brand = getModelIcon(check.model.id);
  return (
    <li className={cn("flex items-center gap-3 px-4 py-3", !check.enabled && "opacity-60")}>
      <Tile icon={Brand} tint={tintOf(check.model.id)} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{check.name}</span>
          {check.builtIn ? <Tag>Built in</Tag> : null}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{check.model.name}</span>
          {check.builtIn ? null : <Tag>passes at {pct(check.threshold)} sure</Tag>}
          <Tag>{check.blocking ? "Blocks" : "Flags for review"}</Tag>
        </span>
      </span>
      <Button variant="ghost" size="sm" aria-label={`Edit ${check.name}`} className="text-muted-foreground" onClick={onEdit}>
        <Pencil /> Edit
      </Button>
      <Switch checked={check.enabled} onCheckedChange={onToggle} aria-label={`${check.name} on`} />
    </li>
  );
}

const BLANK: CheckDef = { id: "", name: "", question: "", model: JEV, threshold: 0.7, blocking: true, enabled: true };

/** A check: a yes-or-no question, the model that answers it, how sure of yes it must be, and what a fail does. */
function CheckDialog({ check, onClose, onSaved }: { check: CheckDef | "new" | null; onClose: () => void; onSaved: (s: Settings) => void }) {
  const open = check !== null;
  const [form, setForm] = useState<CheckDef>(BLANK);
  const [was, setWas] = useState<CheckDef | "new" | null>(null);
  if (check !== was) {
    setWas(check);
    if (check) setForm(check === "new" ? { ...BLANK, id: `check-${Date.now().toString(36)}` } : check);
  }
  const [busy, start] = useTransition();
  const set = <K extends keyof CheckDef>(key: K, value: CheckDef[K]) => setForm((f) => ({ ...f, [key]: value }));
  const isNew = check === "new";
  const builtIn = form.builtIn === "already-published";
  const decides = isDecisionModel(form.model.id);
  const sample = builtIn ? { found: null } : { answer: "yes", confidence: 0.94, ...(decides ? {} : { reasoning: "The report states its method and findings and sells nothing." }) };
  const ready = form.name.trim() && (builtIn || form.question.trim());
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "Add a check" : "Edit check"}</DialogTitle>
          <DialogDescription>
            {builtIn
              ? "Searches OpenAlex, Openscholar's index and our communities for the report, then asks the model whether each match is the same work."
              : "A yes-or-no question about the report, which the model answers from its details and its PDF. Yes passes."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <label className="block space-y-1.5">
            <span className="ps-1 text-xs font-medium text-muted-foreground">Name</span>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="No hate speech or harassment" />
          </label>
          {builtIn ? null : (
            <label className="block space-y-1.5">
              <span className="ps-1 text-xs font-medium text-muted-foreground">Question</span>
              <Textarea value={form.question} onChange={(e) => set("question", e.target.value)} rows={4} placeholder="Is the text free of hate speech, harassment and threats against people?" />
              <span className="block ps-1 text-xs text-muted-foreground">{"{byline}"} and {"{doi}"} are filled in with the report&apos;s own.</span>
            </label>
          )}
          <div className="space-y-1.5">
            <span className="ps-1 text-xs font-medium text-muted-foreground">{builtIn ? "Model that compares matches" : "Model"}</span>
            <ModelPicker
              align="start"
              current={form.model}
              efforts
              tasks={builtIn ? [] : ["screening"]}
              onChange={(m, effort) => set("model", { id: m.id, name: m.name, inputPricePerMillion: m.inputPricePerMillion, outputPricePerMillion: m.outputPricePerMillion, reasoningEfforts: m.reasoningEfforts, ...(effort ? { effort } : {}) })}
              trigger={<NodeCard model={form.model} paidBy="credits" interactive />}
            />
            {builtIn ? null : (
              <span className="block ps-1 text-xs text-muted-foreground">
                {decides ? "A decision model answers yes or no with how sure it is." : "An LLM answers yes or no, how sure it is, and why."}
              </span>
            )}
          </div>
          {builtIn ? null : (
            <div className="space-y-2.5">
              <span className="ps-1 text-xs font-medium text-muted-foreground">Passes when the model is this sure of yes</span>
              <div className="flex items-center gap-4 px-1">
                <Slider value={[Math.round(form.threshold * 100)]} min={50} max={99} step={1} onValueChange={([v]) => set("threshold", (v ?? 50) / 100)} aria-label="How sure of yes" />
                <span className="w-12 text-end text-sm font-medium tabular-nums">{pct(form.threshold)}</span>
              </div>
            </div>
          )}
          <label className="flex cursor-pointer items-center justify-between gap-6 rounded-2xl border border-border-subtle px-4 py-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Blocks publishing</span>
              <span className="block text-xs text-muted-foreground">{form.blocking ? "A report that fails it isn't published" : "A report that fails it goes to review"}</span>
            </span>
            <Switch checked={form.blocking} onCheckedChange={(blocking) => set("blocking", blocking)} />
          </label>
          <div className="space-y-1.5">
            <span className="ps-1 text-xs font-medium text-muted-foreground">Answer</span>
            <pre className="overflow-x-auto rounded-xl bg-inset px-3.5 py-3 font-mono text-xs/5">{JSON.stringify(sample, null, 2)}</pre>
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          {!isNew && !builtIn ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  try {
                    onSaved(await removeCheck(form.id));
                  } catch (error) {
                    failed(error);
                  }
                })
              }
            >
              <Trash2 /> Remove
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="relative"
              disabled={busy || !ready}
              onClick={() =>
                start(async () => {
                  try {
                    onSaved(await saveCheck({ ...form, name: form.name.trim(), question: form.question.trim() }));
                  } catch (error) {
                    failed(error);
                  }
                })
              }
            >
              <Working busy={busy}>{isNew ? "Add check" : "Save"}</Working>
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgreementDialog({ open, settings, onClose, onSaved }: { open: boolean; settings: Settings; onClose: () => void; onSaved: (s: Settings) => void }) {
  const [text, setText] = useState(settings.agreement.text);
  const [preview, setPreview] = useState(false);
  const [busy, start] = useTransition();
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setText(settings.agreement.text);
      setPreview(false);
    }
  }
  const changed = text !== settings.agreement.text;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Publishing agreement</DialogTitle>
          <DialogDescription>Saving makes version {settings.agreement.version + 1}. Reports already signed keep the version they signed.</DialogDescription>
        </DialogHeader>
        <Segmented
          label="Agreement view"
          value={preview ? "preview" : "edit"}
          onChange={(v) => setPreview(v === "preview")}
          options={[
            { id: "edit", label: "Markdown", icon: Pencil },
            { id: "preview", label: "As authors see it", icon: FileText },
          ]}
        />
        <div className="h-[55vh]">
          {preview ? (
            <div className="h-full overflow-y-auto rounded-xl border border-border-subtle px-5 py-4">
              <MarkdownContent content={text} />
            </div>
          ) : (
            <Textarea value={text} onChange={(e) => setText(e.target.value)} className="h-full resize-none font-mono text-xs/5" />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="relative"
            disabled={!changed || busy}
            onClick={() =>
              start(async () => {
                try {
                  onSaved(await updateAgreement(text));
                  toast.success(`Agreement version ${settings.agreement.version + 1}`);
                  onClose();
                } catch (error) {
                  failed(error);
                }
              })
            }
          >
            <Working busy={busy}>Save as version {settings.agreement.version + 1}</Working>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
