"use client";

// MOCK (mock/publish-reports): publishing a work in Openscholar Reports. Sign the agreement, which reserves the DOI;
// upload the PDF with the byline on it; correct the details read from it; the checks run; it goes live, or waits for
// review. Its state lives in the mock's local store (app/actions/publish-mock.ts).

import { useRef, useState, useTransition, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import Link from "@/components/workspace-link";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { MarkdownContent } from "@/components/markdown-content";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TooltipHint } from "@/components/ui/tooltip";
import { EDGE_FADE } from "@/components/ui/scroll-area";
import { EASE } from "@/components/ui/opening";
import { Working } from "@/components/settings/parts";
import { Spinner } from "@/components/ui/spinner";
import {
  AiIcon,
  ArrowUpRight,
  CircleCheck,
  CircleX,
  Copy,
  FileText,
  FileUp,
  PenLine,
  Plus,
  PublishIcon,
  ReviewQueueIcon,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  BadgeCheck,
  Hash,
} from "@/components/icons";
import { DetailsStep } from "@/components/publish-mock/details-step";
import { goTo, openReport, signAgreement, startOver, uploadPdf } from "@/app/actions/publish-mock";
import { StatusFilter, YourReports, type Show } from "@/components/publish-mock/your-reports";
import { ListViewTabs } from "@/components/evidence-libraries/list-controls";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { bylineOf, type CheckResult, type Metadata, type Settings, type Step, type Submission } from "@/lib/publish-mock/types";
import { cn } from "@/lib/utils";

const STEPS: Array<{ id: Step | "live"; label: string; icon: typeof PenLine }> = [
  { id: "agreement", label: "Agreement", icon: PenLine },
  { id: "doi", label: "DOI", icon: Hash },
  { id: "upload", label: "PDF", icon: FileUp },
  { id: "details", label: "Details", icon: FileText },
  { id: "checks", label: "Checks", icon: ShieldCheck },
  { id: "live", label: "Live", icon: BadgeCheck },
];

/** Where the trail stands: the step being done, or past the checks, the outcome. */
function placeOf(draft: Submission | null) {
  if (!draft) return 0;
  if (draft.step === "done") return draft.status === "live" ? 5 : 4;
  return STEPS.findIndex((s) => s.id === draft.step);
}

const bytes = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.round(n / 1000)} kB`);
const dateOf = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function copy(text: string, what: string) {
  void navigator.clipboard.writeText(text).then(() => toast.success(`${what} copied`));
}

type Running = { checks: Array<{ id: string; name: string; model: string }>; results: Record<string, CheckResult> };

/** Reads the checks' answers as the route sends them, one line each, and the report as saved at the end. */
async function streamChecks(id: string, metadata: Metadata, onResult: (r: CheckResult) => void): Promise<Submission> {
  const response = await fetch("/publish/checks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, metadata }) });
  if (!response.ok || !response.body) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? "The checks couldn't start");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines.filter(Boolean)) {
      const message = JSON.parse(line) as { type: "result"; result: CheckResult } | { type: "done"; draft: Submission };
      if (message.type === "result") onResult(message.result);
      else return message.draft;
    }
  }
  throw new Error("The checks stopped before they finished");
}

export function PublishFlow({ settings, initial, reports: initialReports, userName }: { settings: Settings; initial: Submission | null; reports: Submission[]; userName: string }) {
  const [view, setView] = useQueryState("view", parseAsStringLiteral(["new", "reports"] as const).withDefault("new"));
  const [draft, setDraftOnly] = useState(initial);
  const [reports, setReports] = useState(initialReports);
  const [running, setRunning] = useState<Running | null>(null);
  // Every change to the report shows on Your reports too.
  const setDraft = (next: Submission | null) => {
    setDraftOnly(next);
    if (next) setReports((all) => [next, ...all.filter((r) => r.id !== next.id)]);
  };
  const place = running ? 4 : placeOf(draft);
  const step: Step = draft?.step ?? "agreement";
  const back = (to: Step) => {
    void goTo(to).then(setDraft);
  };
  const run = async (metadata: Metadata) => {
    if (!draft) return;
    const id = draft.id;
    // The author's corrections are kept on the report, so a run that fails comes back to them, not to what the PDF said.
    setDraftOnly({ ...draft, metadata });
    // The rows are there at once, one per check that's on; each settles as its answer comes.
    setRunning({ checks: settings.checks.filter((c) => c.enabled).map((c) => ({ id: c.id, name: c.name, model: c.model.name })), results: {} });
    try {
      const saved = await streamChecks(id, metadata, (result) => setRunning((r) => (r ? { ...r, results: { ...r.results, [result.checkId]: result } } : r)));
      setReports((all) => [saved, ...all.filter((r) => r.id !== saved.id)]);
      // Another report opened while these ran stays the one shown.
      setDraftOnly((current) => (current?.id === saved.id ? saved : current));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The checks couldn't run");
    } finally {
      setRunning(null);
    }
  };
  const [show, setShow] = useState<Show>("all");
  // In the header bar, as on Explore: the page's two views, and on Your reports its status filter.
  const tabs = (
    <ListViewTabs
      label="Publish"
      value={view}
      onChange={(next) => void setView(next === "reports" ? "reports" : null)}
      tabs={[
        { value: "new", label: draft ? "Your report" : "New report", icon: <PublishIcon aria-hidden className="size-3.5" /> },
        { value: "reports", label: "Your reports", icon: <FileText aria-hidden className="size-3.5" />, count: reports.length },
      ]}
    />
  );

  return (
    <LibraryPageShell
      icon={PublishIcon}
      title="Publish"
      tabs={tabs}
      filters={view === "reports" ? <StatusFilter reports={reports} show={show} onShow={setShow} /> : undefined}
      intro={view === "new" ? <StepTrail place={place} canGoBack={draft?.step !== "done" && !running} onBack={back} draft={running ? null : draft} /> : undefined}
    >
      {view === "reports" ? (
        <YourReports
          show={show}
          reports={reports}
          onNew={() => {
            void startOver().then(() => {
              setDraftOnly(null);
              void setView(null);
            });
          }}
          onOpen={(id) => {
            openReport(id)
              .then((report) => {
                setDraftOnly(report);
                void setView(null);
              })
              .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "That report couldn't be opened"));
          }}
        />
      ) : (
      <div className="grid gap-8 p-4 sm:p-6 @3xl:grid-cols-[minmax(0,1fr)_17rem] @3xl:gap-10">
        <AutoHeight>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={running || step === "done" ? "checks" : step}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25, ease: EASE }}
            >
              {running ? (
                <Checks rows={running.checks.map((c) => ({ ...c, result: running.results[c.id] }))} draft={null} />
              ) : step === "agreement" ? (
                <AgreementStep settings={settings} userName={draft?.signedBy?.name ?? userName} onSigned={setDraft} />
              ) : step === "doi" && draft ? (
                <DoiStep settings={settings} draft={draft} onNext={() => back("upload")} />
              ) : step === "upload" && draft ? (
                <UploadStep settings={settings} draft={draft} onRead={setDraft} />
              ) : step === "details" && draft?.metadata ? (
                <DetailsStep initial={draft.metadata} onRun={run} />
              ) : draft ? (
                <Checks
                  rows={(draft.results ?? []).map((r) => ({ id: r.checkId, name: r.name, model: r.model, result: r }))}
                  draft={draft}
                  onFix={() => back("upload")}
                  onAnother={() => {
                    void startOver().then(() => setDraftOnly(null));
                  }}
                />
              ) : null}
            </motion.div>
          </AnimatePresence>
        </AutoHeight>
        <ReportCover settings={settings} draft={draft} />
      </div>
      )}
    </LibraryPageShell>
  );
}

/** The six steps as one track that fills as the report moves on. Steps already done can be gone back to until the checks run. */
function StepTrail({ place, canGoBack, onBack, draft }: { place: number; canGoBack: boolean; onBack: (step: Step) => void; draft: Submission | null }) {
  const reduce = useReducedMotion();
  const failed = draft?.step === "done" && (draft.status === "failed" || draft.status === "declined");
  const waiting = draft?.step === "done" && draft.status === "review";
  return (
    <div className="px-4 pb-4 pt-5 sm:px-6">
      <ol className="grid grid-cols-6 gap-1">
        {STEPS.map((s, i) => {
          const done = i < place || (i === place && place === 5);
          const current = i === place && place !== 5;
          const Icon = done ? CircleCheck : current && failed ? CircleX : current && waiting ? ReviewQueueIcon : s.icon;
          const clickable = canGoBack && done && i < 4 && i > 0;
          const body = (
            <>
              <Icon className={cn("size-4 shrink-0", done ? "text-primary" : current ? (failed ? "text-destructive" : "text-primary") : "text-muted-foreground/60")} />
              {/* On a phone only the current step keeps its name; the others are their icons. */}
              <span className={cn("truncate text-xs font-medium", done || current ? "text-foreground" : "text-muted-foreground", !current && "max-sm:sr-only")}>{s.label}</span>
            </>
          );
          return (
            <li key={s.id} className="min-w-0">
              {clickable ? (
                <button type="button" onClick={() => onBack(s.id as Step)} className="flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 text-start transition-colors hover:text-primary">
                  {body}
                </button>
              ) : (
                <div aria-current={current ? "step" : undefined} className="flex min-w-0 items-center gap-1.5 py-1">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-inset">
        <motion.div
          className={cn("h-full rounded-full", failed ? "bg-destructive" : "bg-primary")}
          initial={false}
          animate={{ width: `${((place + (place === 5 ? 1 : 0.5)) / STEPS.length) * 100}%` }}
          transition={reduce ? { duration: 0 } : { duration: 0.5, ease: EASE }}
        />
      </div>
    </div>
  );
}

function StepHead({ title, aside, children }: { title: string; aside?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {aside}
      </div>
      {children ? <p className="max-w-xl text-sm text-muted-foreground">{children}</p> : null}
    </div>
  );
}

function AgreementStep({ settings, userName, onSigned }: { settings: Settings; userName: string; onSigned: (d: Submission) => void }) {
  const [name, setName] = useState(userName);
  const [all, setAll] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, start] = useTransition();
  const { agreement } = settings;
  return (
    <div>
      <StepHead
        title={`Publication agreement with ${settings.series.name}`}
        aside={<StatusChip tone="neutral">Version {agreement.version}</StatusChip>}
      >
        You keep the copyright and publish under CC BY 4.0. Signing reserves your DOI.
      </StepHead>
      <div
        className="max-h-[22rem] overflow-y-auto rounded-2xl border border-border-subtle bg-inset/40 px-5"
        style={{ maskImage: `linear-gradient(to bottom, transparent, black ${EDGE_FADE}px, black calc(100% - ${EDGE_FADE}px), transparent)`, paddingBlock: EDGE_FADE }}
      >
        <MarkdownContent content={agreement.text} className="text-sm sm:text-sm [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:leading-snug [&_h2]:text-base" />
      </div>
      <div className="mt-5 grid gap-4 sm:max-w-md">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Signed by</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <Checkbox checked={all} onCheckedChange={(v) => setAll(v === true)} className="mt-0.5" />
          <span>I sign for all the authors, who have agreed</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5" />
          <span>I agree to this agreement</span>
        </label>
      </div>
      <div className="mt-6 flex justify-end">
        <Button
          className="relative"
          disabled={!agreed || !name.trim() || busy}
          onClick={() => start(async () => onSigned(await signAgreement({ name, onBehalfOfAll: all })))}
        >
          <Working busy={busy}>
            <span className="flex items-center gap-2">
              <PenLine /> Sign and reserve a DOI
            </span>
          </Working>
        </Button>
      </div>
    </div>
  );
}

function CopyField({ label, value, mono = false, what }: { label: string; value: string; mono?: boolean; what: string }) {
  return (
    <div className="space-y-1.5">
      <span className="ps-1 text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-start gap-2 rounded-xl border border-border-subtle bg-inset px-3.5 py-3">
        <span className={cn("min-w-0 flex-1 break-words text-sm", mono && "font-mono text-[0.9375rem] font-medium tracking-tight")}>{value}</span>
        <TooltipHint label={`Copy ${what.toLowerCase()}`}>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={`Copy ${what.toLowerCase()}`} className="-me-1 text-muted-foreground" onClick={() => copy(value, what)}>
            <Copy />
          </Button>
        </TooltipHint>
      </div>
    </div>
  );
}

function DoiStep({ settings, draft, onNext }: { settings: Settings; draft: Submission; onNext: () => void }) {
  return (
    <div>
      <StepHead title="Your DOI is reserved" aside={<StatusChip tone="neutral" icon={Hash}>Reserved</StatusChip>}>
        Put the byline on the cover or the first page of your PDF. The checks look for the DOI in it.
      </StepHead>
      <div className="grid gap-4">
        <CopyField label="DOI" value={`https://doi.org/${draft.doi}`} mono what="DOI" />
        <CopyField label="Byline" value={bylineOf(settings, draft.doi)} what="Byline" />
      </div>
      <div className="mt-6 flex justify-end">
        <Button onClick={onNext}>
          <FileUp /> Upload the PDF
        </Button>
      </div>
    </div>
  );
}

function UploadStep({ settings, draft, onRead }: { settings: Settings; draft: Submission; onRead: (d: Submission) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, start] = useTransition();
  const send = (picked: File | undefined) => {
    if (!picked) return;
    if (!/\.pdf$/i.test(picked.name)) {
      toast.error("Choose a PDF");
      return;
    }
    if (picked.size > 50_000_000) {
      toast.error("The PDF is over 50 MB");
      return;
    }
    setFile(picked);
    const form = new FormData();
    form.set("pdf", picked);
    start(async () => {
      try {
        onRead(await uploadPdf(form));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "The PDF couldn't be read");
        setFile(null);
      }
    });
  };
  return (
    <div>
      <StepHead title="Upload the PDF">The PDF must carry the byline with your DOI, {draft.doi}.</StepHead>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          send(e.dataTransfer.files[0]);
        }}
        disabled={busy}
        className={cn(
          "flex h-52 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-center transition-colors",
          over ? "border-primary bg-primary/5" : "border-border hover:border-primary/60 hover:bg-muted/50",
        )}
      >
        {busy && file ? (
          <>
            <AiIcon working className="size-6 text-primary" />
            <span className="text-sm font-medium">Reading {file.name}</span>
            <span className="text-xs text-muted-foreground">{bytes(file.size)}</span>
          </>
        ) : (
          <>
            <FileUp className="size-6 text-primary" />
            <span className="text-sm font-medium">Drop the PDF here, or choose it</span>
            <span className="text-xs text-muted-foreground">One PDF, up to 50 MB</span>
          </>
        )}
      </button>
      <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => send(e.target.files?.[0])} />
      {draft.pdf && !busy ? (
        <p className="mt-3 flex items-center gap-2 ps-1 text-xs text-muted-foreground">
          <FileText className="size-3.5" />
          Uploading again replaces {draft.pdf.name}
        </p>
      ) : null}
      <p className="sr-only">{settings.series.name}</p>
    </div>
  );
}

/**
 * One check: running, then its answer. A check that finds something or doesn't says what; a scored one shows its score
 * against its line, the failing side tinted. What arrives after the row is drawn fades in and opens its place.
 */
export function CheckRow({ name, model, result }: { name: string; model: string; result?: CheckResult }) {
  const reduce = useReducedMotion();
  const tone = result ? (result.pass ? "success" : result.blocking ? "danger" : "warning") : null;
  const asked = result?.confidence !== undefined && result.threshold !== undefined;
  const sure = Math.round((result?.confidence ?? 0) * 100);
  const need = Math.round((result?.threshold ?? 0) * 100);
  const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.2 } };
  return (
    <li className="px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span className="relative flex size-5 shrink-0 items-center justify-center">
          <AnimatePresence initial={false} mode="popLayout">
            {result ? (
              <motion.span
                key="done"
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 500, damping: 26 }}
              >
                {result.pass ? <CircleCheck className="size-5 ink-success" /> : result.blocking ? <CircleX className="size-5 text-destructive" /> : <TriangleAlert className="size-5 ink-warning" />}
              </motion.span>
            ) : (
              <motion.span key="running" {...fade}>
                <Spinner className="size-4 text-primary" />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}</span>
        </span>
        <span className="hidden truncate text-xs text-muted-foreground sm:inline">{model}</span>
        {/* The chip's place is held while the check runs, so the row doesn't shift when it lands. */}
        <span className="flex min-w-[4.75rem] justify-end">
          <AnimatePresence initial={false}>
            {result && tone ? (
              <motion.span key="chip" {...fade}>
                <StatusChip tone={tone}>{result.pass ? "Passed" : result.blocking ? "Failed" : "Flagged"}</StatusChip>
              </motion.span>
            ) : null}
          </AnimatePresence>
        </span>
      </div>
      <AutoHeight>
        <AnimatePresence initial={false}>
          {result ? (
            <motion.div key="body" {...fade}>
              {/* A question's answer: how sure the model is of yes, against the line it has to clear, the side short of it tinted. */}
              {asked ? (
                <div className="ms-8 mt-2.5 flex items-center gap-3">
                  <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-inset">
                    <span aria-hidden className={cn("absolute inset-y-0 start-0", result.blocking ? "bg-destructive/15" : "bg-warning/20")} style={{ width: `${need}%` }} />
                    <motion.div
                      className={cn("absolute inset-y-0 start-0 rounded-full", result.pass ? "bg-success" : result.blocking ? "bg-destructive" : "bg-warning")}
                      initial={{ width: "0%" }}
                      animate={{ width: `${Math.max(sure, 2)}%` }}
                      transition={reduce ? { duration: 0 } : { duration: 0.5, ease: EASE }}
                    />
                    <span aria-hidden className="absolute inset-y-0 w-0.5 bg-foreground/50" style={{ insetInlineStart: `${need}%` }} />
                  </div>
                  <span className="w-40 shrink-0 text-end text-xs tabular-nums">
                    <span className="font-medium text-foreground/80">{result.answer === "unclear" ? "Unclear" : `${sure}% sure of yes`}</span>
                  </span>
                </div>
              ) : result.evidence ? null : (
                <p className="ms-8 mt-1.5 text-xs/5 text-muted-foreground">{result.detail}</p>
              )}
              {asked && result.detail ? <p className="ms-8 mt-1.5 text-xs/5 text-muted-foreground">{result.detail}</p> : null}
              {result.evidence ? (
                <a
                  href={result.evidence.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ms-8 mt-2 flex min-w-0 items-center gap-1.5 text-xs/5 text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
                >
                  <span className="shrink-0">{result.evidence.where ? `Found in ${result.evidence.where}:` : "Found as"}</span>
                  <span className="truncate font-medium text-foreground/80">{result.evidence.title}</span>
                  <ArrowUpRight className="size-3 shrink-0" />
                </a>
              ) : null}
              {result.reasoning ? <p className="ms-8 mt-2 text-xs/5 text-muted-foreground">{result.reasoning}</p> : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </AutoHeight>
    </li>
  );
}

/** The checks, running or answered, under a head that says where the report stands, and what to do next. */
function Checks({ rows, draft, onFix, onAnother }: { rows: Array<{ id: string; name: string; model: string; result?: CheckResult }>; draft: Submission | null; onFix?: () => void; onAnother?: () => void }) {
  const answered = rows.filter((r) => r.result).length;
  const head = !draft ? (
    <StepHead key="running" title="Running the checks" aside={<StatusChip tone="running" icon="tone">{answered} of {rows.length}</StatusChip>}>
      Looking for earlier copies takes a few seconds.
    </StepHead>
  ) : draft.status === "live" ? (
    <StepHead key="live" title="Published" aside={<StatusChip tone="success" icon={BadgeCheck}>DOI active</StatusChip>}>
      Your report is live. Communities can add it now; the DOI resolves once Crossref has registered it.
    </StepHead>
  ) : draft.status === "review" ? (
    <StepHead key="review" title="Waiting for review" aside={<StatusChip tone="running" icon={ReviewQueueIcon}>In review</StatusChip>}>
      Your report passed its checks. A reviewer approves it before the DOI goes live.
    </StepHead>
  ) : draft.status === "declined" ? (
    <StepHead key="declined" title="Not published" aside={<StatusChip tone="danger" icon={CircleX}>Declined</StatusChip>}>
      {draft.note ?? "The reviewer declined this report."}
    </StepHead>
  ) : (
    <StepHead key="failed" title="Not published yet" aside={<StatusChip tone="danger" icon={CircleX}>A check failed</StatusChip>}>
      Fix the PDF and upload it again. Your DOI stays reserved.
    </StepHead>
  );
  return (
    <div>
      <AutoHeight>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={draft ? draft.status : "running"} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            {head}
          </motion.div>
        </AnimatePresence>
      </AutoHeight>
      <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
        {rows.map((r) => (
          <CheckRow key={r.id} name={r.name} model={r.model} result={r.result} />
        ))}
      </ul>
      <AutoHeight>
        <AnimatePresence initial={false}>
          {draft ? (
            <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className="mt-6 flex flex-wrap justify-end gap-2">
              {draft.status === "failed" ? (
                <Button onClick={onFix}>
                  <RotateCcw /> Upload a new PDF
                </Button>
              ) : (
                <>
                  {draft.status === "live" ? (
                    <Button asChild variant="outline">
                      <Link href={`/papers/${draft.id}`}>
                        Open its page <ArrowUpRight />
                      </Link>
                    </Button>
                  ) : null}
                  <Button variant={draft.status === "live" ? "default" : "outline"} onClick={onAnother}>
                    <Plus /> Publish another
                  </Button>
                </>
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </AutoHeight>
    </div>
  );
}

/** The report as it builds up: its cover with the series, title, authors and DOI, and what it stands on. */
function ReportCover({ settings, draft }: { settings: Settings; draft: Submission | null }) {
  const m = draft?.metadata;
  const deposit = draft?.deposit;
  const status = draft?.step === "done" ? draft.status : null;
  return (
    <aside className="space-y-4 @3xl:sticky @3xl:top-24 @3xl:self-start">
      <div className="relative mx-auto aspect-[3/4] w-full max-w-[17rem] overflow-hidden rounded-xl border border-border-subtle bg-background shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_32px_-12px_rgb(0_0_0/0.18)]">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-primary" />
        <div className="flex h-full flex-col p-5 pt-6">
          <span className="text-[0.625rem] font-semibold tracking-wide text-primary">{settings.series.name}</span>
          <span className="text-[0.625rem] text-muted-foreground">ISSN {settings.series.issn || "pending"}</span>
          <div className="mt-6 min-h-0 flex-1">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={m?.title ?? "untitled"}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className={cn("line-clamp-5 text-[0.9375rem] font-semibold leading-snug tracking-tight", !m && "text-muted-foreground/50")}
              >
                {m?.title || "Your title"}
              </motion.p>
            </AnimatePresence>
            <ul className="mt-2 space-y-0.5 text-[0.6875rem] text-muted-foreground">
              {m?.authors.some((a) => a.name) ? m.authors.filter((a) => a.name).slice(0, 4).map((a) => <li key={a.name} className="truncate">{a.name}</li>) : <li>Authors</li>}
            </ul>
          </div>
          <div className="space-y-1 border-t border-border-subtle pt-2.5">
            <span className="block text-[0.5625rem] text-muted-foreground">This publication is an Openscholar Report</span>
            <span className={cn("block truncate font-mono text-[0.625rem]", draft ? "text-foreground" : "text-muted-foreground/50")}>
              {draft ? `doi.org/${draft.doi}` : "doi.org/10.5555/…"}
            </span>
          </div>
        </div>
      </div>
      <ul className="mx-auto max-w-[17rem] space-y-2 text-xs">
        <Fact icon={PenLine} on={!!draft?.signedAt} chip={draft?.signedAt ? `v${draft.agreementVersion}` : undefined}>
          {draft?.signedAt ? `Signed ${dateOf(draft.signedAt)}` : "Agreement not signed"}
        </Fact>
        <Fact icon={Hash} on={!!draft}>
          {status === "live" ? (deposit === "deposited" ? "Registered with Crossref" : "Sending to Crossref") : draft ? "DOI reserved" : "No DOI yet"}
        </Fact>
        <Fact icon={FileText} on={!!draft?.pdf} chip={draft?.pdf ? bytes(draft.pdf.bytes) : undefined}>
          {draft?.pdf ? `${draft.pdf.pages} ${draft.pdf.pages === 1 ? "page" : "pages"}` : "No PDF yet"}
        </Fact>
        <Fact icon={ShieldCheck} on={!!draft?.checksVersion} chip={draft?.checksVersion ? `v${draft.checksVersion}` : undefined}>
          {draft?.checksVersion ? "Checks run" : `${settings.checks.filter((c) => c.enabled).length} checks to pass`}
        </Fact>
      </ul>
    </aside>
  );
}

function Fact({ icon: Icon, on, chip, children }: { icon: typeof Hash; on: boolean; chip?: string; children: ReactNode }) {
  return (
    <li className={cn("flex h-5 items-center gap-2 transition-colors", on ? "text-foreground" : "text-muted-foreground")}>
      <Icon className={cn("size-3.5 shrink-0", on ? "text-primary" : "text-muted-foreground/60")} />
      <span className="truncate">{children}</span>
      {chip ? <span className="ms-auto shrink-0 rounded bg-inset px-1.5 py-px tabular-nums text-muted-foreground">{chip}</span> : null}
    </li>
  );
}
