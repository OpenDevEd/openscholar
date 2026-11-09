"use client";

// MOCK (mock/publish-reports): publishing a work in Openscholar Reports. Sign the agreement, which reserves the DOI;
// upload the PDF with the byline on it; correct the details read from it; the checks run; it goes live, or waits for
// review. Its state lives in the mock's local store (app/actions/publish-mock.ts).

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import Link from "@/components/workspace-link";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { MarkdownContent } from "@/components/markdown-content";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/evidence-libraries/configuration/section-card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
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
  EvidenceLibrariesIcon,
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
import { activate, addToCommunity, goTo, openReport, readPdfDetails, readReport, requestReview, signAgreement, startOver, uploadPdf } from "@/app/actions/publish-mock";
import { CommunityControl } from "@/components/evidence-libraries/added-papers/community-control";
import { RegistrationChips } from "@/components/publish-mock/registration";
import { CitationControl } from "@/components/citation-control";
import { PaperCover } from "@/components/papers/paper-cover";
import { REPORT_COVER } from "@/lib/papers/cover";
import { reportPaper } from "@/lib/publish-mock/report-paper";
import { StatusFilter, YourReports, type Show } from "@/components/publish-mock/your-reports";
import { ListViewTabs } from "@/components/evidence-libraries/list-controls";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { REVIEW_TEXT_MAX, bylineOf, coverUrlOf, stageOf, stepsOf, type CheckResult, type Metadata, type Settings, type Step, type Submission } from "@/lib/publish-mock/types";
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

/** What went wrong, in words for a toast. A request that never arrived, as when the connection drops, says so plainly. */
// A built server hides what a server action threw and sends a digest in its place: then the words kept here say it.
const reasonOf = (error: unknown, otherwise: string) =>
  error instanceof TypeError ? "Openscholar couldn't be reached. Try again." : error instanceof Error && !("digest" in error) ? error.message : otherwise;

/** A handler for a request that failed: its reason in a toast. */
const said = (otherwise: string) => (error: unknown) => void toast.error(reasonOf(error, otherwise));

function copy(text: string, what: string) {
  void navigator.clipboard.writeText(text).then(() => toast.success(`${what} copied`));
}

type Running = { checks: Array<{ id: string; name: string }>; results: Record<string, CheckResult> };

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
      const message = JSON.parse(line) as { type: "result"; result: CheckResult } | { type: "done"; draft: Submission } | { type: "error"; error: string };
      if (message.type === "result") onResult(message.result);
      else if (message.type === "error") throw new Error(message.error);
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
  // What just happened here and now, signing or activating: only then does its step play its moment. A step opened
  // any other way is already settled.
  const [fresh, setFresh] = useState<{ id: string; step: "doi" | "live" } | null>(null);
  // Every change to the report shows on Your reports too.
  const setDraft = (next: Submission | null) => {
    setDraftOnly(next);
    if (next) setReports((all) => [next, ...all.filter((r) => r.id !== next.id)]);
  };
  const place = running ? 4 : placeOf(draft);
  const step: Step = draft?.step ?? "agreement";
  const back = (to: Step) => {
    setFresh(null);
    goTo(to).then(setDraft, said("That step couldn't be opened"));
  };
  // Starts a new report in place of one that's done.
  const another = (then?: () => void) => {
    startOver().then(() => {
      setDraftOnly(null);
      then?.();
    }, said("A new report couldn't be started"));
  };
  const run = async (metadata: Metadata) => {
    if (!draft) return;
    const id = draft.id;
    // The author's corrections are kept on the report, so a run that fails comes back to them, not to what the PDF said.
    setDraftOnly({ ...draft, metadata });
    // The rows are there at once, one per check that's on; each settles as its answer comes.
    setRunning({ checks: settings.checks.filter((c) => c.enabled).map((c) => ({ id: c.id, name: c.name })), results: {} });
    try {
      const saved = await streamChecks(id, metadata, (result) => setRunning((r) => (r ? { ...r, results: { ...r.results, [result.checkId]: result } } : r)));
      setReports((all) => [saved, ...all.filter((r) => r.id !== saved.id)]);
      // Another report opened while these ran stays the one shown.
      setDraftOnly((current) => (current?.id === saved.id ? saved : current));
    } catch (error) {
      toast.error(reasonOf(error, "The checks couldn't run"));
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
      onChange={(next) => {
        // The live moment plays once: coming back to the report shows it settled.
        setFresh(null);
        void setView(next === "reports" ? "reports" : null);
      }}
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
      filters={view === "reports" ? <StatusFilter reports={reports} settings={settings} show={show} onShow={setShow} /> : undefined}
      intro={view === "new" ? <StepTrail place={place} canGoBack={draft?.step !== "done" && !running} onBack={back} draft={running ? null : draft} settings={settings} /> : undefined}
    >
      {view === "reports" ? (
        <YourReports
          settings={settings}
          show={show}
          reports={reports}
          onNew={() => {
            another(() => void setView(null));
          }}
          onOpen={(id) => {
            openReport(id)
              .then((report) => {
                setDraftOnly(report);
                void setView(null);
              })
              .catch((error: unknown) => toast.error(reasonOf(error, "That report couldn't be opened")));
          }}
        />
      ) : (
      <div className="grid grid-cols-1 gap-8 p-4 sm:p-6 @3xl:grid-cols-[minmax(0,1fr)_13rem] @3xl:gap-10">
        <AutoHeight>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={running ? "checks" : step === "done" ? (draft?.status === "live" ? "live" : "checks") : step}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25, ease: EASE }}
            >
              {running ? (
                <Checks rows={running.checks.map((c) => ({ ...c, result: running.results[c.id] }))} draft={null} />
              ) : step === "agreement" ? (
                <AgreementStep settings={settings} userName={draft?.signedBy?.name ?? userName} onSigned={(signed) => {
                    setFresh({ id: signed.id, step: "doi" });
                    setDraft(signed);
                  }}
                />
              ) : step === "doi" && draft ? (
                <DoiStep draft={draft} fresh={fresh?.id === draft.id && fresh.step === "doi"} onNext={() => back("upload")} />
              ) : step === "upload" && draft ? (
                <UploadStep settings={settings} draft={draft} onStored={setDraft} onRead={setDraft} />
              ) : step === "details" && draft?.metadata ? (
                <DetailsStep initial={draft.metadata} onRun={run} />
              ) : step === "done" && draft?.status === "live" ? (
                <LiveReport
                  settings={settings}
                  draft={draft}
                  fresh={fresh?.id === draft.id && fresh.step === "live"}
                  onChange={(next) => {
                    setReports((all) => all.map((r) => (r.id === next.id ? next : r)));
                    setDraftOnly((current) => (current?.id === next.id ? next : current));
                  }}
                  onAnother={() => {
                    another();
                  }}
                />
              ) : draft ? (
                <Checks
                  rows={(draft.results ?? []).map((r) => ({ id: r.checkId, name: r.name, result: r }))}
                  draft={draft}
                  settings={settings}
                  onActivate={() =>
                    activate(draft.id).then((live) => {
                      setFresh({ id: live.id, step: "live" });
                      setDraft(live);
                    })
                  }
                  onFix={() => back("upload")}
                  onRequestReview={(comment) => requestReview(draft.id, comment).then(setDraft)}
                  onAnother={() => {
                    another();
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
function StepTrail({ place, canGoBack, onBack, draft, settings }: { place: number; canGoBack: boolean; onBack: (step: Step) => void; draft: Submission | null; settings: Settings }) {
  const reduce = useReducedMotion();
  const stage = draft?.step === "done" ? stageOf(draft, settings) : null;
  const failed = stage === "failed" || stage === "declined";
  const waiting = stage === "review";
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
          onClick={() =>
            start(async () => {
              try {
                onSigned(await signAgreement({ name, onBehalfOfAll: all }));
              } catch (error) {
                toast.error(reasonOf(error, "The agreement couldn't be signed"));
              }
            })
          }
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

/**
 * The DOI, and nothing else: its mark, then the DOI itself set large and arriving letter by letter, with one sweep of
 * light across it. Plays only right after signing; opened any other way it is already settled.
 */
function DoiStep({ draft, fresh, onNext }: { draft: Submission; fresh: boolean; onNext: () => void }) {
  const reduce = useReducedMotion();
  const play = fresh && !reduce;
  const rise = (delay: number) => (play ? { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay, duration: 0.4, ease: EASE } } : {});
  // The prefix and what follows it: a narrow screen breaks the DOI between them, never inside one.
  const slash = draft.doi.indexOf("/") + 1;
  const parts = [draft.doi.slice(0, slash), draft.doi.slice(slash)];
  const LETTERS_AT = 0.55;
  const LETTER = 0.03;
  const crossref = draft.registration?.crossref ?? true;
  return (
    <div className="flex flex-col items-center pb-2 pt-3 text-center">
      <div className="relative size-20">
        {play ? (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-[1.75rem] border-2 border-primary"
            initial={{ opacity: 0.6, scale: 1 }}
            animate={{ opacity: 0, scale: 1.6 }}
            transition={{ delay: 0.3, duration: 0.7, ease: "easeOut" }}
          />
        ) : null}
        <motion.span
          className="relative flex size-20 items-center justify-center rounded-[1.75rem] bg-primary text-primary-foreground shadow-[0_10px_30px_-10px_var(--primary)]"
          initial={play ? { scale: 0.5, opacity: 0, rotate: -12 } : false}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 16 }}
        >
          <Hash className="size-9" />
        </motion.span>
      </div>
      <motion.h2 className="mt-5 text-2xl font-semibold tracking-tight" {...rise(0.3)}>
        Your DOI is reserved
      </motion.h2>
      <motion.p className="mt-1.5 max-w-md text-sm text-muted-foreground" {...rise(0.4)}>
        It is your report&apos;s for good, and goes live when the report does.
      </motion.p>
      <motion.div className="relative mt-7 w-full max-w-xl overflow-hidden rounded-2xl border border-primary/20 bg-primary/[0.06] px-5 py-6" {...rise(0.45)}>
        <p className="sr-only">{draft.doi}</p>
        <p aria-hidden className="flex flex-wrap justify-center font-mono text-xl font-semibold tracking-tight sm:text-[1.625rem]">
          {parts.map((part, group) => (
            <span key={group} className="whitespace-nowrap">
              {[...part].map((letter, i) => (
                <motion.span
                  key={i}
                  className="inline-block"
                  initial={play ? { opacity: 0, y: 14, filter: "blur(6px)" } : false}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ delay: LETTERS_AT + (group ? slash + i : i) * LETTER, duration: 0.35, ease: EASE }}
                >
                  {letter}
                </motion.span>
              ))}
            </span>
          ))}
        </p>
        {play ? (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/15"
            initial={{ x: "-130%" }}
            animate={{ x: "430%" }}
            transition={{ delay: LETTERS_AT + draft.doi.length * LETTER + 0.1, duration: 0.9, ease: "easeInOut" }}
          />
        ) : null}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <StatusChip tone="neutral" icon={Hash}>{crossref ? "Reserved with Crossref" : "Reserved with Zenodo"}</StatusChip>
          {crossref && draft.archive === "draft" ? <StatusChip tone="neutral" icon={FileText}>Zenodo draft ready</StatusChip> : null}
        </div>
      </motion.div>
      <motion.div className="mt-6 flex flex-wrap justify-center gap-2" {...rise(LETTERS_AT + draft.doi.length * LETTER)}>
        <Button variant="outline" onClick={() => copy(`https://doi.org/${draft.doi}`, "DOI")}>
          <Copy /> Copy the DOI
        </Button>
        <Button onClick={onNext}>
          <FileUp /> Upload the PDF
        </Button>
      </motion.div>
    </div>
  );
}

function UploadStep({ settings, draft, onStored, onRead }: { settings: Settings; draft: Submission; onStored: (d: Submission) => void; onRead: (d: Submission) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  // Two stretches: the PDF is stored and its cover drawn, then the model reads it. Plain state, not a transition:
  // the cover shows on the side as soon as the first is done.
  const [stage, setStage] = useState<"storing" | "reading" | null>(null);
  const busy = stage !== null;
  const send = async (picked: File | undefined) => {
    if (!picked || busy) return;
    if (!/\.pdf$/i.test(picked.name)) {
      toast.error("Choose a PDF");
      return;
    }
    if (picked.size > 50_000_000) {
      toast.error("The PDF is over 50 MB");
      return;
    }
    setFile(picked);
    setStage("storing");
    const form = new FormData();
    form.set("pdf", picked);
    try {
      const stored = await uploadPdf(form);
      onStored(stored);
      setStage("reading");
      const { draft: read, read: wasRead } = await readPdfDetails(stored.id);
      if (!wasRead) toast.info("The details couldn't be read from this PDF", { description: "Fill them in on the next step." });
      onRead(read);
    } catch (error) {
      toast.error(reasonOf(error, "This PDF couldn't be read. Try saving it again as a PDF."));
      setFile(null);
    } finally {
      setStage(null);
    }
  };
  return (
    <div>
      <StepHead title="Upload the PDF">Put the byline on the cover or the first page before you upload. The checks look for it and for the DOI in it.</StepHead>
      <div className="mb-5 grid gap-4">
        <CopyField label="Byline" value={bylineOf(settings, draft.doi)} what="Byline" />
        <CopyField label="DOI" value={`https://doi.org/${draft.doi}`} mono what="DOI" />
      </div>
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
          void send(e.dataTransfer.files[0]);
        }}
        disabled={busy}
        className={cn(
          "flex h-44 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-center transition-colors",
          over ? "border-primary bg-primary/5" : "border-border hover:border-primary/60 hover:bg-muted/50",
        )}
      >
        {stage === "storing" && file ? (
          <>
            <Spinner className="size-6 text-primary" />
            <span className="max-w-full truncate px-6 text-sm font-medium">Uploading {file.name}</span>
            <span className="text-xs text-muted-foreground">{bytes(file.size)}</span>
          </>
        ) : stage === "reading" ? (
          <>
            <AiIcon working className="size-6 text-primary" />
            <span className="text-sm font-medium">Openscholar is reading your report</span>
            <span className="text-xs text-muted-foreground">About half a minute</span>
          </>
        ) : (
          <>
            <FileUp className="size-6 text-primary" />
            <span className="text-sm font-medium">Drop the PDF here, or choose it</span>
            <span className="text-xs text-muted-foreground">One PDF, up to 50 MB</span>
          </>
        )}
      </button>
      <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void send(e.target.files?.[0])} />
      {draft.pdf && !busy ? (
        <p className="mt-3 flex items-center gap-2 ps-1 text-xs text-muted-foreground">
          <FileText className="size-3.5" />
          Uploading again replaces {draft.pdf.name}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One check: running, then its answer. A check that finds something or doesn't says what; a scored one shows its score
 * against its line, the failing side tinted. What arrives after the row is drawn fades in and opens its place.
 */
export function CheckRow({ name, result }: { name: string; result?: CheckResult }) {
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
function Checks({ rows, draft, settings, onActivate, onFix, onRequestReview, onAnother }: { rows: Array<{ id: string; name: string; result?: CheckResult }>; draft: Submission | null; settings?: Settings; onActivate?: () => Promise<void>; onFix?: () => void; onRequestReview?: (comment: string) => Promise<void>; onAnother?: () => void }) {
  const [asking, setAsking] = useState(false);
  const answered = rows.filter((r) => r.result).length;
  const stage = draft && settings ? stageOf(draft, settings) : null;
  const [activating, start] = useTransition();
  const activateNow = () =>
    start(async () => {
      try {
        await onActivate?.();
      } catch (error) {
        toast.error(reasonOf(error, "It couldn't be activated"));
      }
    });
  const head = !draft ? (
    <StepHead key="running" title="Running the checks" aside={<StatusChip tone="running" icon="tone">{answered} of {rows.length}</StatusChip>}>
      Looking for earlier copies takes a few seconds.
    </StepHead>
  ) : stage === "ready" ? (
    <StepHead key="ready" title="Ready to activate" aside={<StatusChip tone="success" icon={CircleCheck}>{draft.status === "failed" ? "Approved" : "Passed"}</StatusChip>}>
      {draft.status === "failed" ? "A reviewer approved your report. Activate it to make its DOI live and open its page." : "Your report passed its checks. Activate it to make its DOI live and open its page."}
    </StepHead>
  ) : stage === "review" ? (
    <StepHead key="review" title="Waiting for review" aside={<StatusChip tone="running" icon={ReviewQueueIcon}>In review</StatusChip>}>
      Your report passed its checks. You can activate it once a reviewer approves it.
    </StepHead>
  ) : stage === "declined" ? (
    <StepHead key="declined" title={draft.withdrawnAt ? "Withdrawn" : "Not published"} aside={<StatusChip tone="danger" icon={CircleX}>{draft.withdrawnAt ? "Withdrawn" : "Declined"}</StatusChip>}>
      {draft.note ?? (draft.withdrawnAt ? "A reviewer withdrew this report. Its page now says so." : "The reviewer declined this report.")}
    </StepHead>
  ) : (
    <StepHead key="failed" title="Not published yet" aside={<StatusChip tone="danger" icon={CircleX}>A check failed</StatusChip>}>
      {draft.reviewRequest ? "You asked for a human review. You can also fix the PDF and upload it again." : "Fix the PDF and upload it again. Your DOI stays reserved."}
    </StepHead>
  );
  return (
    <div>
      <AutoHeight>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={stage ?? "running"} className="flow-root" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            {head}
          </motion.div>
        </AnimatePresence>
      </AutoHeight>
      {draft?.reviewRequest && stage === "failed" ? (
        <div className="mb-4 flex items-start gap-3 rounded-2xl bg-inset px-4 py-3">
          <ReviewQueueIcon className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Your request</p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{draft.reviewRequest.comment || "Sent without a comment"}</p>
          </div>
        </div>
      ) : null}
      <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
        {rows.map((r) => (
          <CheckRow key={r.id} name={r.name} result={r.result} />
        ))}
      </ul>
      <AutoHeight>
        <AnimatePresence initial={false}>
          {draft ? (
            <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className="mt-6 flex flex-wrap justify-end gap-2">
              {stage === "failed" ? (
                <>
                  {draft.reviewRequest ? null : (
                    <Button variant="outline" onClick={() => setAsking(true)}>
                      <ReviewQueueIcon /> Request a human review
                    </Button>
                  )}
                  <Button onClick={onFix}>
                    <RotateCcw /> Upload a new PDF
                  </Button>
                </>
              ) : (
                <>
                  <Button variant={stage === "declined" ? "default" : "outline"} onClick={onAnother}>
                    <Plus /> Publish another
                  </Button>
                  {stage === "ready" ? (
                    <Button className="relative" disabled={activating} onClick={activateNow}>
                      <Working busy={activating}>
                        <span className="flex items-center gap-2">
                          <BadgeCheck /> Activate
                        </span>
                      </Working>
                    </Button>
                  ) : stage === "review" ? (
                    <TooltipHint label="A reviewer approves it first">
                      <span tabIndex={0}>
                        <Button disabled>
                          <BadgeCheck /> Activate
                        </Button>
                      </span>
                    </TooltipHint>
                  ) : null}
                </>
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </AutoHeight>
      {onRequestReview ? <ReviewRequestDialog open={asking} onClose={() => setAsking(false)} onSend={onRequestReview} /> : null}
    </div>
  );
}

/** The report as it builds up: its cover with the series, title, authors and DOI, and what it stands on. */
/** Asks a person to look at a report its checks failed, with what the author thinks they got wrong. */
function ReviewRequestDialog({ open, onClose, onSend }: { open: boolean; onClose: () => void; onSend: (comment: string) => Promise<void> }) {
  const [comment, setComment] = useState("");
  const [sending, start] = useTransition();
  const send = () =>
    start(async () => {
      try {
        await onSend(comment);
        toast.success("Sent for review");
        onClose();
      } catch (error) {
        toast.error(reasonOf(error, "The request couldn't be sent"));
      }
    });
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !sending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request a human review</DialogTitle>
          <DialogDescription>Our team reads your report and what the checks said. Ask when a check got your report wrong.</DialogDescription>
        </DialogHeader>
        <Field label="What did the checks get wrong?" counter={`${comment.length} / ${REVIEW_TEXT_MAX}`}>
          {(id) => <Textarea id={id} value={comment} onChange={(e) => setComment(e.target.value)} rows={4} maxLength={REVIEW_TEXT_MAX} autoFocus />}
        </Field>
        <DialogFooter>
          <Button variant="outline" disabled={sending} onClick={onClose}>
            Cancel
          </Button>
          <Button className="relative" disabled={sending} onClick={send}>
            <Working busy={sending}>
              <span className="flex items-center gap-2">
                <ReviewQueueIcon /> Send for review
              </span>
            </Working>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const RAYS = [0, 45, 90, 135, 180, 225, 270, 315];

/** The live seal: a ring and a check that draw themselves, a ripple and one burst of rays. Drawn and still when not fresh. */
function Seal({ play }: { play: boolean }) {
  const draw = (delay: number) => (play ? { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { delay, duration: 0.45, ease: EASE } } : {});
  return (
    <div className="relative size-20">
      {play ? (
        <>
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full border-2 border-success"
            initial={{ opacity: 0.6, scale: 1 }}
            animate={{ opacity: 0, scale: 1.7 }}
            transition={{ delay: 0.55, duration: 0.7, ease: "easeOut" }}
          />
          {RAYS.map((angle) => (
            <span key={angle} aria-hidden className="absolute inset-0 flex items-center justify-center" style={{ transform: `rotate(${angle}deg)` }}>
              <motion.span
                className="h-[3px] w-2.5 rounded-full bg-success"
                initial={{ x: 30, opacity: 0 }}
                animate={{ x: [30, 50], opacity: [0, 1, 0] }}
                transition={{ delay: 0.55, duration: 0.6, ease: "easeOut" }}
              />
            </span>
          ))}
        </>
      ) : null}
      <motion.svg
        viewBox="0 0 80 80"
        aria-hidden
        className="relative size-20"
        initial={play ? { scale: 0.6, opacity: 0 } : false}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 18 }}
      >
        <circle cx="40" cy="40" r="34" className="fill-success/10" />
        <motion.circle cx="40" cy="40" r="34" fill="none" strokeWidth="3" strokeLinecap="round" className="stroke-success" style={{ rotate: -90 }} {...draw(0.05)} />
        <motion.path d="M26 41 L36 51 L55 31" fill="none" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-success" {...draw(0.35)} />
      </motion.svg>
    </div>
  );
}

/** The report once it's live: its seal, its DOI and where to go next. Plays its moment only right after Activate. */
function LiveReport({ settings, draft, fresh, onChange, onAnother }: { settings: Settings; draft: Submission; fresh: boolean; onChange: (report: Submission) => void; onAnother: () => void }) {
  const reduce = useReducedMotion();
  // MOCK: a timer asks for the report again while Zenodo or Crossref is still working, so each chip settles in view.
  // The real build is told by Convex and needs no timer.
  const settling = stepsOf(draft).some((step) => step.state === "working" || step.state === "waiting");
  useEffect(() => {
    if (!settling) return;
    const timer = setInterval(() => void readReport(draft.id).then((report) => report && onChange(report)), 3000);
    return () => clearInterval(timer);
  }, [settling, draft.id, onChange]);
  const play = fresh && !reduce;
  // Each part rises in after the seal has drawn, in reading order.
  const rise = (delay: number) => (play ? { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay, duration: 0.4, ease: EASE } } : {});
  const url = `https://doi.org/${draft.doi}`;
  const passed = draft.results?.filter((r) => r.pass).length ?? 0;
  return (
    <div>
      <div className="flex flex-col items-center pb-7 pt-3 text-center">
        <Seal play={play} />
        <motion.h2 className="mt-5 text-2xl font-semibold tracking-tight" {...rise(0.45)}>
          Your report is live
        </motion.h2>
        <motion.p className="mt-1.5 max-w-md text-sm text-muted-foreground" {...rise(0.55)}>
          Its page is open, and communities can add it by its DOI.
        </motion.p>
      </div>
      <motion.div className="rounded-2xl border border-border-subtle bg-inset/60 p-4" {...rise(0.7)}>
        <div className="flex min-w-0 items-center gap-3">
          <Hash className="size-4 shrink-0 text-primary" />
          <a href={url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-mono text-[0.9375rem] font-medium underline-offset-4 hover:underline">
            doi.org/{draft.doi}
          </a>
          {/* The app's own Cite menu: every style, copy, RIS and BibTeX. */}
          {draft.metadata ? <CitationControl paper={reportPaper(draft, draft.metadata, settings.series)} /> : null}
          <TooltipHint label="Copy the DOI">
            <Button variant="ghost" size="icon-sm" aria-label="Copy the DOI" className="text-muted-foreground" onClick={() => copy(url, "DOI")}>
              <Copy />
            </Button>
          </TooltipHint>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <RegistrationChips report={draft} />
          <StatusChip tone="success" icon={ShieldCheck}>
            {passed} of {draft.results?.length ?? 0} checks passed
          </StatusChip>
        </div>
      </motion.div>
      <motion.div className="mt-6 flex flex-wrap justify-end gap-2" {...rise(0.8)}>
        <Button variant="outline" onClick={onAnother}>
          <Plus /> Publish another
        </Button>
        {/* The app's own Add to community list, opened from a named button. */}
        <CommunityControl
          paper={{ id: draft.id, title: draft.metadata?.title ?? "", doi: draft.doi }}
          trigger={
            <Button variant="outline">
              <EvidenceLibrariesIcon /> Add to community
            </Button>
          }
          mock={{
            sent: draft.communities ?? [],
            send: async (community, publish) => {
              const { outcome, report } = await addToCommunity(draft.id, community, publish);
              onChange(report);
              return outcome;
            },
          }}
        />
        <Button asChild>
          <Link href={`/papers/${draft.id}`}>
            Open its page <ArrowUpRight />
          </Link>
        </Button>
      </motion.div>
    </div>
  );
}

/**
 * The report as it will stand: the cover its page wears, which opens the PDF once there is one, with its DOI and
 * what's on its record under it.
 */
function ReportCover({ settings, draft }: { settings: Settings; draft: Submission | null }) {
  const m = draft?.metadata;
  const live = draft?.step === "done" && draft.status === "live";
  const facts: Array<{ id: string; icon: typeof Hash; label: string }> = [
    ...(draft?.pdf ? [{ id: "pdf", icon: FileText, label: `${draft.pdf.pages} ${draft.pdf.pages === 1 ? "page" : "pages"}` }] : []),
    ...(draft?.signedAt ? [{ id: "agreement", icon: PenLine, label: `Agreement v${draft.agreementVersion}` }] : []),
    ...(draft?.checksVersion ? [{ id: "checks", icon: ShieldCheck, label: `Checks v${draft.checksVersion}` }] : []),
  ];
  return (
    // Beside the steps on a wide card; under them on a narrow one, the cover small with its caption next to it.
    <aside className="flex items-start gap-4 @3xl:sticky @3xl:top-24 @3xl:block @3xl:self-start">
      <PaperCover
        className="w-28 shrink-0 @3xl:w-full"
        {...REPORT_COVER}
        title={m?.title || "Your title"}
        authors={m?.authors.map((a) => a.name).filter(Boolean) ?? []}
        source={settings.series.name}
        year={m?.date ? Number(m.date.slice(0, 4)) : null}
        type="report"
        // The picture of the PDF's first page takes the title page's place once it's made.
        image={draft ? coverUrlOf(draft) : null}
        href={draft?.pdf ? `/publish/files/${draft.id}` : null}
        pdf={!!draft?.pdf}
      />
      <div className="min-w-0 flex-1 @3xl:mt-4">
        <TooltipHint label={draft ? `doi.org/${draft.doi}` : ""} onlyWhenClipped>
          <p className={cn("truncate font-mono text-xs", draft ? "text-foreground" : "text-muted-foreground")}>{draft ? `doi.org/${draft.doi}` : "No DOI yet"}</p>
        </TooltipHint>
        <p className="mt-0.5 text-xs text-muted-foreground">ISSN {settings.series.issn || "pending"}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {live ? (
            <StatusChip tone="success" icon={BadgeCheck} className="fade-enter">
              Live
            </StatusChip>
          ) : null}
          {facts.map((fact) => (
            <StatusChip key={fact.id} tone="neutral" icon={fact.icon} className="fade-enter">
              {fact.label}
            </StatusChip>
          ))}
        </div>
      </div>
    </aside>
  );
}
