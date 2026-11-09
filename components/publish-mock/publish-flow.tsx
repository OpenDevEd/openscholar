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
import { CountryFlag } from "@/components/ui/country-flag";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  Trash2,
  TriangleAlert,
  BadgeCheck,
  Hash,
} from "@/components/icons";
import { goTo, runChecks, signAgreement, startOver, uploadPdf } from "@/app/actions/publish-mock";
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

export function PublishFlow({ settings, initial, userName }: { settings: Settings; initial: Submission | null; userName: string }) {
  const [draft, setDraft] = useState(initial);
  // Results that came back in this visit reveal one by one; ones read with the page are just there.
  const [fresh, setFresh] = useState(false);
  const place = placeOf(draft);
  const step: Step = draft?.step ?? "agreement";
  const back = (to: Step) => {
    void goTo(to).then(setDraft);
  };

  return (
    <LibraryPageShell icon={PublishIcon} title="Publish" intro={<StepTrail place={place} canGoBack={draft?.step !== "done"} onBack={back} draft={draft} />}>
      <div className="grid gap-8 p-4 sm:p-6 @3xl:grid-cols-[minmax(0,1fr)_17rem] @3xl:gap-10">
        <AutoHeight>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step === "done" ? `done:${draft?.status}` : step}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25, ease: EASE }}
            >
              {step === "agreement" ? (
                <AgreementStep settings={settings} userName={draft?.signedBy?.name ?? userName} onSigned={setDraft} />
              ) : step === "doi" && draft ? (
                <DoiStep settings={settings} draft={draft} onNext={() => back("upload")} />
              ) : step === "upload" && draft ? (
                <UploadStep settings={settings} draft={draft} onRead={setDraft} />
              ) : step === "details" && draft?.metadata ? (
                <DetailsStep
                  initial={draft.metadata}
                  onRun={async (metadata) => {
                    const next = await runChecks(metadata);
                    setFresh(true);
                    setDraft(next);
                  }}
                />
              ) : draft ? (
                <Outcome
                  draft={draft}
                  fresh={fresh}
                  onFix={() => back("upload")}
                  onAnother={() => {
                    void startOver().then(() => {
                      setFresh(false);
                      setDraft(null);
                    });
                  }}
                />
              ) : null}
            </motion.div>
          </AnimatePresence>
        </AutoHeight>
        <ReportCover settings={settings} draft={draft} />
      </div>
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
              <span className={cn("truncate text-xs font-medium", done || current ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
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

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="ps-1 text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function DetailsStep({ initial, onRun }: { initial: Metadata; onRun: (m: Metadata) => Promise<void> }) {
  const [m, setM] = useState(initial);
  const [keyword, setKeyword] = useState("");
  const [busy, start] = useTransition();
  const set = <K extends keyof Metadata>(key: K, value: Metadata[K]) => setM((was) => ({ ...was, [key]: value }));
  const setAuthor = (i: number, patch: Partial<Metadata["authors"][number]>) => set("authors", m.authors.map((a, at) => (at === i ? { ...a, ...patch } : a)));
  const addKeyword = () => {
    const word = keyword.trim();
    if (word && !m.keywords.includes(word)) set("keywords", [...m.keywords, word]);
    setKeyword("");
  };
  return (
    <div>
      <StepHead title="Check the details" aside={<AiIcon className="size-4 text-primary" />}>
        Filled in from your PDF. Correct anything that&apos;s wrong: this is what Crossref and the report&apos;s page show.
      </StepHead>
      <div className="grid gap-5">
        <Field label="Title">
          <Textarea value={m.title} onChange={(e) => set("title", e.target.value)} rows={2} className="resize-none text-base font-medium" />
        </Field>
        <div className="space-y-1.5">
          <span className="ps-1 text-xs font-medium text-muted-foreground">Authors</span>
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
            {m.authors.map((a, i) => (
              <li key={i} className="grid gap-2 p-3 @xl:grid-cols-[1.2fr_1fr_1.3fr_4.5rem_auto] @xl:items-center">
                <Input aria-label="Name" placeholder="Name" value={a.name} onChange={(e) => setAuthor(i, { name: e.target.value })} />
                <Input aria-label="ORCID iD" placeholder="ORCID iD" value={a.orcid} onChange={(e) => setAuthor(i, { orcid: e.target.value })} className="font-mono text-xs" />
                <Input aria-label="Affiliation" placeholder="Affiliation" value={a.affiliation} onChange={(e) => setAuthor(i, { affiliation: e.target.value })} />
                <div className="relative">
                  {a.country.length === 2 ? <CountryFlag countryCode={a.country} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2" /> : null}
                  <Input aria-label="Country code" placeholder="KE" maxLength={2} value={a.country} onChange={(e) => setAuthor(i, { country: e.target.value.toUpperCase() })} className={cn(a.country.length === 2 && "ps-8")} />
                </div>
                <TooltipHint label="Remove author">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${a.name || "author"}`} disabled={m.authors.length === 1} className="justify-self-end text-muted-foreground hover:text-destructive" onClick={() => set("authors", m.authors.filter((_, at) => at !== i))}>
                    <Trash2 />
                  </Button>
                </TooltipHint>
              </li>
            ))}
          </ul>
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => set("authors", [...m.authors, { name: "", orcid: "", affiliation: "", country: "" }])}>
            <Plus /> Add an author
          </Button>
        </div>
        <Field label="Abstract">
          <Textarea value={m.abstract} onChange={(e) => set("abstract", e.target.value)} rows={7} className="text-sm/6" />
        </Field>
        <div className="space-y-1.5">
          <span className="ps-1 text-xs font-medium text-muted-foreground">Keywords</span>
          <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border border-input bg-field px-2 py-1.5">
            {m.keywords.map((k) => (
              <span key={k} className="inline-flex h-6 items-center gap-1 rounded-md bg-inset ps-2 pe-1 text-xs">
                {k}
                <button type="button" aria-label={`Remove ${k}`} className="rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => set("keywords", m.keywords.filter((x) => x !== k))}>
                  <CircleX className="size-3" />
                </button>
              </span>
            ))}
            <input
              aria-label="Add a keyword"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addKeyword();
                }
              }}
              onBlur={addKeyword}
              placeholder={m.keywords.length ? "" : "Add keywords"}
              className="h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Language">
            <Input value={m.language} onChange={(e) => set("language", e.target.value)} />
          </Field>
          <Field label="Date published">
            <Input type="date" value={m.date} onChange={(e) => set("date", e.target.value)} />
          </Field>
          <div className="space-y-1.5">
            <span className="ps-1 text-xs font-medium text-muted-foreground">Licence</span>
            <div className="flex h-9 items-center rounded-md border border-border-subtle bg-inset px-3 text-sm">{m.licence}</div>
          </div>
        </div>
      </div>
      <div className="mt-6 flex justify-end">
        <Button className="relative" disabled={busy || !m.title.trim() || !m.authors.some((a) => a.name.trim())} onClick={() => start(() => onRun(m))}>
          <Working busy={busy}>
            <span className="flex items-center gap-2">
              <ShieldCheck /> Run the checks
            </span>
          </Working>
        </Button>
      </div>
    </div>
  );
}

/** One check's answer: its score against what it needs, as a bar with the line it has to clear. */
export function CheckRow({ result, delay = 0 }: { result: CheckResult; delay?: number }) {
  const reduce = useReducedMotion();
  const wait = reduce ? 0 : delay;
  const tone = result.pass ? "success" : result.blocking ? "danger" : "warning";
  const pct = Math.round(result.score * 100);
  const need = Math.round(result.threshold * 100);
  return (
    <li className="px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span className="relative flex size-5 shrink-0 items-center justify-center">
          <motion.span className="absolute" initial={{ opacity: wait ? 1 : 0 }} animate={{ opacity: 0 }} transition={{ delay: wait, duration: 0.15 }}>
            <Spinner className="size-4 text-primary" />
          </motion.span>
          <motion.span className="absolute" initial={{ opacity: wait ? 0 : 1, scale: wait ? 0.6 : 1 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: wait, type: "spring", stiffness: 500, damping: 26 }}>
            {result.pass ? <CircleCheck className="size-5 ink-success" /> : result.blocking ? <CircleX className="size-5 text-destructive" /> : <TriangleAlert className="size-5 ink-warning" />}
          </motion.span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{result.name}</span>
        </span>
        <span className="hidden text-xs text-muted-foreground sm:inline">{result.engine === "llm" ? "LLM" : "Decision model"}</span>
        <motion.span initial={{ opacity: wait ? 0 : 1 }} animate={{ opacity: 1 }} transition={{ delay: wait, duration: 0.2 }}>
          <StatusChip tone={tone}>{result.pass ? "Passed" : result.blocking ? "Failed" : "Flagged"}</StatusChip>
        </motion.span>
      </div>
      <div className="ms-8 mt-2.5 flex items-center gap-3">
        <div className="relative h-1.5 flex-1 rounded-full bg-inset">
          <motion.div
            className={cn("absolute inset-y-0 start-0 rounded-full", result.pass ? "bg-success" : result.blocking ? "bg-destructive" : "bg-warning")}
            initial={{ width: wait ? "0%" : `${Math.max(pct, 2)}%` }}
            animate={{ width: `${Math.max(pct, 2)}%` }}
            transition={{ delay: wait, duration: 0.5, ease: EASE }}
          />
          {/* The line the score has to clear: at least it, or for similarity and the like, at most it. */}
          <span aria-hidden className="absolute -inset-y-1 w-0.5 rounded-full bg-foreground/50" style={{ insetInlineStart: `${need}%` }} />
        </div>
        <span className="w-24 shrink-0 text-end text-xs tabular-nums text-muted-foreground">
          {pct}% <span className="text-muted-foreground/70">{result.direction === "atMost" ? "max" : "min"} {need}%</span>
        </span>
      </div>
      {result.reasoning ? (
        <motion.p initial={{ opacity: wait ? 0 : 1 }} animate={{ opacity: 1 }} transition={{ delay: wait + 0.1, duration: 0.25 }} className="ms-8 mt-2 text-xs/5 text-muted-foreground">
          {result.reasoning}
        </motion.p>
      ) : null}
    </li>
  );
}

function Outcome({ draft, fresh, onFix, onAnother }: { draft: Submission; fresh: boolean; onFix: () => void; onAnother: () => void }) {
  const results = draft.results ?? [];
  const STAGGER = 0.55;
  const done = fresh ? results.length * STAGGER + 0.2 : 0;
  const head =
    draft.status === "live" ? (
      <StepHead title="Published" aside={<StatusChip tone="success" icon={BadgeCheck}>DOI active</StatusChip>}>
        Your report is live. Communities can add it now; the DOI resolves once Crossref has registered it.
      </StepHead>
    ) : draft.status === "review" ? (
      <StepHead title="Waiting for review" aside={<StatusChip tone="running" icon={ReviewQueueIcon}>In review</StatusChip>}>
        Your report passed its checks. A reviewer approves it before the DOI goes live.
      </StepHead>
    ) : draft.status === "declined" ? (
      <StepHead title="Not published" aside={<StatusChip tone="danger" icon={CircleX}>Declined</StatusChip>}>
        {draft.note ?? "The reviewer declined this report."}
      </StepHead>
    ) : (
      <StepHead title="Not published yet" aside={<StatusChip tone="danger" icon={CircleX}>A check failed</StatusChip>}>
        Fix the PDF and upload it again. Your DOI stays reserved.
      </StepHead>
    );
  return (
    <div>
      {/* While fresh results reveal, a running head holds the outcome's place; the outcome fades in over it once the last check is in. */}
      <div className="grid [&>*]:col-start-1 [&>*]:row-start-1">
        {fresh ? (
          <motion.div initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ delay: done, duration: 0.2 }} aria-hidden>
            <StepHead title="Running the checks" aside={<StatusChip tone="running" icon="tone">{results.length} checks</StatusChip>}>
              Each check reads your PDF and its details.
            </StepHead>
          </motion.div>
        ) : null}
        <motion.div initial={{ opacity: fresh ? 0 : 1 }} animate={{ opacity: 1 }} transition={{ delay: done, duration: 0.3 }}>
          {head}
        </motion.div>
      </div>
      <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
        {results.map((r, i) => (
          <CheckRow key={r.checkId} result={r} delay={fresh ? 0.3 + i * STAGGER : 0} />
        ))}
      </ul>
      <motion.div initial={{ opacity: fresh ? 0 : 1 }} animate={{ opacity: 1 }} transition={{ delay: done, duration: 0.3 }} className="mt-6 flex flex-wrap justify-end gap-2">
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
