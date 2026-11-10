"use client";

// Publishing a work in Openscholar Reports (plans/publish-reports). Sign the agreement, which reserves the DOI;
// upload the PDF with the byline on it; correct the details read from it; the checks run; activate it, or wait for
// review. Everything shown is read live from Convex (convex/reports/flow.ts), so a reload, another tab, a reviewer's
// word or a changed setting all land on the page by themselves.

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { parseAsBoolean, parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates, useQueryState } from "nuqs";
import { toast } from "sonner";
import { RedirectToSignIn, useAuth, useClerk, useUser } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Link from "@/components/workspace-link";
import { LibraryPageShell } from "@/components/evidence-libraries/library-page-shell";
import { ListLoading } from "@/components/evidence-libraries/list-controls";
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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
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
import { UpgradeConfirmationDialog } from "@/components/billing/upgrade-confirmation-dialog";
import { Segmented } from "@/components/settings/parts";
import { useCurrentWorkspace } from "@/components/workspaces/parts";
import { ACTIVATION_PRICE, MOCK_CARD, mockWait, useActivationMock } from "@/lib/reports/activation-mock";
import { AiIcon, ArrowUpRight, BadgeCheck, CircleCheck, CircleX, Copy, CreditCard, FileText, FileUp, Hash, PenLine, Plus, PublishIcon, ReviewQueueIcon, RotateCcw, ShieldCheck, Trash2, TriangleAlert } from "@/components/icons";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { REPORT_COVER } from "@/lib/papers/cover";
import { fillAgreement } from "@/lib/reports/agreement";
import { drawCover } from "@/lib/reports/draw-cover";
import { RUN_STUCK_MS, REVIEW_TEXT_MAX, SIGNER_NAME_MAX, changesOf, stageOf, type CheckResult, type Metadata } from "@/lib/reports/report";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { stepBack, withoutKeys } from "@/lib/url-state/step-back";
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
const STUCK_MS = RUN_STUCK_MS;

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

/** MOCK: what a workspace whose plan's new reports for today are used up is told (in place of `limitWords`). */
const planStartWords = (perDay: number, kind: "personal" | "organization") =>
  `${kind === "personal" ? "Your plan" : "This workspace's plan"} starts ${perDay} ${perDay === 1 ? "report" : "reports"} a day. Come back tomorrow, or move to a plan with more.`;

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
  /** A report still without its PDF, opened at its upload: before that it shows its DOI. */
  step: parseAsStringLiteral(["upload"] as const),
  show: parseAsStringLiteral(SHOWS).withDefault("all"),
  page: parseAsInteger.withDefault(1),
};

export function PublishFlow() {
  const { isLoaded, isSignedIn } = useAuth();
  const workspaceId = useWorkspace();
  // In an organisation's workspace every member sees its reports, so each row says who signed.
  const shared = useWorkspaceSlug() !== undefined;
  const [{ view, report: named, correct, step: at, show, page }, setPlace] = useQueryStates(PLACE);
  // An address cut off after "report=" names none: it is the page with no report named.
  const asked = named || null;
  // Moving to another report, view or page of the list is a step forward in the browser's history, so Back returns
  // to where the person was. It is another screen, so it opens at its top, as History's and the library's pages do;
  // the browser puts the place back on the way back.
  const go = (next: Parameters<typeof setPlace>[0]) => void setPlace(next, { history: "push", scroll: true });
  // Leaving a screen with its own button is the step back when that step is there (lib/url-state/step-back.ts), so
  // Back afterwards never reopens it; what a link or a reload opened closes in place.
  const up = (...closed: Array<keyof typeof PLACE>) => {
    if (!stepBack(withoutKeys(closed))) void setPlace(Object.fromEntries(closed.map((key) => [key, null])));
  };

  // Asked once for the minute the page opened in, so the count isn't read again on every draw; a report started
  // here changes the count by itself.
  const [now] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);
  const basics = useQuery(api.reports.settings.forAuthors, {});
  const { data: counts } = useProtectedQuery(api.reports.flow.counts, inWorkspace(workspaceId, {}));
  const { data: starts } = useProtectedQuery(api.reports.flow.starts, inWorkspace(workspaceId, { now }));
  // The report shown is the one the address names; with none named, the only one under way.
  const listed = view === "reports" || (asked === null && (counts?.underWay ?? 0) > 1);
  // Opened with no report named, the page stays on the one it opened: when that one stops being under way (activated
  // here, or declined by a reviewer meanwhile) it shows where it stands now and never gives way to a new report's
  // agreement, and a report started in another tab doesn't take its place. A report that is gone lets go of it.
  const only = counts?.only ?? null;
  const [held, setHeld] = useState<string | null>(null);
  // The list, and an address that names a report, are the person's own move on: the next time the page names none, it
  // opens the one under way then.
  const movedOn = listed || asked !== null;
  if (movedOn ? held !== null : held === null && only !== null) setHeld(movedOn ? null : only);
  const shownKey = listed ? null : (asked ?? held ?? only ?? "new");
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
  // Just signed, its report is still on its way: the agreement stays up until it is here, and the page never falls
  // back to its loading frame in between (that would start the screens anew, and the DOI's moment with them).
  const arriving = !listed && found === undefined && fresh?.step === "doi" && fresh.key === shownKey;
  if (held !== null && shownKey === held && found !== undefined && !(found && "report" in found)) setHeld(null);
  // A report opened from the list: the list stays up, dimmed and inert, until the report is here. The loading frame
  // in between was a blank flash.
  const [fromList, setFromList] = useState(false);
  if (listed !== fromList && (listed || found !== undefined || shownKey === "new")) setFromList(listed);
  const opening = fromList && !listed && shownKey !== "new" && found === undefined && lastList !== undefined;
  /** The list is what shows: asked for, or still up while a report opens from it. */
  const listing = listed || opening;

  const signedOut = isLoaded && !isSignedIn;
  // A link to a report or to the list is its workspace's to open: signing in comes back to it.
  if (signedOut && (view === "reports" || (asked !== null && asked !== "new"))) return <RedirectToSignIn />;
  const ready = basics !== undefined && isLoaded && (signedOut || (counts !== undefined && starts !== undefined && workspaceId !== undefined && (listed ? (list ?? lastList) !== undefined : shownKey === "new" || found !== undefined || arriving || opening)));
  // The page's own shell while it loads, as the app's loading frame draws it: its bar is there from the first frame
  // and names nothing until the page knows whether its title sits beside a back arrow, so the title never moves
  // once it shows. The same shell stays mounted when the page arrives, so its card is already laid out and the
  // filters land where they belong at once (a new shell shows them in the card for a moment in Firefox).
  if (!ready || !basics) {
    return (
      <LibraryPageShell icon={null} title="">
        <ListLoading label="Publish" />
      </LibraryPageShell>
    );
  }

  const saved = found && "report" in found ? found.report : null;
  // Before its PDF is read, a report's DOI and its upload are two screens of one state, so which shows is the
  // address's: opening the upload is a step forward, and Back from it returns to the DOI.
  const report = saved?.step === "doi" && (at === "upload" || saved.pdf) ? { ...saved, step: "upload" as const } : saved;
  // A step the report is sent to is its own from then on, whatever the address said before.
  const ownStep = () => void (at && setPlace({ step: null }));
  const elsewhere = found && "elsewhere" in found ? found.elsewhere : null;
  const missing = !listing && shownKey !== "new" && !report && !arriving;
  const another = () => {
    setFresh(null);
    go({ view: null, report: "new", correct: null });
  };
  const hasReports = (counts?.all ?? 0) > 0;
  // Publishing switched off stops new reports. One already started keeps its address, and the list stays.
  const closed = !basics.open && !listing && !report && !missing;

  return (
    <LibraryPageShell
      icon={PublishIcon}
      title={listing || missing || closed ? "Publish" : report?.metadata?.title || report?.title || "New report"}
      titleAside={report ? <span className="font-mono text-xs text-muted-foreground">{report.key}</span> : undefined}
      // Back to the list, once there is one to go back to.
      backHref={!listing && hasReports ? "/publish?view=reports" : undefined}
      backLabel="Your reports"
      // Back to the list it was opened from is the browser's own step back, so Back afterwards doesn't reopen the report.
      onBackClick={(event) => {
        if (stepBack((behind) => behind.pathname === new URL(event.currentTarget.href).pathname && behind.searchParams.get("view") === "reports")) event.preventDefault();
      }}
      // Another filter is another list: a step in history, opened at its first page.
      filters={listing && counts ? <StatusFilter counts={counts} show={show} onShow={(next) => go({ view: "reports", show: next, page: null })} /> : undefined}
      // Several reports can be under way at once: a new one starts here, and each counts against the day's limit.
      actions={
        listing && basics.open ? (
          <Button size="sm" className={BAR_ACTION} onClick={another}>
            <Plus aria-hidden />
            <span className={BAR_LABEL}>New report</span>
          </Button>
        ) : undefined
      }
      intro={!listing && !missing && !closed ? <StepTrail report={report} humanReview={basics.humanReview} workspaceId={workspaceId} onStep={ownStep} onDoi={saved?.step === "doi" && at === "upload" ? () => up("step") : undefined} /> : undefined}
    >
      {listing ? (
        <div className={cn("transition-opacity", (!list || opening) && "opacity-60")} aria-busy={!list || opening || undefined} inert={opening || undefined}>
          <YourReports
            list={(list ?? lastList)!}
            humanReview={basics.humanReview}
            series={basics.series.name}
            shared={shared}
            show={show}
            onPage={(next) => go({ view: "reports", page: next })}
            onOpen={(key) => go({ view: null, report: key, correct: null })}
            // Changes already waiting open where they stand; otherwise the details open to be corrected.
            onCorrect={(key) => go({ view: null, report: key, correct: (list ?? lastList)?.rows.find((row) => row.key === key)?.changes ? null : true })}
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
                  <a href={`${elsewhere.slug ? `/o/${elsewhere.slug}` : ""}/publish?report=${shownKey}${correct ? "&correct=true" : ""}`}>
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
          {/* Switched off, publishing takes no new report. One already started says why its sidebar item is gone. */}
          {report?.mine && !basics.open && report.status !== "live" ? (
            <p role="status" className="col-span-full flex items-start gap-2.5 rounded-2xl bg-inset px-4 py-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 ink-warning" />
              Publishing is off for new reports for now. You can keep working on this one.
            </p>
          ) : null}
          {/* One set of screens for every report: going from one to another, or to a new report's agreement, is a
              change of screen like any other, and what belongs to one report is put away inside (Screens). */}
          <Screens
            signed={arriving ? fresh.key : null}
            basics={basics}
            report={report}
            starts={starts ?? null}
            shared={shared}
            workspaceId={workspaceId}
            fresh={fresh}
            setFresh={setFresh}
            onSigned={(key) => void setPlace({ report: key })}
            // A report that is about to stop being under way is named in the address first, in place of the plain
            // one: a reload, or Back and Forward, then opens it and not a new report's agreement.
            onNamed={(key) => {
              if (asked === null) void setPlace({ report: key });
            }}
            onAnother={another}
            correcting={correct}
            onUpload={() => {
              // The DOI's moment has played: coming back to it finds it settled.
              setFresh(null);
              go({ step: "upload" });
            }}
            // With its PDF the report moves on by itself, to its reading and then its details, so the upload's step
            // in the history is taken back: Back from the details then leaves the report, and never lands on a
            // step that shows the same screen again.
            onAttached={() => at && up("step")}
            onStep={ownStep}
            onCorrect={() => {
              setFresh(null);
              go({ correct: true });
            }}
            onCorrected={() => up("correct")}
          />
          <ReportCover basics={basics} report={report} />
          <ActivationMockPanel organization={shared} />
        </div>
      )}
    </LibraryPageShell>
  );
}

/** The one report's screen, chosen from where the report stands. */
function Screens({ basics, report, starts, shared, workspaceId, fresh, setFresh, signed, onSigned, onNamed, onAnother, correcting, onUpload, onAttached, onStep, onCorrect, onCorrected }: { basics: Basics; report: Report | null; starts: Starts | null; shared: boolean; workspaceId: Id<"workspaces"> | undefined; fresh: { key: string; step: "doi" | "live" } | null; setFresh: (fresh: { key: string; step: "doi" | "live" } | null) => void; /** The report just signed here, while it is on its way. */ signed: string | null; onSigned: (key: string) => void; /** The report is named in the address from here on. */ onNamed: (key: string) => void; onAnother: () => void; /** A live report's details are open to be corrected. */ correcting: boolean; /** On from the DOI to the upload, a step in the browser's history. */ onUpload: () => void; /** A PDF was attached at the upload. */ onAttached: () => void; /** The report is being sent to a step, which is its own from then on. */ onStep: () => void; onCorrect: () => void; /** The form of changes is left: sent, or given up. */ onCorrected: () => void }) {
  const goTo = useMutation(api.reports.flow.goTo);
  const saveDetails = useMutation(api.reports.flow.saveDetails);
  const requestReview = useMutation(api.reports.flow.requestReview);
  const activate = useMutation(api.reports.flow.activate);
  const runChecks = useAction(api.reports.checks.run);
  const requestChangesReview = useMutation(api.reports.flow.requestChangesReview);
  const discardChanges = useMutation(api.reports.flow.discardChanges);
  const typeChanges = useMutation(api.reports.flow.typeChanges).withOptimisticUpdate((store, { key, metadata }) => {
    // Given up, what was typed is gone from this page at once: a form opened again before the answer is back starts
    // from the report, never from what was just cancelled.
    if (metadata) return;
    for (const { args, value } of store.getAllQueries(api.reports.flow.get)) {
      if (!value || !("report" in value) || value.report.key !== key) continue;
      const { trying, ...report } = value.report;
      if (trying) store.setQuery(api.reports.flow.get, args, { ...value, report });
    }
  });
  // Changes to a live report as last sent to the checks, kept while they run so a run that breaks loses none of them:
  // with the version their form opened on, so sent again they are still held to it.
  const [attempt, setAttempt] = useState<{ metadata: Metadata; since: number } | null>(null);
  // The form of changes holds something typed here and not sent yet. It then stays open whatever else happens to
  // the report, such as its checks running on changes sent from another tab: what was typed is never thrown away.
  const [typing, setTyping] = useState(false);
  // The checks were asked for here and the report hasn't said so yet: the page shows them running at once.
  const [starting, setStarting] = useState(false);
  // Another report is another form: what was typed, sent or started for one is never the next one's.
  const [of, setOf] = useState(report?.key);
  if (of !== report?.key) {
    setOf(report?.key);
    setAttempt(null);
    setTyping(false);
    setStarting(false);
  }
  const here = { workspaceId: workspaceId! };
  // A change of screen made from the foot of a long form opens the next screen at its top, at once, as a step to
  // another page does. Left to itself the page slid up over a quarter of a second while the tall form closed.
  const toTop = () => window.scrollTo({ top: 0 });
  const back = (step: BackStep) => {
    setFresh(null);
    onStep();
    if (report) void goTo({ ...here, key: report.key, step }).catch(said("That step couldn't be opened"));
  };
  // A run that has gone on too long is given up on here, so its author can run the checks again.
  const runStuck = usePassed(report?.run ? report.run.at + STUCK_MS : undefined);
  const running = !!report?.run && !runStuck;
  const live = report?.step === "done" && report.status === "live";
  // A first run reads a report at its details; a run on changes reads a live one, which stays live meanwhile.
  const busy = (report?.step === "details" || live) && (starting || (running && !(live && correcting && typing)));
  const screen = !report ? "agreement" : !report.mine ? "watching" : busy ? "running" : report.step !== "done" ? report.step : !live ? "checks" : correcting ? "correct" : report.correction ? "changes" : "live";
  return (
    <AutoHeight>
      {/* The first screen comes in too: it follows the page's loading frame, and would otherwise pop in over it. */}
      <AnimatePresence mode="wait">
        <motion.div key={`${report?.key ?? "new"}:${screen}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25, ease: EASE }}>
          {!report ? (
            <AgreementStep
              basics={basics}
              shared={shared}
              starts={starts}
              workspaceId={workspaceId}
              signed={signed}
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
            <DoiStep report={report} fresh={fresh?.key === report.key && fresh.step === "doi"} onNext={onUpload} />
          ) : report.step === "upload" ? (
            <UploadStep report={report} workspaceId={workspaceId!} onAttached={onAttached} />
          ) : report.step === "details" && report.metadata && report.pdf ? (
            <>
              <PdfNotice trouble={report.pdf.trouble} onUpload={() => back("upload")} />
              <DetailsStep
                unread={report.pdf.trouble !== undefined}
                // The details of another PDF are another form.
                key={report.pdf.at}
                initial={report.metadata}
                onRun={async (metadata: Metadata) => {
                  toTop();
                  setStarting(true);
                  try {
                    await runChecks({ ...here, key: report.key, metadata, from: { pdfAt: report.pdf!.at } });
                  } catch (error) {
                    said("The checks couldn't run")(error);
                  } finally {
                    setStarting(false);
                  }
                }}
                onSave={(metadata) => void saveDetails({ ...here, key: report.key, metadata, pdfAt: report.pdf!.at }).catch(said("Your changes couldn't be saved"))}
              />
            </>
          ) : live && correcting && report.metadata ? (
            // Changes already waiting are carried on from; so are ones a broken run never finished checking.
            <DetailsStep
              // Changes a broken run never finished checking come first: the ones typed here, or after a reload the ones the run was given.
              initial={attempt?.metadata ?? report.trying ?? report.correction?.metadata ?? report.metadata}
              resend={!!attempt || !!report.trying || !!report.correction}
              // What the form shows: the changes that wait, else the report's details as they were last set.
              version={attempt?.since ?? report.correction?.at ?? report.correctedAt ?? report.activatedAt}
              // Review is on, or a reviewer approved this report over a check: its changes wait for one too.
              waits={basics.humanReview || (report.results ?? []).some((result) => !result.pass)}
              onTouched={() => setTyping(true)}
              // Kept as they are typed, so Back, Forward or a reload brings them back. Typed over a report that has
              // changed since, they are not kept, and sending them is refused in words.
              onSave={(metadata, since) => void typeChanges({ ...here, key: report.key, since: since!, metadata }).catch(said("Your changes couldn't be saved"))}
              onRun={async (metadata: Metadata, since) => {
                toTop();
                setAttempt({ metadata, since: since! });
                setTyping(false);
                setStarting(true);
                try {
                  const stands = await runChecks({ ...here, key: report.key, metadata, from: { changesSince: since! } });
                  // Live or kept for a reviewer, the changes are with the report now: the form closes on where they stand.
                  setAttempt(null);
                  onCorrected();
                  if (stands === "live") toast.success("Your changes are live");
                  else if (stands === "review") toast.success("Your changes are with a reviewer");
                } catch (error) {
                  said("The checks couldn't run")(error);
                } finally {
                  setStarting(false);
                }
              }}
              onCancel={(since) => {
                toTop();
                setAttempt(null);
                setTyping(false);
                // Cancelling gives up what was typed, here and wherever it was kept: a save sent a moment ago may not
                // have come back yet, and this one runs after it. It names the version this form opened on, so what
                // another tab typed over a later one is never the one given up.
                if (typing || report.trying) void typeChanges({ ...here, key: report.key, since: since!, metadata: null }).catch(() => undefined);
                onCorrected();
              }}
            />
          ) : live && report.correction ? (
            <ChangesWaiting
              report={report}
              correction={report.correction}
              onEdit={onCorrect}
              // Each names the changes on this screen, so ones sent since from another tab are never the ones touched.
              onDiscard={() => discardChanges({ ...here, key: report.key, seenAt: report.correction!.at }).then(() => undefined)}
              onRequestReview={(comment) => requestChangesReview({ ...here, key: report.key, seenAt: report.correction!.at, comment }).then(() => undefined)}
            />
          ) : live ? (
            <LiveReport report={report} fresh={fresh?.key === report.key && fresh.step === "live"} onAnother={onAnother} onCorrect={onCorrect} />
          ) : (
            <Checks
              rows={(report.results ?? []).map((result) => ({ id: result.checkId, name: result.name, result }))}
              report={report}
              humanReview={basics.humanReview}
              // Said before the report answers: it turns live ahead of this call's own answer, and the live screen
              // plays its moment only if it opens knowing the report was activated here.
              onActivate={() => {
                onNamed(report.key);
                setFresh({ key: report.key, step: "live" });
                return activate({ ...here, key: report.key }).then(
                  () => undefined,
                  (error: unknown) => {
                    setFresh(null);
                    throw error;
                  },
                );
              }}
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

/** True once `at` has passed. A timer wakes the page then, so what waits on a deadline doesn't wait for another change to be drawn again. */
function usePassed(at: number | undefined) {
  const [, wake] = useState(0);
  // The clock is the outside system: one timer per deadline, cleared when the deadline changes or the screen goes.
  useEffect(() => {
    if (at === undefined || at <= Date.now()) return;
    const timer = setTimeout(() => wake((n) => n + 1), at - Date.now() + 50);
    return () => clearTimeout(timer);
  }, [at]);
  return at !== undefined && Date.now() >= at;
}

/** The six steps as one track that fills as the report moves on. Steps already done can be gone back to until the checks run. */
function StepTrail({ report, humanReview, workspaceId, onStep, onDoi }: { report: Report | null; humanReview: boolean; workspaceId: Id<"workspaces"> | undefined; /** The report is being sent to a step, which is its own from then on. */ onStep: () => void; /** Back to the DOI is a step back in the browser's history, when the upload was opened from it. */ onDoi?: () => void }) {
  const reduce = useReducedMotion();
  const goTo = useMutation(api.reports.flow.goTo);
  const running = report?.step === "details" && !!report.run;
  const place = running ? 4 : placeOf(report);
  const stage = report?.step === "done" ? stageOf(report, humanReview) : null;
  const failed = stage === "failed" || stage === "declined";
  const waiting = stage === "review";
  const canGoBack = !!report && !!workspaceId && report.mine && report.step !== "done" && !running;
  return (
    <div className="px-4 pb-4 pt-5 sm:px-6">
      <ol className="grid grid-cols-6 gap-1">
        {STEPS.map((s, i) => {
          const done = i < place || (i === place && place === 5);
          const current = i === place && place !== 5;
          const Icon = done ? CircleCheck : current && failed ? CircleX : current && waiting ? ReviewQueueIcon : s.icon;
          // The DOI, the PDF and the details, once done; the agreement is signed for good.
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
                <button type="button" onClick={() => (s.id === "doi" && onDoi ? onDoi() : (onStep(), void goTo({ workspaceId: workspaceId!, key: report!.key, step: s.id as BackStep }).catch(said("That step couldn't be opened"))))} className="flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 text-start transition-colors hover:text-primary">
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

function AgreementStep({ basics, shared, starts, workspaceId, signed, onSigned }: { basics: Basics; shared: boolean; /** The workspace's day; null signed out. */ starts: Starts | null; workspaceId: Id<"workspaces"> | undefined; /** The report this signing just made, until its screen opens: the step waits for it as it waited for the signing. */ signed: string | null; onSigned: (key: string) => void }) {
  const { openSignIn } = useClerk();
  const { user } = useUser();
  const sign = useMutation(api.reports.flow.sign);
  // Today, kept for as long as the step is open, so the text doesn't change under the reader at midnight.
  const [today] = useState(() => new Date());
  // The name they are known by, until they type another.
  const [typed, setTyped] = useState<string | null>(null);
  const name = typed ?? user?.fullName ?? "";
  const [busy, start] = useTransition();
  const { agreement } = basics;
  // Each tick is for the agreement as it read when it was made. One changed since, while the page was open, is
  // read and ticked again before it can be signed.
  const [ticks, setTicks] = useState({ version: agreement.version, all: false, agreed: false });
  const changed = ticks.version !== agreement.version && (ticks.all || ticks.agreed);
  const { all, agreed } = ticks.version === agreement.version ? ticks : { all: false, agreed: false };
  const tick = (next: { all?: boolean; agreed?: boolean }) => setTicks({ version: agreement.version, all, agreed, ...next });
  // The workspace has used up its day, or has none: no new report can start, and the page says which. A DOI the
  // person reserved and did nothing with is theirs again by signing, whatever the day has left.
  // MOCK (mock/activation-payment): new reports a day are the plan's (Autumn's `reports_per_day`), so no workspace is
  // closed to publishing and the words point at the plans. The mock's "Used up" stands in for a day that's used up.
  const startsUsed = useActivationMock((s) => s.startsUsed);
  const blocked = starts && !starts.untouched && (startsUsed || starts.left < 1) ? planStartWords(starts.perDay || 3, starts.kind) : null;
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
          <Checkbox checked={all} onCheckedChange={(v) => tick({ all: v === true })} className="mt-0.5" />
          <span>I sign for all the authors, who have agreed</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <Checkbox checked={agreed} onCheckedChange={(v) => tick({ agreed: v === true })} className="mt-0.5" />
          <span>I agree to this agreement</span>
        </label>
        {starts?.untouched && starts.untouched !== signed ? (
          // A reload while signing lands here with the DOI already reserved: it is this one, and signing gives it again.
          <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-inset px-4 py-3 text-sm">
            <span className="min-w-0 flex-1 basis-56">
              You already reserved a DOI for <span className="font-mono">{starts.untouched}</span> and haven&apos;t uploaded its PDF.
            </span>
            <Button size="sm" variant="outline" onClick={() => onSigned(starts.untouched!)}>
              Continue with it <ArrowUpRight />
            </Button>
          </p>
        ) : null}
        {changed ? (
          <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 ink-warning" />
            The agreement changed while this page was open. Read it again, then tick the boxes.
          </p>
        ) : null}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        {blocked ? (
          <>
            <p className="text-sm text-muted-foreground">{blocked}</p>
            <Button variant="outline" asChild>
              <Link href="/pricing">
                See plans <ArrowUpRight />
              </Link>
            </Button>
          </>
        ) : null}
        {starts ? (
          <Button
            className="relative"
            disabled={!agreed || !name.trim() || busy || !!signed || !!blocked || !workspaceId}
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
            <Working busy={busy || !!signed}>
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
    // A DOI is one long word: it breaks anywhere, so on a phone it wraps inside the box and the copy button stays in reach.
    <div className="min-w-0 space-y-1.5">
      <span className="ps-1 text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-start gap-2 rounded-xl border border-border-subtle bg-inset px-3.5 py-3">
        <span className={cn("min-w-0 flex-1 text-sm [overflow-wrap:anywhere]", mono && "font-mono text-[0.9375rem] font-medium tracking-tight")}>{value}</span>
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
function PdfNotice({ trouble, onUpload }: { trouble: NonNullable<Report["pdf"]>["trouble"]; onUpload: () => void }) {
  if (trouble !== "textless" && trouble !== "unread") return null;
  return (
    <div role="status" className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-2xl bg-inset px-4 py-3 text-sm">
      <p className="flex min-w-0 flex-1 basis-72 items-start gap-2.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 ink-warning" />
        <span className="min-w-0">
          {trouble === "textless"
            ? "This PDF holds no text, as a scan doesn't. The checks can't find the byline in it. Export the report as a PDF with its text and upload that, or fill in the details by hand."
            : "Openscholar couldn't read the details from this PDF. Fill them in by hand."}
        </span>
      </p>
      {trouble === "textless" ? (
        <Button size="sm" variant="outline" className="ms-auto" onClick={onUpload}>
          <FileUp /> Upload another PDF
        </Button>
      ) : null}
    </div>
  );
}

function UploadStep({ report, workspaceId, onAttached }: { report: Report; workspaceId: Id<"workspaces">; /** The PDF is the report's: from here the report itself says where it stands. */ onAttached: () => void }) {
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
  const stuck = usePassed(unread ? report.pdf!.at + STUCK_MS : undefined);
  const reading = unread && !stuck;
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
      onAttached();
    } catch (error) {
      // A browser's own words for a request that never left ("Load failed") tell an author nothing: the file wasn't
      // kept, and the connection is what to look at.
      if (error instanceof TypeError) toast.error("The PDF couldn't be uploaded. Check your connection, then choose it again.");
      else said("The PDF couldn't be uploaded. Try again.")(error);
    } finally {
      setSending(null);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div>
      <StepHead title="Upload the PDF">Put the following text, verbatim, on the cover or the inside cover before you upload. Our check looks for this line.</StepHead>
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
              {/* A question's answer: how sure the model is of yes, which passes, against the line it has to clear, the side
                  short of it tinted. An author never reads the question, so the words say "passes", not "yes". */}
              {asked ? (
                <div className="ms-8 mt-2.5 flex items-center gap-3">
                  <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-inset">
                    <span aria-hidden className={cn("absolute inset-y-0 start-0", result.blocking ? "bg-destructive/15" : "bg-warning/20")} style={{ width: `${need}%` }} />
                    <motion.div className={cn("absolute inset-y-0 start-0 rounded-full", result.pass ? "bg-success" : result.blocking ? "bg-destructive" : "bg-warning")} initial={{ width: "0%" }} animate={{ width: `${Math.max(sure, 2)}%` }} transition={reduce ? { duration: 0 } : { duration: 0.5, ease: EASE }} />
                    <span aria-hidden className="absolute inset-y-0 w-0.5 bg-foreground/50" style={{ insetInlineStart: `${need}%` }} />
                  </div>
                  <span className="w-40 shrink-0 text-end text-xs tabular-nums">
                    <span className="font-medium text-foreground/80">{result.answer === "unclear" ? "Unclear" : `${sure}% sure it passes`}</span>
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
  const [asking, setAsking] = useAsking();
  const answered = rows.filter((r) => r.result).length;
  const stage = report ? stageOf(report, humanReview) : null;
  const [activating, start] = useTransition();
  // MOCK (mock/activation-payment): only the workspace's admins activate, a saved card is needed first, and past the
  // day's free activations each one is paid for (lib/reports/activation-mock.ts).
  const workspace = useCurrentWorkspace();
  const mock = useActivationMock();
  // From a person's own workspace, the mock's organisation roles look at the report as if an organisation had it.
  const organization = workspace?.kind === "organization" ? workspace.name : mock.role ? "Open Development and Education" : null;
  const admin = !organization || (mock.role ?? workspace?.role) === "admin";
  const free = mock.freeLeft > 0;
  const [paying, setPaying] = useState(false);
  const activateNow = () =>
    start(async () => {
      try {
        // MOCK: the charge. The real one attaches the activation plan through Autumn, keyed to the report.
        if (!free) await mockWait();
        if (!free && mock.card === "declines") throw new Error("Your card was declined. Nothing was charged, and the report is still ready.");
        await onActivate?.();
        mock.activated(free);
      } catch (error) {
        said("It couldn't be activated")(error);
      }
    });
  const head = !report ? (
    <StepHead key="running" title="Running the checks" aside={<StatusChip tone="running" icon="tone">{answered} of {rows.length}</StatusChip>}>
      Looking for earlier copies takes a few seconds. You can leave this page: the checks carry on.
    </StepHead>
  ) : stage === "ready" && !admin ? (
    <StepHead key="admin" title="Waiting for an admin" aside={<StatusChip tone="success" icon={CircleCheck}>{report.approved ? "Approved" : "Passed"}</StatusChip>}>
      {report.approved ? "A reviewer approved your report." : "Your report passed its checks."} An admin of {organization} activates it. They&apos;ve had an email saying it&apos;s ready.
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
          <motion.div key={stage === "ready" && !admin ? "admin" : (stage ?? "running")} className="flow-root" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
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
            <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className="mt-6">
              {stage === "ready" && admin ? <PaymentLine organization={organization} free={mock.freeLeft} /> : null}
              <div className="flex flex-wrap justify-end gap-2">
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
                    {stage === "ready" && !admin ? (
                      <TooltipHint label="Only an admin can activate it">
                        <span tabIndex={0}>
                          <Button disabled>
                            <BadgeCheck /> Activate
                          </Button>
                        </span>
                      </TooltipHint>
                    ) : stage === "ready" && mock.card === "none" ? (
                      <TooltipHint label="Add a payment method first">
                        <span tabIndex={0}>
                          {/* The same words as once a card is saved, so the button keeps its width. */}
                          <Button className="relative" disabled>
                            <Working busy={false}>
                              <span className="flex items-center gap-2">
                                <BadgeCheck /> {free ? "Activate" : `Activate for $${ACTIVATION_PRICE}`}
                              </span>
                            </Working>
                          </Button>
                        </span>
                      </TooltipHint>
                    ) : stage === "ready" ? (
                      <Button className="relative" disabled={activating} onClick={free ? activateNow : () => setPaying(true)}>
                        <Working busy={activating}>
                          <span className="flex items-center gap-2">
                            <BadgeCheck /> {free ? "Activate" : `Activate for $${ACTIVATION_PRICE}`}
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
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </AutoHeight>
      {onRequestReview ? <ReviewRequestDialog open={asking} onClose={() => setAsking(false)} onSend={onRequestReview} /> : null}
      {report ? (
        // Asks before the charge: a saved card is charged as soon as it's confirmed, with no page of Stripe's in between.
        <UpgradeConfirmationDialog
          open={paying}
          onOpenChange={setPaying}
          title={`Pay $${ACTIVATION_PRICE} to activate ${report.key}`}
          description={organization ? `${organization}'s card is charged.` : undefined}
          confirmLabel="Pay and activate"
          totalLabel="Due now"
          labels={{ from: "Its DOI now", to: "After" }}
          isConfirming={false}
          onConfirm={() => {
            setPaying(false);
            activateNow();
          }}
          cardBrand={MOCK_CARD.brand}
          cardLast4={MOCK_CARD.last4}
          preview={{ currency: "USD", immediateChargeCents: ACTIVATION_PRICE * 100, currentPlan: "Reserved", targetPlan: "Live", targetPlanCreditsPerMonth: 0, lineItems: [] }}
        />
      ) : null}
    </div>
  );
}

/**
 * MOCK: what activating is paid with, beside the Activate button: the saved card, and whether this one is free. With no
 * card, the way to add one, which in the real build opens Stripe's page for saving a card (Autumn's `setup_payment`) and
 * comes back here.
 */
function PaymentLine({ organization, free }: { organization: string | null; free: number }) {
  const mock = useActivationMock();
  const [saving, save] = useTransition();
  const card = mock.card !== "none";
  return (
    <div className="mb-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-3 rounded-2xl bg-inset/60 py-3 ps-3 pe-3 sm:flex-nowrap">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground">
        <CreditCard className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        {card ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
            <span className="capitalize">{MOCK_CARD.brand}</span>
            {/* ui-rules-allow: dot-separator -- the masked digits of a card number */}
            <span className="tabular-nums">&bull;&bull;&bull;&bull; {MOCK_CARD.last4}</span>
            {free > 0 ? (
              <StatusChip tone="success" icon={CircleCheck}>
                Free
              </StatusChip>
            ) : null}
          </p>
        ) : (
          <p className="text-sm font-medium">Add a payment method to activate</p>
        )}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {!card
            ? organization
              ? `Each activation costs $${ACTIVATION_PRICE}, charged to ${organization}.`
              : `Each activation costs $${ACTIVATION_PRICE}.`
            : free > 0
              ? `${free} free ${free === 1 ? "activation" : "activations"} left today`
              : organization
                ? `${organization}'s card`
                : "Your card"}
        </p>
      </div>
      {card ? (
        // The cards are the billing page's, where Stripe's own page changes them.
        <Button variant="ghost" asChild className="shrink-0 text-muted-foreground">
          <Link href="/settings/billing">
            Change <ArrowUpRight />
          </Link>
        </Button>
      ) : (
        <Button
          variant="outline"
          className="relative shrink-0"
          disabled={saving}
          onClick={() =>
            save(async () => {
              await mockWait(1200);
              mock.set({ card: "saved" });
              toast.success("Card saved");
            })
          }
        >
          <Working busy={saving}>
            <span className="flex items-center gap-2">
              <CreditCard /> Add payment method
            </span>
          </Working>
        </Button>
      )}
    </div>
  );
}

/** MOCK: the states the mock can be looked at in. Not part of the design. */
function ActivationMockPanel({ organization }: { organization: boolean }) {
  const mock = useActivationMock();
  return (
    <section aria-label="Mock states" className="col-span-full flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Mock</span>
      <div className="flex items-center gap-2">
        View as
        <Segmented label="View as" value={mock.role ?? "real"} onChange={(v) => mock.set({ role: v === "real" ? null : v })} options={[{ id: "real", label: organization ? "My role" : "Me" }, { id: "admin", label: "Org admin" }, { id: "member", label: "Org member" }]} />
      </div>
      <div className="flex items-center gap-2">
        Card
        <Segmented label="Card" value={mock.card} onChange={(v) => mock.set({ card: v })} options={[{ id: "none", label: "None" }, { id: "saved", label: "Saved" }, { id: "declines", label: "Declines" }]} />
      </div>
      <div className="flex items-center gap-2">
        Free left today
        <Segmented label="Free left today" value={String(Math.min(mock.freeLeft, 2))} onChange={(v) => mock.set({ freeLeft: Number(v) })} options={[{ id: "0", label: "0" }, { id: "1", label: "1" }, { id: "2", label: "2" }]} />
      </div>
      <div className="flex items-center gap-2">
        New reports today
        <Segmented label="New reports today" value={mock.startsUsed ? "used" : "left"} onChange={(v) => mock.set({ startsUsed: v === "used" })} options={[{ id: "left", label: "Some left" }, { id: "used", label: "Used up" }]} />
      </div>
    </section>
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
/**
 * Whether the request for a human review is open. It is in the address, so opening it is a step Back closes, Forward
 * reopens, and a reload keeps; closing it with its own buttons is that step taken back.
 */
function useAsking() {
  const [ask, setAsk] = useQueryState("ask", parseAsStringLiteral(["review"] as const));
  const set = (open: boolean) => {
    if (open) void setAsk("review", { history: "push", scroll: false });
    else if (!stepBack(withoutKeys(["ask"]))) void setAsk(null);
  };
  return [ask === "review", set] as const;
}

function ReviewRequestDialog({ open, onClose, onSend }: { open: boolean; onClose: () => void; onSend: (comment: string) => Promise<void> }) {
  const [comment, setComment] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
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
      <DialogContent
        className="sm:max-w-lg"
        // Typing starts in the box. The dialog puts the focus there itself, so closing it gives the focus back to the
        // button that opened it: a box that took the focus by itself would be what the dialog remembered instead.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          box.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Request a human review</DialogTitle>
          <DialogDescription>A reviewer reads your report and what the checks said. Ask when you think a check got it wrong.</DialogDescription>
        </DialogHeader>
        <Field label="What did the checks get wrong?" counter={`${comment.length} / ${REVIEW_TEXT_MAX}`}>
          {(id) => <Textarea ref={box} id={id} value={comment} onChange={(e) => setComment(e.target.value)} rows={4} maxLength={REVIEW_TEXT_MAX} />}
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
function LiveReport({ report, fresh, onAnother, onCorrect }: { report: Report; fresh: boolean; onAnother: () => void; onCorrect: () => void }) {
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
        <Button variant="outline" onClick={onCorrect}>
          <PenLine /> Correct the details
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
 * Changes to a live report's details that haven't gone live: where they stand, what they change, what the checks said
 * of them, and what their author can do. The report itself stays live as it was all the while.
 */
function ChangesWaiting({ report, correction, onEdit, onDiscard, onRequestReview }: { report: Report; correction: NonNullable<Report["correction"]>; onEdit: () => void; onDiscard: () => Promise<void>; onRequestReview: (comment: string) => Promise<void> }) {
  const stage = report.changes ?? "review";
  const [asking, setAsking] = useAsking();
  const [discarding, setDiscarding] = useState(false);
  const changed = report.metadata ? changesOf(report.metadata, correction.metadata) : [];
  const note = stage === "declined" ? correction.declined?.note : stage === "review" ? correction.request?.comment : undefined;
  // Checks the report itself failed, which a reviewer approved it over: only a reviewer answers those, and a live
  // report takes no new PDF, so what to do about them is never shown.
  const overruled = new Set((report.results ?? []).filter((r) => !r.pass).map((r) => r.checkId));
  const again = correction.results.some((r) => !r.pass && overruled.has(r.checkId));
  return (
    <div>
      {stage === "review" ? (
        <StepHead title="Changes in review" aside={<StatusChip tone="running" icon={ReviewQueueIcon}>In review</StatusChip>}>
          {correction.request
            ? "You asked a reviewer to look. Your report stays live as it was until they decide, and you'll hear by email."
            : again
              ? "A reviewer approved your report over a check, so a reviewer approves its changes too. Your report stays live as it was until then, and you'll hear by email."
              : "Your report stays live as it was. Your changes go live once a reviewer approves them, and you'll hear by email."}
        </StepHead>
      ) : stage === "declined" ? (
        <StepHead title="Changes declined" aside={<StatusChip tone="danger" icon={CircleX}>Declined</StatusChip>}>
          Your report stays live as it was. Change the details and send them again, or discard the changes.
        </StepHead>
      ) : (
        <StepHead title="Changes not published" aside={<StatusChip tone="danger" icon={CircleX}>A check failed</StatusChip>}>
          Your report stays live as it was. Change the details and try again, or request a human review.
        </StepHead>
      )}
      {note ? <Said label={stage === "declined" ? "The reviewer's note" : "Your request"}>{note}</Said> : null}
      {changed.length ? (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="me-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <PenLine className="size-3.5" /> You changed
          </span>
          {changed.map((c) => (
            <StatusChip key={c.label} tone="neutral">
              {c.label}
            </StatusChip>
          ))}
        </div>
      ) : null}
      <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
        {correction.results.map((r) => (
          <CheckRow key={r.checkId} name={r.name} result={r} advice={stage === "failed" && !overruled.has(r.checkId)} />
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="outline" asChild>
          <Link href={`/papers/${report.key}`}>
            Open its page <ArrowUpRight />
          </Link>
        </Button>
        <Button variant="outline" onClick={() => setDiscarding(true)}>
          <Trash2 /> Discard the changes
        </Button>
        {stage === "failed" ? (
          <Button variant="outline" onClick={() => setAsking(true)}>
            <ReviewQueueIcon /> Request a human review
          </Button>
        ) : null}
        <Button variant={stage === "review" ? "outline" : "default"} onClick={onEdit}>
          <PenLine /> Edit the changes
        </Button>
      </div>
      {/* Only where a review can be asked for: an address that still names the dialog opens nothing anywhere else. */}
      <ReviewRequestDialog open={asking && stage === "failed"} onClose={() => setAsking(false)} onSend={onRequestReview} />
      <AlertDialog open={discarding} onOpenChange={setDiscarding}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>Your report stays live as it is now. The changes you made are given up.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onDiscard().then(() => toast.success("Changes discarded"), said("The changes couldn't be discarded"))}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
