"use client";

// MOCK (mock/publish-reports): the admin page for publishing in Openscholar Reports. Submissions: every report, with
// approve and decline for those waiting. Settings: the Publish button, human review, the series and its DOIs, the
// model that reads PDFs, the checks, and the agreement. State lives in the mock's local store.

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { toast } from "sonner";
import Link from "@/components/workspace-link";
import { Enter, LIST, Paged, Segmented, Tile, Working, Zone, pagerOf } from "@/components/settings/parts";
import { NodeCard } from "@/components/settings/model-map";
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
  AiIcon,
  ArrowUpRight,
  BadgeCheck,
  Check,
  CircleX,
  FileText,
  Gauge,
  Hash,
  PenLine,
  Pencil,
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
import { removeCheck, retryDeposit, review, saveCheck, updateAgreement, updateSettings } from "@/app/actions/publish-mock";
import { SDGS } from "@/lib/openalex/vocabulary";
import { FunderName } from "@/components/papers/paper-entities";
import { DECISION_MODELS, bylineOf, doiOf, type Check as CheckDef, type MockState, type Settings, type Status, type Submission } from "@/lib/publish-mock/types";
import { cn } from "@/lib/utils";

const VIEWS = ["submissions", "settings"] as const;
const SHOWS = ["all", "review", "live", "failed", "declined"] as const;
type Show = (typeof SHOWS)[number];
type Sort = "newest" | "oldest" | "title";
const PER_PAGE = 8;
const ROW = 65;

const STATUS: Record<Exclude<Status, "draft">, { label: string; tone: "running" | "success" | "danger" | "neutral"; icon: typeof Check }> = {
  review: { label: "In review", tone: "running", icon: ReviewQueueIcon },
  live: { label: "Live", tone: "success", icon: BadgeCheck },
  failed: { label: "Failed checks", tone: "danger", icon: CircleX },
  declined: { label: "Declined", tone: "neutral", icon: CircleX },
};
const SHOW_LABEL: Record<Show, string> = { all: "All", review: "In review", live: "Live", failed: "Failed", declined: "Declined" };
const day = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function failed(error: unknown) {
  toast.error(error instanceof Error ? error.message : "Something went wrong");
}

export function AdminPublishing({ initial }: { initial: MockState }) {
  const [view, setView] = useQueryState("view", parseAsStringLiteral(VIEWS).withDefault("submissions"));
  const [settings, setSettings] = useState(initial.settings);
  const [submissions, setSubmissions] = useState(initial.submissions.filter((s) => s.status !== "draft"));
  const waiting = submissions.filter((s) => s.status === "review").length;
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
          <Submissions settings={settings} submissions={submissions} onChange={replace} />
        ) : (
          <SettingsView settings={settings} onChange={setSettings} />
        )}
      </div>
    </Enter>
  );
}

function Submissions({ settings, submissions, onChange }: { settings: Settings; submissions: Submission[]; onChange: (s: Submission) => void }) {
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const counts = useMemo(() => Object.fromEntries(SHOWS.map((s) => [s, s === "all" ? submissions.length : submissions.filter((x) => x.status === s).length])) as Record<Show, number>, [submissions]);
  const list = useMemo(() => {
    const words = query.trim().toLowerCase();
    const kept = submissions.filter((s) => (show === "all" || s.status === show) && (!words || [s.metadata?.title, s.id, s.doi, ...(s.metadata?.authors.map((a) => a.name) ?? [])].some((v) => v?.toLowerCase().includes(words))));
    return kept.sort((a, b) => (sort === "title" ? (a.metadata?.title ?? "").localeCompare(b.metadata?.title ?? "") : sort === "oldest" ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
  }, [submissions, query, show, sort]);
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
                <SubmissionRow key={s.id} submission={s} onOpen={() => setOpen(s.id)} onChange={onChange} />
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
      <SubmissionDialog submission={opened} settings={settings} onClose={() => setOpen(null)} onChange={onChange} />
    </Zone>
  );
}

function SubmissionRow({ submission: s, onOpen, onChange }: { submission: Submission; onOpen: () => void; onChange: (s: Submission) => void }) {
  const [busy, start] = useTransition();
  const status = STATUS[s.status as keyof typeof STATUS];
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
      {s.status === "live" ? (
        s.deposit === "failed" ? (
          <TooltipHint label="Send to Crossref again">
            <Button variant="ghost" size="icon-sm" aria-label={`Send ${s.id} to Crossref again`} className="relative ink-warning" disabled={busy} onClick={() => act(() => retryDeposit(s.id), "Sent to Crossref")}>
              <Working busy={busy}>
                <RefreshCw />
              </Working>
            </Button>
          </TooltipHint>
        ) : (
          <StatusIcon tone={s.deposit === "deposited" ? "success" : "running"} label={s.deposit === "deposited" ? "Registered with Crossref" : "Sending to Crossref"} icon={s.deposit === "deposited" ? Hash : undefined} />
        )
      ) : null}
      {status ? (
        <StatusChip tone={s.status === "live" && s.deposit === "failed" ? "warning" : status.tone} icon={s.status === "live" && s.deposit === "failed" ? TriangleAlert : status.icon} className="hidden shrink-0 sm:inline-flex">
          {s.status === "live" && s.deposit === "failed" ? "Crossref refused" : status.label}
        </StatusChip>
      ) : null}
      <span className="flex w-[4.5rem] shrink-0 justify-end gap-1">
        {s.status === "review" ? (
          <>
            <TooltipHint label="Decline">
              <Button variant="ghost" size="icon-sm" aria-label={`Decline ${s.id}`} className="text-muted-foreground hover:text-destructive" onClick={onOpen}>
                <CircleX />
              </Button>
            </TooltipHint>
            <TooltipHint label="Approve and publish">
              <Button variant="ghost" size="icon-sm" aria-label={`Approve ${s.id}`} className="relative text-primary" disabled={busy} onClick={() => act(() => review(s.id, "approve"), "Published")}>
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

function SubmissionDialog({ submission: s, settings, onClose, onChange }: { submission: Submission | null; settings: Settings; onClose: () => void; onChange: (s: Submission) => void }) {
  const [note, setNote] = useState("");
  const [busy, start] = useTransition();
  const decide = (decision: "approve" | "decline") =>
    start(async () => {
      if (!s) return;
      try {
        onChange(await review(s.id, decision, note.trim() || undefined));
        toast.success(decision === "approve" ? "Published" : "Declined");
        setNote("");
        onClose();
      } catch (error) {
        failed(error);
      }
    });
  const status = s ? STATUS[s.status as keyof typeof STATUS] : undefined;
  return (
    <Dialog open={!!s} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {s ? (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{s.id}</span>
                {status ? <StatusChip tone={status.tone} icon={status.icon}>{status.label}</StatusChip> : null}
              </div>
              <DialogTitle className="text-lg leading-snug">{s.metadata?.title}</DialogTitle>
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
              {s.metadata?.abstract ? <p className="line-clamp-5 text-sm/6 text-muted-foreground">{s.metadata.abstract}</p> : null}
              {s.metadata ? <Subjects m={s.metadata} /> : null}
              {s.results?.length ? (
                <ul className={LIST}>
                  {s.results.map((r) => (
                    <CheckRow key={r.checkId} result={r} />
                  ))}
                </ul>
              ) : null}
              {s.status === "declined" && s.note ? <p className="rounded-xl bg-inset p-3 text-sm">{s.note}</p> : null}
              {s.status === "review" ? (
                <label className="block space-y-1.5">
                  <span className="ps-1 text-xs font-medium text-muted-foreground">Note to the author, if you decline</span>
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
                </label>
              ) : null}
            </div>
            {s.status === "review" ? (
              <DialogFooter>
                <Button variant="outline" className="relative" disabled={busy} onClick={() => decide("decline")}>
                  <CircleX /> Decline
                </Button>
                <Button className="relative" disabled={busy} onClick={() => decide("approve")}>
                  <Working busy={busy}>
                    <span className="flex items-center gap-2">
                      <Check /> Approve and publish
                    </span>
                  </Working>
                </Button>
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
  return (
    <div className="space-y-8">
      <Zone label="Publishing">
        <ul className={LIST}>
          <li>
            <label className="flex cursor-pointer items-center justify-between gap-6 px-4 py-3.5 transition-colors hover:bg-muted">
              <span className="min-w-0">
                <span className="block text-sm font-medium">Publish button</span>
                <span className="block text-xs text-muted-foreground">Publish in the sidebar, for everyone signed in</span>
              </span>
              <Switch checked={settings.enabled} onCheckedChange={(enabled) => save({ enabled })} />
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

      <Zone label="Series and DOIs" aside={<StatusChip tone={settings.crossref === "sandbox" ? "warning" : "success"}>{settings.crossref === "sandbox" ? "Crossref sandbox" : "Crossref"}</StatusChip>}>
        <ul className={LIST}>
          <Row label="Series">
            <SavedInput value={settings.series.name} onSave={(name) => save({ series: { name } })} className="w-64" />
          </Row>
          <Row label="ISSN" hint="Pending until the ISSN centre assigns it">
            <SavedInput value={settings.series.issn} placeholder="Pending" onSave={(issn) => save({ series: { issn } })} className="w-40 font-mono" />
          </Row>
          <Row label="DOI prefix">
            <SavedInput value={settings.series.prefix} onSave={(prefix) => save({ series: { prefix } })} className="w-40 font-mono" />
          </Row>
          <Row label="DOI suffix" hint="{key} is the report's key">
            <SavedInput value={settings.series.suffix} onSave={(suffix) => save({ series: { suffix } })} className="w-64 font-mono" />
          </Row>
          <Row label="Byline" hint="{series}, {issn} and {doi} are filled in for each report" wide>
            <SavedInput value={settings.series.byline} onSave={(byline) => save({ series: { byline } })} className="w-full" />
            <p className="flex items-start gap-2 rounded-xl bg-inset px-3 py-2.5 text-xs text-muted-foreground">
              <FileText className="mt-px size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{bylineOf(settings, sampleDoi)}</span>
            </p>
          </Row>
          <Row label="Crossref">
            <Segmented
              label="Crossref"
              value={settings.crossref}
              onChange={(crossref) => (crossref === "production" ? toast.error("Shared dev registers sandbox DOIs only") : save({ crossref }))}
              options={[
                { id: "sandbox", label: "Sandbox" },
                { id: "production", label: "Production" },
              ]}
            />
          </Row>
        </ul>
      </Zone>

      <Zone label="Metadata">
        <div className="space-y-2">
          <ModelPicker
            current={settings.metadataModel}
            onChange={(m) => save({ metadataModel: { id: m.id, name: m.name, inputPricePerMillion: m.inputPricePerMillion, outputPricePerMillion: m.outputPricePerMillion } })}
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
  const model = check.engine === "llm" ? check.llm?.name : DECISION_MODELS.find((m) => m.id === check.decisionModel)?.name;
  return (
    <li className={cn("flex items-center gap-3 px-4 py-3", !check.enabled && "opacity-60")}>
      <Tile icon={check.engine === "llm" ? AiIcon : Gauge} tint={check.engine === "llm" ? "var(--primary)" : "oklch(0.62 0.13 230)"} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{check.name}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{model}</span>
          <Tag>
            {check.direction === "atMost" ? "max" : "min"} {pct(check.threshold)}
          </Tag>
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

const BLANK: CheckDef = { id: "", name: "", engine: "decision", decisionModel: "omni-moderation", instructions: "", threshold: 0.5, direction: "atLeast", blocking: true, enabled: true };

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
  const textMatch = form.engine === "decision" && form.decisionModel === "text-match";
  const sample = { pass: true, score: form.engine === "llm" ? 0.93 : 0.04, ...(form.engine === "llm" ? { reasoning: "A study with a question, a method and findings." } : {}) };
  const ready = form.name.trim() && (form.engine === "decision" ? form.decisionModel : form.llm);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "Add a check" : "Edit check"}</DialogTitle>
          <DialogDescription>Every check answers with a pass, a score from 0 to 1, and with an LLM, its reasoning.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <label className="block space-y-1.5">
            <span className="ps-1 text-xs font-medium text-muted-foreground">Name</span>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Hate speech and harassment" />
          </label>
          <div className="space-y-1.5">
            <span className="ps-1 text-xs font-medium text-muted-foreground">Runs on</span>
            <Segmented
              label="Runs on"
              value={form.engine}
              fill
              onChange={(engine) => setForm((f) => ({ ...f, engine, ...(engine === "llm" && !f.llm ? { llm: { id: "google/gemini-3-flash-preview", name: "Gemini 3 Flash Preview", inputPricePerMillion: 0.5, outputPricePerMillion: 3 } } : {}) }))}
              options={[
                { id: "decision", label: "Decision model", icon: Gauge },
                { id: "llm", label: "LLM", icon: AiIcon },
              ]}
            />
          </div>
          {form.engine === "decision" ? (
            <Select value={form.decisionModel} onValueChange={(v) => set("decisionModel", v as CheckDef["decisionModel"])}>
              <SelectTrigger className="h-auto w-full py-2" aria-label="Decision model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DECISION_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <span className="flex flex-col items-start">
                      <span className="text-sm">
                        {m.name} <span className="text-muted-foreground">{m.maker}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">{m.hint}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : form.llm ? (
            <ModelPicker
              align="start"
              current={form.llm}
              onChange={(m) => set("llm", { id: m.id, name: m.name, inputPricePerMillion: m.inputPricePerMillion, outputPricePerMillion: m.outputPricePerMillion })}
              trigger={<NodeCard model={form.llm} paidBy="credits" interactive />}
            />
          ) : null}
          <label className="block space-y-1.5">
            <span className="ps-1 text-xs font-medium text-muted-foreground">{textMatch ? "Text to find" : form.engine === "llm" ? "Instructions" : "What it looks for"}</span>
            <Textarea value={form.instructions} onChange={(e) => set("instructions", e.target.value)} rows={textMatch ? 2 : 4} className={cn(textMatch && "font-mono text-xs")} />
            {textMatch ? <span className="block ps-1 text-xs text-muted-foreground">{"{byline}"} is the series&apos; byline, with the report&apos;s DOI</span> : null}
          </label>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="ps-1 text-xs font-medium text-muted-foreground">Passes when the score is</span>
              <Segmented
                label="Passes when the score is"
                value={form.direction}
                onChange={(direction) => set("direction", direction)}
                options={[
                  { id: "atLeast", label: "At least" },
                  { id: "atMost", label: "At most" },
                ]}
              />
            </div>
            <div className="flex items-center gap-4 px-1">
              <Slider value={[Math.round(form.threshold * 100)]} min={0} max={100} step={1} onValueChange={([v]) => set("threshold", (v ?? 0) / 100)} aria-label="Threshold" />
              <span className="w-12 text-end text-sm font-medium tabular-nums">{pct(form.threshold)}</span>
            </div>
          </div>
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
          {!isNew ? (
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
                    onSaved(await saveCheck({ ...form, name: form.name.trim() }));
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
