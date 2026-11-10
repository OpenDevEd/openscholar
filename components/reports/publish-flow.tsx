"use client";

// Publishing a work in Openscholar Reports (plans/publish-reports). Sign the agreement, which reserves the DOI;
// upload the PDF with the byline on it; correct the details read from it; the checks run; activate it, or wait for
// review. Everything shown is read live from Convex (convex/reports/flow.ts), so a reload, another tab, a reviewer's
// word or a changed setting all land on the page by themselves.

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { parseAsBoolean, parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { toast } from "sonner";
import { useAuth, useClerk, useUser } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Link from "@/components/workspace-link";
import { LibraryPageShell, PageFrameLoading } from "@/components/evidence-libraries/library-page-shell";
import { BAR_ACTION, BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { Field } from "@/components/evidence-libraries/configuration/section-card";
import { StatusChip } from "@/components/evidence-libraries/configuration/status-chip";
import { ListEmpty } from "@/components/evidence-libraries/list-controls";
import { MarkdownContent } from "@/components/markdown-content";
import { PaperCover } from "@/components/papers/paper-cover";
import { DetailsStep } from "@/components/reports/details-step";
import { RegistrationChips } from "@/components/reports/registration";
import { SHOWS, STATUS, StatusFilter, YourReports, stageShown } from "@/components/reports/your-reports";
import { Working } from "@/components/settings/parts";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EASE } from "@/components/ui/opening";
import { EDGE_FADE } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { TooltipHint } from "@/components/ui/tooltip";
import { AiIcon, ArrowUpRight, BadgeCheck, CircleCheck, CircleX, Copy, FileText, FileUp, Hash, PenLine, Plus, PublishIcon, ReviewQueueIcon, RotateCcw, ShieldCheck, TriangleAlert } from "@/components/icons";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { CONTACT_EMAIL } from "@/lib/billing/contact";
import { REPORT_COVER } from "@/lib/papers/cover";
import { fillAgreement } from "@/lib/reports/agreement";
import { drawCover } from "@/lib/reports/draw-cover";
import { REVIEW_TEXT_MAX, SIGNER_NAME_MAX, stageOf, type CheckResult, type Metadata } from "@/lib/reports/report";
import { limitWords } from "@/lib/reports/settings";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { stepBack } from "@/lib/url-state/step-back";
import { useWorkspaceSlug } from "@/lib/workspaces/href";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";
import { cn } from "@/lib/utils";

type Basics = FunctionReturnType<typeof api.reports.settings.forAuthors>;
type Found = NonNullable<FunctionReturnType<typeof api.reports.flow.get>>;
type Report = Extract<Found, { report: unknown }>["report"];
type Starts = FunctionReturnType<typeof api.reports.flow.starts>;

/** The largest PDF a report takes, as its upload says (convex/reports/flow.ts `REPORT_PDF_MAX_MB`). */
const PDF_MAX_MB = 50;
/** How long a reading or a run may go on before the page offers the step again: either can die with its server. */
const STUCK_MS = 4 * 60 * 1000;

const STEPS: Array<{ id: "agreement" | "doi" | "upload" | "details" | "checks" | "live"; label: string; icon: typeof PenLine }> = [
  { id: "agreement", label: "Agreement", icon: PenLine },
  { id: "doi", label: "DOI", icon: Hash },
  { id: "upload", label: "PDF", icon: FileUp },
  { id: "details", label: "Details", icon: FileText },
  { id: "checks", label: "Checks", icon: ShieldCheck },
  { id: "live", label: "Live", icon: BadgeCheck },
];
type BackStep = "doi" | "upload" | "details";

/** Where the trail stands: the step being done, or past the checks, the outcome. */
function placeOf(report: Report | null) {
  if (!report) return 0;
  if (report.step === "done") return report.status === "live" ? 5 : 4;
  return STEPS.findIndex((s) => s.id === report.step);
}

const bytes = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.round(n / 1000)} kB`);
/** A handler for a change that was refused or never arrived: its reason in a toast. */
const said = (otherwise: string) => (error: unknown) => void toast.error(getErrorMessage(error, otherwise));

function copy(text: string, what: string) {
  void navigator.clipboard.writeText(text).then(() => toast.success(`${what} copied`));
}

/** Where the Publish page is, kept in its address so a link, a reload and the back button all land on it. */
const PLACE = {
  view: parseAsStringLiteral(["new", "reports"] as const).withDefault("new"),
  /** The report shown, by its key; "new" for one not started yet. */
  report: parseAsString,
  /** A live report's details open to be corrected. */
  correct: parseAsBoolean.withDefault(false),
  show: parseAsStringLiteral(SHOWS).withDefault("all"),
  page: parseAsInteger.withDefault(1),
};

export function PublishFlow() {
  const { isLoaded, isSignedIn } = useAuth();
  const workspaceId = useWorkspace();
  // In an organisation's workspace every member sees its reports, so each row says who signed.
  const shared = useWorkspaceSlug() !== undefined;
  const [{ view, report: asked, show, page }, setPlace] = useQueryStates(PLACE);
  // Moving to another report, view or page of the list is a step forward in the browser's history, so Back returns
  // to where the person was. It is another screen, so it opens at its top, as History's and the library's pages do;
  // the browser puts the place back on the way back.
  const go = (next: Parameters<typeof setPlace>[0]) => void setPlace(next, { history: "push", scroll: true });

  // Asked once for the minute the page opened in, so the count isn't read again on every draw; a report started
  // here changes the count by itself.
  const [now] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);
  const basics = useQuery(api.reports.settings.forAuthors, {});
  const { data: counts } = useProtectedQuery(api.reports.flow.counts, inWorkspace(workspaceId, {}));
  const { data: starts } = useProtectedQuery(api.reports.flow.starts, inWorkspace(workspaceId, { now }));
  // The report shown is the one the address names; with none named, the only one under way.
  const listed = view === "reports" || (asked === null && (counts?.underWay ?? 0) > 1);
  const shownKey = listed ? null : (asked ?? counts?.only ?? "new");
  const { data: found } = useProtectedQuery(api.reports.flow.get, shownKey && shownKey !== "new" ? inWorkspace(workspaceId, { key: shownKey }) : "skip");
  const { data: list } = useProtectedQuery(api.reports.flow.page, listed ? inWorkspace(workspaceId, { page, ...(stageShown(show) && { show: stageShown(show) }) }) : "skip");
  // A list page keeps showing while the next one is read, so paging never empties the card.
  const [lastList, setLastList] = useState(list);
  if (list && list !== lastList) setLastList(list);

  const discard = useMutation(api.reports.flow.discard);
  // What just happened here and now, signing or activating: only then does its step play its moment. A step opened
  // any other way is already settled.
  const [fresh, setFresh] = useState<{ key: string; step: "doi" | "live" } | null>(null);
  if (listed && fresh) setFresh(null);

  const signedOut = isLoaded && !isSignedIn;
  const ready = basics !== undefined && isLoaded && (signedOut || (counts !== undefined && starts !== undefined && workspaceId !== undefined && (listed ? (list ?? lastList) !== undefined : shownKey === "new" || found !== undefined)));
  if (!ready || !basics) return <PageFrameLoading label="Publish" />;

  const report = found && "report" in found ? found.report : null;
  const elsewhere = found && "elsewhere" in found ? found.elsewhere : null;
  const missing = !listed && shownKey !== "new" && !report;
  const another = () => {
    setFresh(null);
    go({ view: null, report: "new", correct: null });
  };
  const hasReports = (counts?.all ?? 0) > 0;
  // Publishing switched off stops new reports. One already started keeps its address, and the list stays.
  const closed = !basics.open && !listed && !report && !missing;

  return (
    <LibraryPageShell
      icon={PublishIcon}
      title={listed || missing || closed ? "Publish" : report?.metadata?.title || report?.title || "New report"}
      titleAside={report ? <span className="font-mono text-xs text-muted-foreground">{report.key}</span> : undefined}
      // Back to the list, once there is one to go back to.
      backHref={!listed && hasReports ? "/publish?view=reports" : undefined}
      backLabel="Your reports"
      // Back to the list it was opened from is the browser's own step back, so Back afterwards doesn't reopen the report.
      onBackClick={(event) => {
        if (stepBack((behind) => behind.pathname === new URL(event.currentTarget.href).pathname && behind.searchParams.get("view") === "reports")) event.preventDefault();
      }}
      // Another filter is another list: a step in history, opened at its first page.
      filters={listed && counts ? <StatusFilter counts={counts} show={show} onShow={(next) => go({ view: "reports", show: next, page: null })} /> : undefined}
      // Several reports can be under way at once: a new one starts here, and each counts against the day's limit.
      actions={
        listed && basics.open ? (
          <Button size="sm" className={BAR_ACTION} onClick={another}>
            <Plus aria-hidden />
            <span className={BAR_LABEL}>New report</span>
          </Button>
        ) : undefined
      }
      intro={!listed && !missing && !closed ? <StepTrail report={report} humanReview={basics.humanReview} /> : undefined}
    >
      {listed ? (
        <div className={cn("transition-opacity", !list && "opacity-60")} aria-busy={!list || undefined}>
          <YourReports
            list={(list ?? lastList)!}
            humanReview={basics.humanReview}
            series={basics.series.name}
            shared={shared}
            show={show}
            onPage={(next) => go({ view: "reports", page: next })}
            onOpen={(key) => go({ view: null, report: key, correct: null })}
            onCorrect={(key) => go({ view: null, report: key, correct: null })}
            onDiscard={(key) => discard({ workspaceId: workspaceId!, key }).then(() => void toast.success("Report discarded"), said("The report couldn't be discarded"))}
            onNew={another}
          />
        </div>
      ) : closed ? (
        <ListEmpty
          icon={PublishIcon}
          description={hasReports ? "No new report can be started for now. The reports you already have stay as they are." : "No new report can be started for now. Come back later."}
          action={
            hasReports ? (
              <Button size="sm" variant="outline" onClick={() => go({ view: "reports", report: null, correct: null })}>
                <FileText /> Your reports
              </Button>
            ) : undefined
          }
        >
          Publishing is off for now
        </ListEmpty>
      ) : missing ? (
        <ListEmpty
          icon={FileText}
          description={elsewhere ? `It belongs to ${elsewhere.name}. Open it there to work on it.` : "It isn't one of this workspace's reports, or it was discarded. If an email sent you here, sign in with the account it was published from."}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {elsewhere ? (
                <Button size="sm" asChild>
                  {/* A plain address: the report's own workspace, whichever this page is in. */}
                  <a href={`${elsewhere.slug ? `/o/${elsewhere.slug}` : ""}/publish?report=${shownKey}`}>
                    Open it in {elsewhere.name} <ArrowUpRight />
                  </a>
                </Button>
              ) : null}
              {hasReports ? (
                <Button size="sm" variant="outline" onClick={() => go({ view: "reports", report: null, correct: null })}>
                  <FileText /> Your reports
                </Button>
              ) : null}
              {elsewhere || !basics.open ? null : (
                <Button size="sm" onClick={another}>
                  <Plus /> New report
                </Button>
              )}
            </div>
          }
        >
          {elsewhere ? "This report is in another workspace" : "This report isn't here"}
        </ListEmpty>
      ) : (
        <div className="grid grid-cols-1 gap-8 p-4 sm:p-6 @3xl:grid-cols-[minmax(0,1fr)_13rem] @3xl:gap-10">
          <Screens key={report?.key ?? "new"} basics={basics} report={report} starts={starts ?? null} shared={shared} workspaceId={workspaceId} fresh={fresh} setFresh={setFresh} onSigned={(key) => void setPlace({ report: key })} onAnother={another} />
          <ReportCover basics={basics} report={report} />
        </div>
      )}
    </LibraryPageShell>
  );
}

/** The one report's screen, chosen from where the report stands. */
function Screens({ basics, report, starts, shared, workspaceId, fresh, setFresh, onSigned, onAnother }: { basics: Basics; report: Report | null; starts: Starts | null; shared: boolean; workspaceId: Id<"workspaces"> | undefined; fresh: { key: string; step: "doi" | "live" } | null; setFresh: (fresh: { key: string; step: "doi" | "live" } | null) => void; onSigned: (key: string) => void; onAnother: () => void }) {
  const goTo = useMutation(api.reports.flow.goTo);
  const saveDetails = useMutation(api.reports.flow.saveDetails);
  const requestReview = useMutation(api.reports.flow.requestReview);
  const activate = useMutation(api.reports.flow.activate);
  const runChecks = useAction(api.reports.checks.run);
  // The checks were asked for here and the report hasn't said so yet: the page shows them running at once.
  const [starting, setStarting] = useState(false);
  const here = { workspaceId: workspaceId! };
  const back = (step: BackStep) => {
    setFresh(null);
    if (report) void goTo({ ...here, key: report.key, step }).catch(said("That step couldn't be opened"));
  };
  // A run that has gone on too long is given up on here, so its author can run the checks again.
  const running = !!report?.run && Date.now() - report.run.at < STUCK_MS;
  const busy = report?.step === "details" && (running || starting);
  const live = report?.step === "done" && report.status === "live";
  const screen = !report ? "agreement" : !report.mine ? "watching" : busy ? "running" : report.step !== "done" ? report.step : live ? "live" : "checks";
  return (
    <AutoHeight>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={screen} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25, ease: EASE }}>
          {!report ? (
            <AgreementStep
              basics={basics}
              shared={shared}
              starts={starts}
              workspaceId={workspaceId}
              onSigned={(key) => {
                setFresh({ key, step: "doi" });
                // In place of the unsigned page, so going back never lands on an agreement that starts a second report.
                onSigned(key);
              }}
            />
          ) : !report.mine ? (
            <ReportSeen report={report} humanReview={basics.humanReview} />
          ) : busy ? (
            <Checks rows={basics.checks.map((check) => ({ id: check.id, name: check.name, result: report.run?.results.find((result) => result.checkId === check.id) }))} report={null} humanReview={basics.humanReview} />
          ) : report.step === "doi" ? (
            <DoiStep report={report} fresh={fresh?.key === report.key && fresh.step === "doi"} onNext={() => back("upload")} />
          ) : report.step === "upload" ? (
            <UploadStep report={report} workspaceId={workspaceId!} />
          ) : report.step === "details" && report.metadata ? (
            <>
              <PdfNotice trouble={report.pdf?.trouble} />
              <DetailsStep
                // The details of another PDF are another form.
                key={report.pdf?.at}
                initial={report.metadata}
                onRun={async (metadata: Metadata) => {
                  setStarting(true);
                  try {
                    await runChecks({ ...here, key: report.key, metadata });
                  } catch (error) {
                    said("The checks couldn't run")(error);
                  } finally {
                    setStarting(false);
                  }
                }}
                onSave={(metadata) => void saveDetails({ ...here, key: report.key, metadata }).catch(said("Your changes couldn't be saved"))}
              />
            </>
          ) : live ? (
            <LiveReport report={report} fresh={fresh?.key === report.key && fresh.step === "live"} onAnother={onAnother} />
          ) : (
            <Checks
              rows={(report.results ?? []).map((result) => ({ id: result.checkId, name: result.name, result }))}
              report={report}
              humanReview={basics.humanReview}
              onActivate={() => activate({ ...here, key: report.key }).then(() => setFresh({ key: report.key, step: "live" }))}
              onFix={() => back("upload")}
              onDetails={() => back("details")}
              onRequestReview={(comment) => requestReview({ ...here, key: report.key, comment }).then(() => undefined)}
              onAnother={basics.open ? onAnother : undefined}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </AutoHeight>
  );
}

/** The six steps as one track that fills as the report moves on. */
function StepTrail({ report, humanReview }: { report: Report | null; humanReview: boolean }) {
  const reduce = useReducedMotion();
  const running = report?.step === "details" && !!report.run;
  const place = running ? 4 : placeOf(report);
  const stage = report?.step === "done" ? stageOf(report, humanReview) : null;
  const failed = stage === "failed" || stage === "declined";
  const waiting = stage === "review";
  return (
    <div className="px-4 pb-4 pt-5 sm:px-6">
      <ol className="grid grid-cols-6 gap-1">
        {STEPS.map((s, i) => {
          const done = i < place || (i === place && place === 5);
          const current = i === place && place !== 5;
          const Icon = done ? CircleCheck : current && failed ? CircleX : current && waiting ? ReviewQueueIcon : s.icon;
          return (
            <li key={s.id} className="min-w-0">
              <div aria-current={current ? "step" : undefined} className="flex min-w-0 items-center gap-1.5 py-1">
                <Icon className={cn("size-4 shrink-0", done ? "text-primary" : current ? (failed ? "text-destructive" : "text-primary") : "text-muted-foreground/60")} />
                {/* On a phone only the current step keeps its name; the others are their icons. */}
                <span className={cn("truncate text-xs font-medium", done || current ? "text-foreground" : "text-muted-foreground", !current && "max-sm:sr-only")}>{s.label}</span>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-inset">
        <motion.div className={cn("h-full rounded-full", failed ? "bg-destructive" : "bg-primary")} initial={false} animate={{ width: `${((place + (place === 5 ? 1 : 0.5)) / STEPS.length) * 100}%` }} transition={reduce ? { duration: 0 } : { duration: 0.5, ease: EASE }} />
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

function AgreementStep({ basics, shared, starts, workspaceId, onSigned }: { basics: Basics; shared: boolean; /** The workspace's day; null signed out. */ starts: Starts | null; workspaceId: Id<"workspaces"> | undefined; onSigned: (key: string) => void }) {
  const { openSignIn } = useClerk();
  const { user } = useUser();
  const sign = useMutation(api.reports.flow.sign);
  // Today, kept for as long as the step is open, so the text doesn't change under the reader at midnight.
  const [today] = useState(() => new Date());
  // The name they are known by, until they type another.
  const [typed, setTyped] = useState<string | null>(null);
  const name = typed ?? user?.fullName ?? "";
  const [all, setAll] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, start] = useTransition();
  const { agreement } = basics;
  // The workspace has used up its day, or has none: no new report can start, and the page says which.
  const blocked = starts && starts.left < 1 ? limitWords(starts.perDay, starts.kind) : null;
  // An organisation's workspace is opened by Openscholar, on request: the page says who to ask.
  const unopened = starts?.kind === "organization" && starts.perDay === 0;
  return (
    <div>
      <StepHead title={`Publishing agreement with ${basics.series.name}`} aside={<StatusChip tone="neutral">Version {agreement.version}</StatusChip>}>
        You keep the copyright and publish under CC BY 4.0. Signing reserves your DOI.{shared ? " The report is this workspace's: its members can see it, and you and its admins work on it." : ""}
      </StepHead>
      <div className="max-h-[22rem] overflow-y-auto rounded-2xl border border-border-subtle bg-inset/40 px-5" style={{ maskImage: `linear-gradient(to bottom, transparent, black ${EDGE_FADE}px, black calc(100% - ${EDGE_FADE}px), transparent)`, paddingBlock: EDGE_FADE }}>
        <MarkdownContent content={fillAgreement(agreement.text, { name, date: today })} className="text-sm sm:text-sm [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:leading-snug [&_h2]:text-base" />
      </div>
      <div className="mt-5 grid gap-4 sm:max-w-md">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Signed by</span>
          <Input value={name} maxLength={SIGNER_NAME_MAX} onChange={(e) => setTyped(e.target.value)} autoComplete="name" />
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
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        {unopened ? (
          <p className="max-w-md text-sm text-muted-foreground">
            Publishing isn&apos;t open to this workspace yet. Openscholar opens it for an organisation on request: write to{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-foreground underline-offset-4 hover:underline">
              {CONTACT_EMAIL}
            </a>
            . You can publish from your own workspace meanwhile.
          </p>
        ) : blocked ? (
          <p className="text-sm text-muted-foreground">{blocked}</p>
        ) : null}
        {starts ? (
          <Button
            className="relative"
            disabled={!agreed || !name.trim() || busy || !!blocked || !workspaceId}
            onClick={() =>
              start(async () => {
                try {
                  onSigned(await sign({ workspaceId: workspaceId!, name, onBehalfOfAll: all, version: agreement.version }));
                } catch (error) {
                  said("The agreement couldn't be signed")(error);
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
        ) : (
          <Button onClick={() => openSignIn()}>
            <PenLine /> Sign in to publish
          </Button>
        )}
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
function DoiStep({ report, fresh, onNext }: { report: Report; fresh: boolean; onNext: () => void }) {
  const reduce = useReducedMotion();
  const play = fresh && !reduce;
  const rise = (delay: number) => (play ? { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay, duration: 0.4, ease: EASE } } : {});
  // The prefix and what follows it: a narrow screen breaks the DOI between them, never inside one.
  const slash = report.doi.indexOf("/") + 1;
  const parts = [report.doi.slice(0, slash), report.doi.slice(slash)];
  const LETTERS_AT = 0.55;
  const LETTER = 0.03;
  return (
    <div className="flex flex-col items-center pb-2 pt-3 text-center">
      <div className="relative size-20">
        {play ? <motion.span aria-hidden className="absolute inset-0 rounded-[1.75rem] border-2 border-primary" initial={{ opacity: 0.6, scale: 1 }} animate={{ opacity: 0, scale: 1.6 }} transition={{ delay: 0.3, duration: 0.7, ease: "easeOut" }} /> : null}
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
        It stays with your report, and goes live when the report does.
      </motion.p>
      <motion.div className="relative mt-7 w-full max-w-xl overflow-hidden rounded-2xl border border-primary/20 bg-primary/[0.06] px-5 py-6" {...rise(0.45)}>
        <p className="sr-only">{report.doi}</p>
        <p aria-hidden className="flex flex-wrap justify-center font-mono text-xl font-semibold tracking-tight sm:text-[1.625rem]">
          {parts.map((part, group) => (
            <span key={group} className="whitespace-nowrap">
              {[...part].map((letter, i) => (
                <motion.span key={i} className="inline-block" initial={play ? { opacity: 0, y: 14, filter: "blur(6px)" } : false} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ delay: LETTERS_AT + (group ? slash + i : i) * LETTER, duration: 0.35, ease: EASE }}>
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
            transition={{ delay: LETTERS_AT + report.doi.length * LETTER + 0.1, duration: 0.9, ease: "easeInOut" }}
          />
        ) : null}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <StatusChip tone="neutral" icon={Hash}>
            {report.registration.crossref ? "Reserved with Crossref" : "Reserved with Zenodo"}
          </StatusChip>
        </div>
      </motion.div>
      <motion.div className="mt-6 flex flex-wrap justify-center gap-2" {...rise(LETTERS_AT + report.doi.length * LETTER)}>
        <Button variant="outline" onClick={() => copy(`https://doi.org/${report.doi}`, "DOI")}>
          <Copy /> Copy the DOI
        </Button>
        <Button onClick={onNext}>
          <FileUp /> Upload the PDF
        </Button>
      </motion.div>
    </div>
  );
}

/** What a PDF's reading fell short of, said where the author fills in what it left. */
function PdfNotice({ trouble }: { trouble: NonNullable<Report["pdf"]>["trouble"] }) {
  if (trouble !== "textless" && trouble !== "unread") return null;
  return (
    <p role="status" className="mb-5 flex items-start gap-2.5 rounded-2xl bg-inset px-4 py-3 text-sm">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 ink-warning" />
      <span className="min-w-0">
        {trouble === "textless"
          ? "This PDF holds no text, as a scan doesn't. The checks can't find the byline in it. Export the report as a PDF with its text and upload that, or fill in the details by hand."
          : "Openscholar couldn't read the details from this PDF. Fill them in by hand."}
      </span>
    </p>
  );
}

function UploadStep({ report, workspaceId }: { report: Report; workspaceId: Id<"workspaces"> }) {
  const startUpload = useMutation(api.reports.flow.startUpload);
  const attachPdf = useMutation(api.reports.flow.attachPdf);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  // The file on its way up. Once it's the report's, the report itself says it is being read.
  const [sending, setSending] = useState<File | null>(null);
  const here = { workspaceId, key: report.key };
  const put = async (file: Blob, type: string) => {
    const response = await fetch(await startUpload(here), { method: "POST", headers: { "Content-Type": type }, body: file });
    if (!response.ok) throw new Error("The upload didn't arrive. Try again.");
    return ((await response.json()) as { storageId: Id<"_storage"> }).storageId;
  };
  // A PDF is being read from the moment it's the report's until its pages are known. A reading that has gone on too
  // long is given up on here, so the PDF can be sent again. One already read, as when the author comes back to
  // replace it, is neither.
  const unread = !sending && !!report.pdf && !report.pdf.trouble && report.pdf.pages === undefined;
  const reading = unread && Date.now() - report.pdf!.at < STUCK_MS;
  const stuck = unread && !reading;
  const busy = !!sending || reading;
  const send = async (picked: File | undefined) => {
    if (!picked || busy) return;
    if (!/\.pdf$/i.test(picked.name)) return void toast.error("Choose a PDF");
    if (picked.size === 0) return void toast.error("That file is empty. Choose the PDF again.");
    if (picked.size > PDF_MAX_MB * 1024 * 1024) return void toast.error(`The PDF is over ${PDF_MAX_MB} MB`);
    setSending(picked);
    try {
      // The PDF goes up while its first page is drawn here: a cover that can't be drawn leaves the title page.
      const [file, cover] = await Promise.all([
        put(picked, "application/pdf"),
        drawCover(picked).then((picture) => (picture ? put(picture, "image/jpeg") : undefined)).catch(() => undefined),
      ]);
      const refused = await attachPdf({ ...here, file, name: picked.name, ...(cover && { cover }) });
      if (refused) return void toast.error(refused);
    } catch (error) {
      said("The PDF couldn't be uploaded. Try again.")(error);
    } finally {
      setSending(null);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div>
      <StepHead title="Upload the PDF">Put the byline on the cover or the first page before you upload. The checks look for it and for the DOI in it.</StepHead>
      <div className="mb-5 grid gap-4">
        <CopyField label="Byline" value={report.byline} what="Byline" />
        <CopyField label="DOI" value={`https://doi.org/${report.doi}`} mono what="DOI" />
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
        className={cn("flex h-44 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-center transition-colors", over ? "border-primary bg-primary/5" : "border-border hover:border-primary/60 hover:bg-muted/50")}
      >
        {sending ? (
          <>
            <Spinner className="size-6 text-primary" />
            <span className="max-w-full truncate px-6 text-sm font-medium">Uploading {sending.name}</span>
            <span className="text-xs text-muted-foreground">{bytes(sending.size)}</span>
          </>
        ) : reading ? (
          <>
            <AiIcon working className="size-6 text-primary" />
            <span className="text-sm font-medium">Openscholar is reading your report</span>
            <span className="text-xs text-muted-foreground">About half a minute. You can leave this page: it carries on.</span>
          </>
        ) : (
          <>
            <FileUp className="size-6 text-primary" />
            <span className="text-sm font-medium">Drop the PDF here, or choose it</span>
            <span className="text-xs text-muted-foreground">One PDF, up to {PDF_MAX_MB} MB</span>
          </>
        )}
      </button>
      <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void send(e.target.files?.[0])} />
      {report.pdf?.trouble === "unopened" && !busy ? (
        <p role="alert" className="mt-3 flex items-start gap-2 ps-1 text-sm text-destructive">
          <CircleX className="mt-0.5 size-4 shrink-0" />
          {report.pdf.name} couldn&apos;t be opened as a PDF. Save it again as a PDF and upload that.
        </p>
      ) : stuck ? (
        <p role="alert" className="mt-3 flex items-start gap-2 ps-1 text-sm text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 ink-warning" />
          Reading {report.pdf!.name} is taking longer than it should. Upload it again.
        </p>
      ) : report.pdf && !busy ? (
        <p className="mt-3 flex items-center gap-2 ps-1 text-xs text-muted-foreground">
          <FileText className="size-3.5" />
          Uploading again replaces {report.pdf.name}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One check: running, then its answer. A check that finds something or doesn't says what; a scored one shows its score
 * against its line, the failing side tinted. What arrives after the row is drawn fades in and opens its place.
 */
export function CheckRow({ name, result, advice = true, overruled = false }: { name: string; result?: CheckResult; /** Whether to say what the author can do about a failed check: only where they still can. */ advice?: boolean; /** A reviewer approved the report over this check's answer. */ overruled?: boolean }) {
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
              <motion.span key="done" initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 500, damping: 26 }}>
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
                <StatusChip tone={overruled ? "neutral" : tone}>{overruled ? "Approved by a reviewer" : result.pass ? "Passed" : result.errored ? "Didn't finish" : result.blocking ? "Failed" : "Flagged"}</StatusChip>
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
                    <motion.div className={cn("absolute inset-y-0 start-0 rounded-full", result.pass ? "bg-success" : result.blocking ? "bg-destructive" : "bg-warning")} initial={{ width: "0%" }} animate={{ width: `${Math.max(sure, 2)}%` }} transition={reduce ? { duration: 0 } : { duration: 0.5, ease: EASE }} />
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
                <a href={result.evidence.url} target="_blank" rel="noopener noreferrer" className="ms-8 mt-2 flex min-w-0 items-center gap-1.5 text-xs/5 text-muted-foreground underline-offset-4 hover:text-primary hover:underline">
                  <span className="shrink-0">{result.evidence.where ? `Found in ${result.evidence.where}:` : "Found as"}</span>
                  <span className="truncate font-medium text-foreground/80">{result.evidence.title}</span>
                  <ArrowUpRight className="size-3 shrink-0" />
                </a>
              ) : null}
              {result.reasoning ? <p className="ms-8 mt-2 text-xs/5 text-muted-foreground">{result.reasoning}</p> : null}
              {!result.pass && result.fix && advice ? (
                <p className="ms-8 mt-2 flex items-start gap-2 rounded-xl bg-inset px-3 py-2 text-xs/5">
                  <RotateCcw className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <span className="min-w-0 break-words">{result.fix}</span>
                </p>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </AutoHeight>
    </li>
  );
}

/** The checks, running or answered, under a head that says where the report stands, and what to do next. */
function Checks({ rows, report, humanReview, onActivate, onFix, onDetails, onRequestReview, onAnother }: { rows: Array<{ id: string; name: string; result?: CheckResult }>; /** None while the checks run. */ report: Report | null; humanReview: boolean; onActivate?: () => Promise<void>; onFix?: () => void; onDetails?: () => void; onRequestReview?: (comment: string) => Promise<void>; onAnother?: () => void }) {
  const [asking, setAsking] = useState(false);
  const answered = rows.filter((r) => r.result).length;
  const stage = report ? stageOf(report, humanReview) : null;
  const [activating, start] = useTransition();
  const activateNow = () =>
    start(async () => {
      try {
        await onActivate?.();
      } catch (error) {
        said("It couldn't be activated")(error);
      }
    });
  const head = !report ? (
    <StepHead key="running" title="Running the checks" aside={<StatusChip tone="running" icon="tone">{answered} of {rows.length}</StatusChip>}>
      Looking for earlier copies takes a few seconds. You can leave this page: the checks carry on.
    </StepHead>
  ) : stage === "ready" ? (
    <StepHead key="ready" title="Ready to activate" aside={<StatusChip tone="success" icon={CircleCheck}>{report.approved ? "Approved" : "Passed"}</StatusChip>}>
      {report.approved ? "A reviewer approved your report. Activate it to make its DOI live and open its page." : "Your report passed its checks. Activate it to make its DOI live and open its page."}
    </StepHead>
  ) : stage === "review" ? (
    <StepHead key="review" title="Waiting for review" aside={<StatusChip tone="running" icon={ReviewQueueIcon}>In review</StatusChip>}>
      {rows.some((r) => r.result && !r.result.pass)
        ? "A check flagged your report, so a reviewer looks at it. You can activate it once they approve it, and you'll hear by email."
        : "Your report passed its checks. You can activate it once a reviewer approves it, and you'll hear by email."}
    </StepHead>
  ) : stage === "declined" ? (
    <StepHead key="declined" title={report.withdrawn ? "Withdrawn" : "Not published"} aside={<StatusChip tone="danger" icon={CircleX}>{report.withdrawn ? "Withdrawn" : "Declined"}</StatusChip>}>
      {report.withdrawn ? "A reviewer withdrew this report. Its page now says so." : "A reviewer declined this report."}
    </StepHead>
  ) : (
    <StepHead key="failed" title="Not published yet" aside={<StatusChip tone="danger" icon={CircleX}>A check failed</StatusChip>}>
      {report.asked ? "You asked for a human review. You can also change the details or upload a new PDF, and run the checks again." : "Fix what the check found: change the details, or upload a new PDF. Your DOI stays reserved."}
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
      {report?.reviewRequest && stage === "failed" ? <Said label="Your request">{report.reviewRequest.comment || "Sent without a comment"}</Said> : null}
      {report?.note && stage === "declined" ? <Said label="The reviewer's note">{report.note}</Said> : null}
      <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
        {rows.map((r) => (
          // What to do about a failed check shows only while it can still be done. Once a reviewer has approved the
          // report, the checks it failed say so.
          <CheckRow key={r.id} name={r.name} result={r.result} advice={stage === "failed"} overruled={!!report?.approved && stage !== "declined" && r.result?.pass === false} />
        ))}
      </ul>
      <AutoHeight>
        <AnimatePresence initial={false}>
          {report ? (
            <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className="mt-6 flex flex-wrap justify-end gap-2">
              {stage === "failed" ? (
                <>
                  {report.asked ? null : (
                    <Button variant="outline" onClick={() => setAsking(true)}>
                      <ReviewQueueIcon /> Request a human review
                    </Button>
                  )}
                  <Button variant="outline" onClick={onDetails}>
                    <PenLine /> Change the details
                  </Button>
                  <Button onClick={onFix}>
                    <RotateCcw /> Upload a new PDF
                  </Button>
                </>
              ) : (
                <>
                  {onAnother ? (
                    <Button variant={stage === "declined" ? "default" : "outline"} onClick={onAnother}>
                      <Plus /> Publish another
                    </Button>
                  ) : null}
                  {stage === "ready" ? (
                    <Button className="relative" disabled={activating} onClick={activateNow}>
                      <Working busy={activating}>
                        <span className="flex items-center gap-2">
                          <BadgeCheck /> Activate
                        </span>
                      </Working>
                    </Button>
                  ) : stage === "review" ? (
                    <TooltipHint label="A reviewer has to approve it first">
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

/**
 * A workspace's report as a member who can't change it sees it: where it stands, what the checks said of it, and
 * who can change it. Nothing here acts on the report.
 */
function ReportSeen({ report, humanReview }: { report: Report; humanReview: boolean }) {
  const stage = stageOf(report, humanReview);
  const status = STATUS[stage];
  return (
    <div>
      <StepHead title={report.title ?? "Untitled report"} aside={<StatusChip tone={status.tone} icon={status.icon}>{stage === "declined" && report.withdrawn ? "Withdrawn" : status.label}</StatusChip>}>
        {report.signer ? `${report.signer} started this report.` : "Someone in this workspace started this report."} Only they and the workspace&apos;s admins can change it.
      </StepHead>
      {report.results?.length ? (
        <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
          {report.results.map((r) => (
            <CheckRow key={r.checkId} name={r.name} result={r} advice={false} overruled={!!report.approved && stage !== "declined" && !r.pass} />
          ))}
        </ul>
      ) : null}
      {report.status === "live" ? (
        <div className="mt-6 flex justify-end">
          <Button asChild>
            <Link href={`/papers/${report.key}`}>
              Open its page <ArrowUpRight />
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Words someone wrote about the report, under whose they are: the author's request, or a reviewer's note. */
function Said({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-2xl bg-inset px-4 py-3">
      <ReviewQueueIcon className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{children}</p>
      </div>
    </div>
  );
}

/** Asks a person to look at a report its checks failed, with what the author thinks they got wrong. */
function ReviewRequestDialog({ open, onClose, onSend }: { open: boolean; onClose: () => void; onSend: (comment: string) => Promise<void> }) {
  const [comment, setComment] = useState("");
  const [sending, start] = useTransition();
  const send = () =>
    start(async () => {
      try {
        await onSend(comment);
        toast.success("Sent to a reviewer");
        onClose();
      } catch (error) {
        said("The request couldn't be sent")(error);
      }
    });
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !sending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request a human review</DialogTitle>
          <DialogDescription>A reviewer reads your report and what the checks said. Ask when you think a check got it wrong.</DialogDescription>
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
          <motion.span aria-hidden className="absolute inset-0 rounded-full border-2 border-success" initial={{ opacity: 0.6, scale: 1 }} animate={{ opacity: 0, scale: 1.7 }} transition={{ delay: 0.55, duration: 0.7, ease: "easeOut" }} />
          {RAYS.map((angle) => (
            <span key={angle} aria-hidden className="absolute inset-0 flex items-center justify-center" style={{ transform: `rotate(${angle}deg)` }}>
              <motion.span className="h-[3px] w-2.5 rounded-full bg-success" initial={{ x: 30, opacity: 0 }} animate={{ x: [30, 50], opacity: [0, 1, 0] }} transition={{ delay: 0.55, duration: 0.6, ease: "easeOut" }} />
            </span>
          ))}
        </>
      ) : null}
      <motion.svg viewBox="0 0 80 80" aria-hidden className="relative size-20" initial={play ? { scale: 0.6, opacity: 0 } : false} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 18 }}>
        <circle cx="40" cy="40" r="34" className="fill-success/10" />
        <motion.circle cx="40" cy="40" r="34" fill="none" strokeWidth="3" strokeLinecap="round" className="stroke-success" style={{ rotate: -90 }} {...draw(0.05)} />
        <motion.path d="M26 41 L36 51 L55 31" fill="none" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-success" {...draw(0.35)} />
      </motion.svg>
    </div>
  );
}

/** The report once it's live: its seal, its DOI and where to go next. Plays its moment only right after Activate. */
function LiveReport({ report, fresh, onAnother }: { report: Report; fresh: boolean; onAnother: () => void }) {
  const reduce = useReducedMotion();
  const play = fresh && !reduce;
  // Each part rises in after the seal has drawn, in reading order.
  const rise = (delay: number) => (play ? { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay, duration: 0.4, ease: EASE } } : {});
  const url = `https://doi.org/${report.doi}`;
  const passed = report.results?.filter((r) => r.pass).length ?? 0;
  return (
    <div>
      {/* Beside the cover, the seal takes the height the cover's column has to spare, so the buttons end on the card's edge. */}
      <div className="flex flex-col items-center pb-7 pt-3 text-center @3xl:pb-12 @3xl:pt-10">
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
            doi.org/{report.doi}
          </a>
          <TooltipHint label="Copy the DOI">
            <Button variant="ghost" size="icon-sm" aria-label="Copy the DOI" className="text-muted-foreground" onClick={() => copy(url, "DOI")}>
              <Copy />
            </Button>
          </TooltipHint>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <RegistrationChips report={report} />
          {/* Green only when every check passed: a report a reviewer approved over one says how many did, plainly. */}
          <StatusChip tone={passed === (report.results?.length ?? 0) ? "success" : "neutral"} icon={ShieldCheck}>
            {passed} of {report.results?.length ?? 0} checks passed
          </StatusChip>
          {report.correctedAt ? (
            <StatusChip tone="neutral" icon={PenLine}>
              Corrected {new Date(report.correctedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </StatusChip>
          ) : null}
        </div>
      </motion.div>
      <motion.div className="mt-6 flex flex-wrap justify-end gap-2" {...rise(0.8)}>
        <Button variant="outline" onClick={onAnother}>
          <Plus /> Publish another
        </Button>
        <Button asChild>
          <Link href={`/papers/${report.key}`}>
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
function ReportCover({ basics, report }: { basics: Basics; report: Report | null }) {
  const m = report?.metadata;
  const live = report?.step === "done" && report.status === "live";
  const facts: Array<{ id: string; icon: typeof Hash; label: string; href?: string }> = [
    ...(report?.pdf?.pages !== undefined ? [{ id: "pdf", icon: FileText, label: `${report.pdf.pages} ${report.pdf.pages === 1 ? "page" : "pages"}` }] : []),
    ...(report ? [{ id: "agreement", icon: PenLine, label: `Agreement v${report.agreementVersion}`, href: `/publish/agreements/${report.key}` }] : []),
    ...(report?.checksVersion ? [{ id: "checks", icon: ShieldCheck, label: `Checks v${report.checksVersion}` }] : []),
  ];
  return (
    // Beside the steps on a wide card; under them on a narrow one, the cover small with its caption next to it.
    <aside className="flex items-start gap-4 @3xl:sticky @3xl:top-24 @3xl:block @3xl:self-start">
      <PaperCover
        className="w-28 shrink-0 @3xl:w-full"
        {...REPORT_COVER}
        title={m?.title || "Your title"}
        authors={m?.authors.map((a) => a.name).filter(Boolean) ?? []}
        source={basics.series.name}
        year={m?.date ? Number(m.date.slice(0, 4)) : null}
        type="report"
        // The picture of the PDF's first page takes the title page's place once it's made.
        image={report?.coverUrl ?? null}
        href={report?.pdf?.url ?? null}
        pdf={!!report?.pdf?.url}
      />
      <div className="min-w-0 flex-1 @3xl:mt-4">
        <TooltipHint label={report ? `doi.org/${report.doi}` : ""} onlyWhenClipped>
          <p className={cn("truncate font-mono text-xs", report ? "text-foreground" : "text-muted-foreground")}>{report ? `doi.org/${report.doi}` : "No DOI yet"}</p>
        </TooltipHint>
        <p className="mt-0.5 text-xs text-muted-foreground">ISSN {basics.series.issn || "pending"}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {live ? (
            <StatusChip tone="success" icon={BadgeCheck} className="fade-enter">
              Live
            </StatusChip>
          ) : null}
          {facts.map((fact) =>
            fact.href ? (
              // The agreement as signed, in a tab of its own to read, save or print.
              <Link key={fact.id} href={fact.href} target="_blank" rel="noopener noreferrer" className="fade-enter rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring">
                <StatusChip tone="neutral" icon={fact.icon} className="transition-colors hover:text-foreground">
                  {fact.label}
                </StatusChip>
              </Link>
            ) : (
              <StatusChip key={fact.id} tone="neutral" icon={fact.icon} className="fade-enter">
                {fact.label}
              </StatusChip>
            ),
          )}
        </div>
      </div>
    </aside>
  );
}
