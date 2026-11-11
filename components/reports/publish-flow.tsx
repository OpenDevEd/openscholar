"use client";

// Publishing a work in Openscholar Reports (plans/publish-reports). Sign the agreement, which reserves the DOI;
// upload the PDF with the byline on it; correct the details read from it; the checks run; activate it, or wait for
// review. Everything shown is read live from Convex (convex/reports/flow.ts), so a reload, another tab, a reviewer's
// word or a changed setting all land on the page by themselves.

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { parseAsBoolean, parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates, useQueryState } from "nuqs";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
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
import { SHOWS, STATUS, StatusFilter, YourReports, stageShown, useStageLabel } from "@/components/reports/your-reports";
import { useChangeLabel, useCheckWords } from "@/components/reports/words";
import { Working } from "@/components/settings/parts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AutoHeight } from "@/components/ui/auto-height";
import { CommunityControl } from "@/components/evidence-libraries/added-papers/community-control";
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
import { AiIcon, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, CircleCheck, CircleX, Copy, CreditCard, FileText, FileUp, Hash, ListChecks, Lock, PenLine, Plus, PublishIcon, ReviewQueueIcon, RotateCcw, ShieldCheck, Tag, Trash2, TriangleAlert, X } from "@/components/icons";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { REPORT_COVER } from "@/lib/papers/cover";
import { fillAgreement } from "@/lib/reports/agreement";
import { drawCover } from "@/lib/reports/draw-cover";
import { CHECK_SAID, RUN_STUCK_MS, REVIEW_TEXT_MAX, SIGNER_NAME_MAX, changesOf, stageOf, type CheckResult, type Metadata } from "@/lib/reports/report";
import { bylineOf } from "@/lib/reports/settings";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { stepBack, withoutKeys } from "@/lib/url-state/step-back";
import { useWorkspaceSlug } from "@/lib/workspaces/href";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";
import { MAX_PDF_BYTES, MAX_PDF_MB } from "@/lib/files/limits";
import { cn, finePointer } from "@/lib/utils";


type Basics = FunctionReturnType<typeof api.reports.settings.forAuthors>;
type Found = NonNullable<FunctionReturnType<typeof api.reports.flow.get>>;
type Report = Extract<Found, { report: unknown }>["report"];
type Starts = FunctionReturnType<typeof api.reports.flow.starts>;
type Terms = NonNullable<FunctionReturnType<typeof api.reports.activation.terms>>;
/** What an activation costs with a promotion code, in US dollars, as Autumn quotes it. */
type Quote = { code: string; price: number; discount: number; total: number };

/** How long a reading or a run may go on before the page offers the step again: either can die with its server. */
const STUCK_MS = RUN_STUCK_MS;

const STEPS: Array<{ id: "prepare" | "agreement" | "doi" | "upload" | "details" | "checks" | "live"; icon: typeof PenLine }> = [
  { id: "prepare", icon: ListChecks },
  { id: "agreement", icon: PenLine },
  { id: "doi", icon: Hash },
  { id: "upload", icon: FileUp },
  { id: "details", icon: FileText },
  { id: "checks", icon: ShieldCheck },
  { id: "live", icon: BadgeCheck },
];
type BackStep = "doi" | "upload" | "details";

/** The trail's last step, Live, and the one before it, the checks. */
const LIVE_AT = STEPS.length - 1;
const CHECKS_AT = STEPS.length - 2;

/** Where the trail stands: the step being done, or past the checks, the outcome. Before a report, preparing or the agreement. */
function placeOf(report: Report | null, preparing: boolean) {
  if (!report) return preparing ? 0 : 1;
  if (report.step === "done") return report.status === "live" ? LIVE_AT : CHECKS_AT;
  return STEPS.findIndex((s) => s.id === report.step);
}

/** A handler for a change that was refused or never arrived: its reason in a toast. */
const said = (otherwise: string) => (error: unknown) => void toast.error(getErrorMessage(error, otherwise));

/** Why a promotion code or a payment was refused, as the server names it, so the page says it in its own language. */
const refusalOf = (error: unknown) => (error instanceof ConvexError ? (error.data as { code?: string; reason?: string } | undefined) : undefined);
const PROMO_REASONS = ["unknownCode", "nothingOff", "codeTooLong"] as const;
const promoReason = (error: unknown) => PROMO_REASONS.find((reason) => reason === refusalOf(error)?.reason);

function copy(text: string, copied: string) {
  void navigator.clipboard.writeText(text).then(() => toast.success(copied));
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
  const t = useTranslations("publishReports.flow");
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
  // What activating the shown report takes, read with it so its screen opens with the card and the price in place.
  const { data: terms } = useProtectedQuery(api.reports.activation.terms, shownKey && shownKey !== "new" ? inWorkspace(workspaceId, { key: shownKey, now }) : "skip");
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
  // Prepare, the page before the agreement, has been read and left for the agreement.
  const [prepared, setPrepared] = useState(false);
  // A link to a report or to the list is its workspace's to open: signing in comes back to it.
  if (signedOut && (view === "reports" || (asked !== null && asked !== "new"))) return <RedirectToSignIn />;
  const ready = basics !== undefined && isLoaded && (signedOut || (counts !== undefined && starts !== undefined && workspaceId !== undefined && (listed ? (list ?? lastList) !== undefined : shownKey === "new" || (found !== undefined && (!found || !("report" in found) || terms !== undefined)) || arriving || opening)));
  // The page's own shell while it loads, as the app's loading frame draws it: its bar is there from the first frame
  // and names nothing until the page knows whether its title sits beside a back arrow, so the title never moves
  // once it shows. The same shell stays mounted when the page arrives, so its card is already laid out and the
  // filters land where they belong at once (a new shell shows them in the card for a moment in Firefox).
  if (!ready || !basics) {
    return (
      <LibraryPageShell icon={null} title="">
        <ListLoading label={t("publish")} />
      </LibraryPageShell>
    );
  }

  const saved = found && "report" in found ? found.report : null;
  // Before its PDF is read, a report's DOI and its upload are two screens of one state, so which shows is the
  // address's: opening the upload is a step forward, and Back from it returns to the DOI.
  // A report back at its DOI with a PDF already attached was sent back there: it shows the DOI.
  const report = saved?.step === "doi" && at === "upload" ? { ...saved, step: "upload" as const } : saved;
  // A new report starts on Prepare, what publishing asks for, then the agreement. A DOI reserved and left, or a
  // signing on its way, goes straight to the agreement.
  const preparing = !report && !prepared && !arriving && !starts?.untouched;
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
      title={listing || missing || closed ? t("publish") : report?.metadata?.title || report?.title || t("newReport")}
      titleAside={report ? <span className="font-mono text-xs text-muted-foreground">{report.key}</span> : undefined}
      // Back to the list, once there is one to go back to.
      backHref={!listing && hasReports ? "/publish?view=reports" : undefined}
      backLabel={t("yourReports")}
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
            <span className={BAR_LABEL}>{t("newReport")}</span>
          </Button>
        ) : undefined
      }
      intro={!listing && !missing && !closed ? <StepTrail report={report} preparing={preparing} onPrepare={() => setPrepared(false)} humanReview={basics.humanReview} workspaceId={workspaceId} onStep={ownStep} onDoi={saved?.step === "doi" && at === "upload" ? () => up("step") : undefined} /> : undefined}
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
            onDiscard={(key) => discard({ workspaceId: workspaceId!, key }).then(() => void toast.success(t("discarded")), said(t("discardFailed")))}
            onNew={basics?.open ? another : undefined}
          />
        </div>
      ) : closed ? (
        <ListEmpty
          icon={PublishIcon}
          description={t(hasReports ? "closedWithReports" : "closedNoReports")}
          action={
            hasReports ? (
              <Button size="sm" variant="outline" onClick={() => go({ view: "reports", report: null, correct: null })}>
                <FileText /> {t("yourReports")}
              </Button>
            ) : undefined
          }
        >
          {t("closedTitle")}
        </ListEmpty>
      ) : missing ? (
        <ListEmpty
          icon={FileText}
          description={elsewhere ? t("elsewhereBody", { name: elsewhere.name }) : t("missingBody")}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {elsewhere ? (
                <Button size="sm" asChild>
                  {/* A plain address: the report's own workspace, whichever this page is in. */}
                  <a href={`${elsewhere.slug ? `/o/${elsewhere.slug}` : ""}/publish?report=${shownKey}${correct ? "&correct=true" : ""}`}>
                    {t("openIn", { name: elsewhere.name })} <ArrowUpRight />
                  </a>
                </Button>
              ) : null}
              {hasReports ? (
                <Button size="sm" variant="outline" onClick={() => go({ view: "reports", report: null, correct: null })}>
                  <FileText /> {t("yourReports")}
                </Button>
              ) : null}
              {elsewhere || !basics.open ? null : (
                <Button size="sm" onClick={another}>
                  <Plus /> {t("newReport")}
                </Button>
              )}
            </div>
          }
        >
          {t(elsewhere ? "elsewhereTitle" : "missingTitle")}
        </ListEmpty>
      ) : (
        <div className="grid grid-cols-1 gap-8 p-4 sm:p-6 @3xl:grid-cols-[minmax(0,1fr)_13rem] @3xl:gap-10">
          {/* Switched off, publishing takes no new report. One already started says why its sidebar item is gone. */}
          {report?.mine && !basics.open && report.status !== "live" ? (
            <p role="status" className="col-span-full flex items-start gap-2.5 rounded-2xl bg-inset px-4 py-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 ink-warning" />
              {t("offNotice")}
            </p>
          ) : null}
          {/* One set of screens for every report: going from one to another, or to a new report's agreement, is a
              change of screen like any other, and what belongs to one report is put away inside (Screens). */}
          <Screens
            preparing={preparing}
            onPrepared={() => setPrepared(true)}
            onUnprepare={() => setPrepared(false)}
            signed={arriving ? fresh.key : null}
            basics={basics}
            report={report}
            starts={starts ?? null}
            terms={terms ?? null}
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
        </div>
      )}
    </LibraryPageShell>
  );
}

/** The one report's screen, chosen from where the report stands. */
function Screens({ preparing, onPrepared, onUnprepare, basics, report, starts, terms, shared, workspaceId, fresh, setFresh, signed, onSigned, onNamed, onAnother, correcting, onUpload, onAttached, onStep, onCorrect, onCorrected }: { /** The page before the agreement is open. */ preparing: boolean; onPrepared: () => void; /** Back to Prepare from the agreement. */ onUnprepare: () => void; basics: Basics; report: Report | null; starts: Starts | null; /** What activating the report takes; null before it has one. */ terms: Terms | null; shared: boolean; workspaceId: Id<"workspaces"> | undefined; fresh: { key: string; step: "doi" | "live" } | null; setFresh: (fresh: { key: string; step: "doi" | "live" } | null) => void; /** The report just signed here, while it is on its way. */ signed: string | null; onSigned: (key: string) => void; /** The report is named in the address from here on. */ onNamed: (key: string) => void; onAnother: () => void; /** A live report's details are open to be corrected. */ correcting: boolean; /** On from the DOI to the upload, a step in the browser's history. */ onUpload: () => void; /** A PDF was attached at the upload. */ onAttached: () => void; /** The report is being sent to a step, which is its own from then on. */ onStep: () => void; onCorrect: () => void; /** The form of changes is left: sent, or given up. */ onCorrected: () => void }) {
  const t = useTranslations("publishReports.flow");
  const goTo = useMutation(api.reports.flow.goTo);
  const saveDetails = useMutation(api.reports.flow.saveDetails);
  const requestReview = useMutation(api.reports.flow.requestReview);
  const activate = useAction(api.reports.activation.activate);
  const addCard = useAction(api.reports.activation.addCard);
  const quote = useAction(api.reports.activation.quote);
  const runChecks = useAction(api.reports.checks.run);
  const requestChangesReview = useMutation(api.reports.flow.requestChangesReview);
  const discardChanges = useMutation(api.reports.flow.discardChanges);
  const typeChanges = useMutation(api.reports.flow.typeChanges).withOptimisticUpdate((store, { key, changes }) => {
    // Given up, what was typed is gone from this page at once: a form opened again before the answer is back starts
    // from the report, never from what was just cancelled.
    if (changes) return;
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
    if (report) void goTo({ ...here, key: report.key, step }).catch(said(t("stepFailed")));
  };
  // A run that has gone on too long is given up on here, so its author can run the checks again.
  const runStuck = usePassed(report?.run ? report.run.at + STUCK_MS : undefined);
  const running = !!report?.run && !runStuck;
  const live = report?.step === "done" && report.status === "live";
  // A first run reads a report at its details; a run on changes reads a live one, which stays live meanwhile.
  const busy = (report?.step === "details" || live) && (starting || (running && !(live && correcting && typing)));
  // A new screen replaces what had the focus, which then falls to the page: its heading takes it instead, so a
  // keyboard carries on from there and a screen reader says where it now is. Not on the page's first screen.
  const shown = useRef(false);
  const toHeading = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    if (!shown.current) {
      shown.current = true;
      return;
    }
    const heading = node.querySelector("h2");
    // Only focus the old screen lost, which has fallen to the page: someone typing elsewhere, in the assistant say, keeps theirs.
    if (!heading || (document.activeElement && document.activeElement !== document.body)) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, []);
  const screen = !report ? (preparing ? "prepare" : "agreement") : !report.mine ? "watching" : busy ? "running" : report.step !== "done" ? report.step : !live ? "checks" : correcting ? "correct" : report.correction ? "changes" : "live";
  return (
    <AutoHeight>
      {/* The first screen comes in too: it follows the page's loading frame, and would otherwise pop in over it. */}
      <AnimatePresence mode="wait">
        <motion.div ref={toHeading} key={`${report?.key ?? "new"}:${screen}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25, ease: EASE }}>
          {!report && preparing ? (
            <Overview series={basics.series.name} onStart={onPrepared} />
          ) : !report ? (
            <AgreementStep
              onBack={onUnprepare}
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
            <UploadStep report={report} workspaceId={workspaceId!} onAttached={onAttached} onBack={() => back("doi")} onNext={report.pdf?.pages !== undefined && report.metadata ? () => back("details") : undefined} />
          ) : report.step === "details" && report.metadata && report.pdf ? (
            <>
              <PdfNotice trouble={report.pdf.trouble} onUpload={() => back("upload")} />
              <DetailsStep
                onBack={() => back("upload")}
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
                    said(t("checksFailed"))(error);
                  } finally {
                    setStarting(false);
                  }
                }}
                onSave={(changes) => void saveDetails({ ...here, key: report.key, changes, pdfAt: report.pdf!.at }).catch(said(t("saveFailed")))}
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
              // As the server decides (convex/reports/checkRuns.ts `finish`): with review off, changes that pass every check go live.
              waits={basics.humanReview}
              onTouched={() => setTyping(true)}
              // Kept as they are typed, so Back, Forward or a reload brings them back. Typed over a report that has
              // changed since, they are not kept, and sending them is refused in words.
              onSave={(changes, since) => void typeChanges({ ...here, key: report.key, since: since!, changes }).catch(said(t("saveFailed")))}
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
                  if (stands === "live") toast.success(t("changesLive"));
                  else if (stands === "review") toast.success(t("changesWithReviewer"));
                } catch (error) {
                  said(t("checksFailed"))(error);
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
                if (typing || report.trying) void typeChanges({ ...here, key: report.key, since: since!, changes: null }).catch(() => undefined);
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
            <LiveReport report={report} fresh={fresh?.key === report.key && fresh.step === "live"} onAnother={basics.open ? onAnother : undefined} onCorrect={onCorrect} />
          ) : (
            <Checks
              rows={(report.results ?? []).map((result) => ({ id: result.checkId, name: result.name, result }))}
              report={report}
              humanReview={basics.humanReview}
              // Said before the report answers: it turns live ahead of this call's own answer, and the live screen
              // plays its moment only if it opens knowing the report was activated here.
              terms={terms}
              onActivate={(pay, code, expect) => {
                onNamed(report.key);
                setFresh({ key: report.key, step: "live" });
                return activate({ ...here, key: report.key, pay, ...(code && { code }), ...(expect !== undefined && { expect }) }).then(
                  (done) => {
                    // The bank asks to confirm the charge on Stripe's page, which comes back here.
                    if ("url" in done) {
                      setFresh(null);
                      window.location.assign(done.url);
                    }
                  },
                  (error: unknown) => {
                    setFresh(null);
                    throw error;
                  },
                );
              }}
              onAddCard={() => addCard({ ...here, key: report.key }).then((url) => window.location.assign(url))}
              onQuote={(code) => quote({ ...here, key: report.key, code }).then((answer) => ({ code: code.trim(), ...answer }))}
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
function StepTrail({ report, preparing, onPrepare, humanReview, workspaceId, onStep, onDoi }: { report: Report | null; /** The page before the agreement is open. */ preparing: boolean; /** Back to it from the agreement. */ onPrepare: () => void; humanReview: boolean; workspaceId: Id<"workspaces"> | undefined; /** The report is being sent to a step, which is its own from then on. */ onStep: () => void; /** Back to the DOI is a step back in the browser's history, when the upload was opened from it. */ onDoi?: () => void }) {
  const reduce = useReducedMotion();
  const t = useTranslations("publishReports.flow");
  const goTo = useMutation(api.reports.flow.goTo);
  const running = report?.step === "details" && !!report.run;
  const place = running ? CHECKS_AT : placeOf(report, preparing);
  const stage = report?.step === "done" ? stageOf(report, humanReview) : null;
  const failed = stage === "failed" || stage === "declined";
  const waiting = stage === "review";
  const canGoBack = !!report && !!workspaceId && report.mine && report.step !== "done" && !running;
  return (
    <div className="px-4 pb-4 pt-5 sm:px-6">
      <ol className="grid grid-cols-7 gap-1 max-sm:flex max-sm:justify-between">
        {STEPS.map((s, i) => {
          const done = i < place || (i === place && place === LIVE_AT);
          const current = i === place && place !== LIVE_AT;
          // Once signed, Prepare and the agreement are done for good: locked and faded, they can't be opened again.
          const sealed = done && (s.id === "agreement" || s.id === "prepare") && !!report;
          const Icon = sealed ? Lock : done ? CircleCheck : current && failed ? CircleX : current && waiting ? ReviewQueueIcon : s.icon;
          // Every step done before the checks can be gone back to, as each step's Back button goes: the DOI, the PDF and
          // the details. The agreement is signed for good. Back at the upload, the details already read are still a step away.
          // Before a report, Prepare is a step back from the agreement.
          const back = !report && s.id === "prepare" && !preparing;
          const clickable = back || (canGoBack && i > 1 && i < CHECKS_AT && (done || (s.id === "details" && report.step === "upload" && !!report.pdf && !!report.metadata)));
          const body = (
            <>
              <Icon className={cn("size-4 shrink-0", sealed ? "text-muted-foreground" : done ? "text-primary" : current ? (failed ? "text-destructive" : "text-primary") : "text-muted-foreground/60")} />
              {/* On a phone only the current step keeps its name; the others are their icons. */}
              <span className={cn("truncate text-xs font-medium", done || current ? "text-foreground" : "text-muted-foreground", !current && "max-sm:sr-only")}>{t(`steps.${s.id}`)}</span>
            </>
          );
          return (
            <li key={s.id} className={cn("min-w-0", current && "max-sm:flex-1")}>
              {clickable ? (
                <button type="button" onClick={() => (back ? onPrepare() : s.id === "doi" && onDoi ? onDoi() : (onStep(), void goTo({ workspaceId: workspaceId!, key: report!.key, step: s.id as BackStep }).catch(said(t("stepFailed")))))} className="flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 text-start transition-colors hover:text-primary">
                  {body}
                </button>
              ) : sealed ? (
                <TooltipHint label={t("steps.sealed")}>
                  <div tabIndex={0} className="flex min-w-0 cursor-default items-center gap-1.5 rounded-md py-1 opacity-50">
                    {body}
                  </div>
                </TooltipHint>
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
        <motion.div className={cn("h-full rounded-full", failed ? "bg-destructive" : "bg-primary")} initial={false} animate={{ width: `${((place + (place === LIVE_AT ? 1 : 0.5)) / STEPS.length) * 100}%` }} transition={reduce ? { duration: 0 } : { duration: 0.5, ease: EASE }} />
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

function AgreementStep({ basics, shared, starts, workspaceId, signed, onSigned, onBack }: { /** Back to Prepare. */ onBack?: () => void; basics: Basics; shared: boolean; /** The workspace's day; null signed out. */ starts: Starts | null; workspaceId: Id<"workspaces"> | undefined; /** The report this signing just made, until its screen opens: the step waits for it as it waited for the signing. */ signed: string | null; onSigned: (key: string) => void }) {
  const { openSignIn } = useClerk();
  const { user } = useUser();
  const t = useTranslations("publishReports.flow");
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
  // The workspace's plan has used up its new reports for the day, or has none: no new report can start, and the page
  // says which and where the plans are. A DOI the person reserved and did nothing with is theirs again by signing,
  // whatever the day has left.
  const blocked = starts && !starts.untouched && starts.perDay !== null && starts.left === 0 ? t(`limit.${starts.kind === "personal" ? "personal" : "workspace"}${starts.perDay === 0 ? "Closed" : ""}`, { count: starts.perDay }) : null;
  return (
    <div>
      <StepHead title={t("agreementTitle", { series: basics.series.name })} aside={<StatusChip tone="neutral">{t("version", { version: agreement.version })}</StatusChip>}>
        {t(shared ? "agreementShared" : "agreementIntro")}
      </StepHead>
      <div lang="en" dir="ltr" className="max-h-[22rem] overflow-y-auto rounded-2xl border border-border-subtle bg-inset/40 px-5" style={{ maskImage: `linear-gradient(to bottom, transparent, black ${EDGE_FADE}px, black calc(100% - ${EDGE_FADE}px), transparent)`, paddingBlock: EDGE_FADE }}>
        <MarkdownContent content={fillAgreement(agreement.text, { name, date: today, byline: bylineOf(basics.series, "…") })} className="text-sm sm:text-sm [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:leading-snug [&_h2]:text-base" />
      </div>
      <div className="mt-5 grid gap-4 sm:max-w-md">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t("signedBy")}</span>
          <Input value={name} maxLength={SIGNER_NAME_MAX} onChange={(e) => setTyped(e.target.value)} autoComplete="name" />
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <Checkbox checked={all} onCheckedChange={(v) => tick({ all: v === true })} className="mt-0.5" />
          <span>{t("signForAll")}</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <Checkbox checked={agreed} onCheckedChange={(v) => tick({ agreed: v === true })} className="mt-0.5" />
          <span>{t("agree")}</span>
        </label>
        {starts?.untouched && starts.untouched !== signed ? (
          // A reload while signing lands here with the DOI already reserved: it is this one, and signing gives it again.
          <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-inset px-4 py-3 text-sm">
            <span className="min-w-0 flex-1 basis-56">
              {t.rich("untouched", { key: starts.untouched, mono: (chunks) => <span className="font-mono">{chunks}</span> })}
            </span>
            <Button size="sm" variant="outline" onClick={() => onSigned(starts.untouched!)}>
              {t("continueWith")} <ArrowUpRight />
            </Button>
          </p>
        ) : null}
        {changed ? (
          <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 ink-warning" />
            {t("agreementChanged")}
          </p>
        ) : null}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        {onBack ? (
          <Button variant="ghost" className="-ms-3 me-auto text-muted-foreground" onClick={onBack}>
            <ArrowLeft /> {t("back")}
          </Button>
        ) : null}
        {blocked ? (
          <>
            <p className="text-sm text-muted-foreground">{blocked}</p>
            <Button variant="outline" asChild>
              <Link href="/pricing">
                {t("seePlans")} <ArrowUpRight />
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
                  said(t("signFailed"))(error);
                }
              })
            }
          >
            <Working busy={busy || !!signed}>
              <span className="flex items-center gap-2">
                <PenLine /> {t("sign")}
              </span>
            </Working>
          </Button>
        ) : (
          <Button onClick={() => openSignIn()}>
            <PenLine /> {t("signIn")}
          </Button>
        )}
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
  const t = useTranslations("publishReports.flow");
  const play = fresh && !reduce;
  const rise = (delay: number) => (play ? { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay, duration: 0.4, ease: EASE } } : {});
  // The prefix and what follows it: a narrow screen breaks the DOI between them, never inside one.
  const slash = report.doi.indexOf("/") + 1;
  const parts = [report.doi.slice(0, slash), report.doi.slice(slash)];
  const LETTERS_AT = 0.55;
  const LETTER = 0.03;
  return (
    <div>
    {/* The DOI itself, centred and held to a readable width; what to do with it runs the page's full width below. */}
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
        {t("doiReserved")}
      </motion.h2>
      <motion.p className="mt-1.5 max-w-md text-sm text-muted-foreground" {...rise(0.4)}>
        {t("doiReservedBody")}
      </motion.p>
      <motion.div className="relative mt-7 w-full max-w-xl overflow-hidden rounded-2xl border border-primary/20 bg-primary/[0.06] px-5 py-6" {...rise(0.45)}>
        <p className="sr-only">{report.doi}</p>
        <p aria-hidden dir="ltr" className="flex flex-wrap justify-center font-mono text-xl font-semibold tracking-tight sm:text-[1.625rem]">
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
            {t(report.registration.crossref ? "reservedCrossref" : "reservedZenodo")}
          </StatusChip>
        </div>
      </motion.div>
    </div>
      {/* What the DOI is for, said where the author first meets it: the line their PDF needs, before they make it. Laid
          out as the upload's page is, which comes next. */}
      <motion.div className="mt-8 border-t border-border-subtle pt-6" {...rise(LETTERS_AT + report.doi.length * LETTER)}>
        <StepHead title={t("bylineFirst")}>{t("bylineFirstBody")}</StepHead>
        <BylineBox byline={report.byline} />
        <StepNav
          next={
            <Button onClick={onNext}>
              {t("nextUpload")} <ArrowRight />
            </Button>
          }
        />
      </motion.div>
    </div>
  );
}

/** The line a report's PDF carries on its cover, to copy. Its DOI is one long word: it breaks anywhere, so on a phone it wraps inside the box and the copy button stays in reach. */
function BylineBox({ byline, className }: { byline: string; className?: string }) {
  const t = useTranslations("publishReports.flow");
  return (
    <div className={cn("flex items-start gap-2 rounded-xl border border-border-subtle bg-inset px-3.5 py-3", className)}>
      <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{byline}</span>
      <TooltipHint label={t("copyByline")}>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t("copyByline")} className="-me-1 text-muted-foreground" onClick={() => copy(byline, t("bylineCopied"))}>
          <Copy />
        </Button>
      </TooltipHint>
    </div>
  );
}

/** Back and on, at the foot of a step: back to the step before, and on to the next one where it is open. */
function StepNav({ onBack, next }: { onBack?: () => void; next?: ReactNode }) {
  const t = useTranslations("publishReports.flow");
  return (
    <div className="mt-6 flex items-center gap-2">
      {onBack ? (
        <Button variant="ghost" className="-ms-3 text-muted-foreground" onClick={onBack}>
          <ArrowLeft /> {t("back")}
        </Button>
      ) : null}
      <div className="ms-auto">{next}</div>
    </div>
  );
}

/** What publishing a report takes, before anything is signed: the steps, and what the author brings to them. */
function Overview({ series, onStart }: { series: string; onStart: () => void }) {
  const t = useTranslations("publishReports.flow.overview");
  const items = [
    { id: "agreement", icon: PenLine },
    { id: "doi", icon: Hash },
    { id: "pdf", icon: FileText },
    { id: "details", icon: ListChecks },
    { id: "checks", icon: ShieldCheck },
    { id: "activate", icon: CreditCard },
  ] as const;
  return (
    <div>
      <StepHead title={t("title", { series })}>{t("intro")}</StepHead>
      <ol className="relative space-y-1">
        {/* One line through the icons: the steps as one road. */}
        <span aria-hidden className="absolute inset-y-5 start-[1.1875rem] w-px bg-border" />
        {items.map(({ id, icon: Icon }) => (
          <li key={id} className="relative flex items-start gap-4 py-2">
            <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl border border-border-subtle bg-background text-primary">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 pt-1">
              <span className="block text-sm font-medium">{t(`${id}.title`)}</span>
              <span className="block text-sm text-muted-foreground">{t(`${id}.body`)}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex justify-end">
        <Button onClick={onStart}>
          {t("start")} <ArrowRight />
        </Button>
      </div>
    </div>
  );
}

/** What a PDF's reading fell short of, said where the author fills in what it left. */
function PdfNotice({ trouble, onUpload }: { trouble: NonNullable<Report["pdf"]>["trouble"]; onUpload: () => void }) {
  const t = useTranslations("publishReports.flow");
  if (trouble !== "textless" && trouble !== "unread") return null;
  return (
    <div role="status" className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-2xl bg-inset px-4 py-3 text-sm">
      <p className="flex min-w-0 flex-1 basis-72 items-start gap-2.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 ink-warning" />
        <span className="min-w-0">
          {t(trouble === "textless" ? "textless" : "unreadPdf")}
        </span>
      </p>
      {trouble === "textless" ? (
        <Button size="sm" variant="outline" className="ms-auto" onClick={onUpload}>
          <FileUp /> {t("uploadAnother")}
        </Button>
      ) : null}
    </div>
  );
}

function UploadStep({ report, workspaceId, onAttached, onBack, onNext }: { report: Report; workspaceId: Id<"workspaces">; /** The PDF is the report's: from here the report itself says where it stands. */ onAttached: () => void; /** Back to the DOI. */ onBack: () => void; /** On to the details already read from this PDF, when there are some. */ onNext?: () => void }) {
  const t = useTranslations("publishReports.flow");
  const format = useFormatter();
  /**
   * A file's size, in megabytes or kilobytes as the reader's language writes them. Counted in 1,024s, as the limit
   * (`MAX_PDF_MB`) is: a PDF just under it never reads as over it.
   */
  const bytes = (n: number) => (n > 1024 * 1024 ? format.number(n / 1024 / 1024, { style: "unit", unit: "megabyte", minimumFractionDigits: 1, maximumFractionDigits: 1 }) : format.number(Math.round(n / 1024), { style: "unit", unit: "kilobyte" }));
  const startUpload = useMutation(api.reports.flow.startUpload);
  const attachPdf = useMutation(api.reports.flow.attachPdf);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  // The file on its way up. Once it's the report's, the report itself says it is being read.
  const [sending, setSending] = useState<File | null>(null);
  const here = { workspaceId, key: report.key };
  const put = async (file: Blob, type: string) => {
    const response = await fetch(await startUpload(here), { method: "POST", headers: { "Content-Type": type }, body: file });
    if (!response.ok) throw new Error(t("uploadLost"));
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
    if (!/\.pdf$/i.test(picked.name)) return void toast.error(t("choosePdf"));
    if (picked.size === 0) return void toast.error(t("emptyFile"));
    if (picked.size > MAX_PDF_BYTES) return void toast.error(t("tooBig", { max: MAX_PDF_MB }));
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
      if (error instanceof TypeError) toast.error(t("offline"));
      else said(t("uploadFailed"))(error);
    } finally {
      setSending(null);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div>
      <StepHead title={t("uploadPdf")}>{t("uploadIntro")}</StepHead>
      <BylineBox byline={report.byline} className="mb-5" />
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
            <span className="max-w-full truncate px-6 text-sm font-medium">{t("uploading", { name: sending.name })}</span>
            <span className="text-xs text-muted-foreground">{bytes(sending.size)}</span>
          </>
        ) : reading ? (
          <>
            <AiIcon working className="size-6 text-primary" />
            <span className="text-sm font-medium">{t("reading")}</span>
            <span className="text-xs text-muted-foreground">{t("readingHint")}</span>
          </>
        ) : (
          <>
            <FileUp className="size-6 text-primary" />
            <span className="text-sm font-medium">{t("drop")}</span>
            <span className="text-xs text-muted-foreground">{t("dropHint", { max: MAX_PDF_MB })}</span>
          </>
        )}
      </button>
      <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void send(e.target.files?.[0])} />
      {report.pdf?.trouble === "unopened" && !busy ? (
        <p role="alert" className="mt-3 flex items-start gap-2 ps-1 text-sm text-destructive">
          <CircleX className="mt-0.5 size-4 shrink-0" />
          {t("unopenedPdf", { name: report.pdf.name })}
        </p>
      ) : stuck ? (
        <p role="alert" className="mt-3 flex items-start gap-2 ps-1 text-sm text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 ink-warning" />
          {t("stuck", { name: report.pdf!.name })}
        </p>
      ) : report.pdf && !busy ? (
        <p className="mt-3 flex items-center gap-2 ps-1 text-xs text-muted-foreground">
          <FileText className="size-3.5" />
          {t("replaces", { name: report.pdf.name })}
        </p>
      ) : null}
      <StepNav
        onBack={busy ? undefined : onBack}
        next={
          onNext && !busy ? (
            <Button onClick={onNext}>
              {t("nextDetails")} <ArrowRight />
            </Button>
          ) : null
        }
      />
    </div>
  );
}

/**
 * One check: running, then its answer. A check that finds something or doesn't says what; a scored one shows its score
 * against its line, the failing side tinted. What arrives after the row is drawn fades in and opens its place.
 */
export function CheckRow({ name, result, advice = true, overruled = false }: { name: string; result?: CheckResult; /** Whether to say what the author can do about a failed check: only where they still can. */ advice?: boolean; /** A reviewer approved the report over this check's answer. */ overruled?: boolean }) {
  const reduce = useReducedMotion();
  const t = useTranslations("publishReports.flow");
  /** What a check says, in the page's language when it's one of the fixed things a check says. */
  const inWords = (words: string | undefined) => {
    const key = (Object.keys(CHECK_SAID) as Array<keyof typeof CHECK_SAID>).find((said) => CHECK_SAID[said] === words);
    return key ? t(`check.said.${key}`) : words;
  };
  const checkWords = useCheckWords();
  const shownName = checkWords.name(name);
  const format = useFormatter();
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
          <span className="block truncate text-sm font-medium">{shownName}</span>
        </span>
        {/* The chip's place is held while the check runs, so the row doesn't shift when it lands. */}
        <span className="flex min-w-[4.75rem] justify-end">
          <AnimatePresence initial={false}>
            {result && tone ? (
              <motion.span key="chip" {...fade}>
                <StatusChip tone={overruled ? "neutral" : tone}>{t(`check.${overruled ? "overruled" : result.pass ? "passed" : result.errored ? "errored" : result.blocking ? "failed" : "flagged"}`)}</StatusChip>
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
                  <span className="min-w-12 shrink-0 text-end text-xs tabular-nums">
                    <span className="font-medium text-foreground/80">{result.answer === "unclear" ? t("check.unclear") : t("check.sure", { percent: format.number(sure / 100, { style: "percent" }) })}</span>
                  </span>
                </div>
              ) : result.evidence ? null : (
                <p className="ms-8 mt-1.5 text-xs/5 text-muted-foreground">{inWords(result.detail)}</p>
              )}
              {asked && result.detail ? <p className="ms-8 mt-1.5 text-xs/5 text-muted-foreground">{inWords(result.detail)}</p> : null}
              {result.evidence ? (
                <a href={result.evidence.url} target="_blank" rel="noopener noreferrer" className="ms-8 mt-2 flex min-w-0 items-center gap-1.5 text-xs/5 text-muted-foreground underline-offset-4 hover:text-primary hover:underline">
                  <span className="shrink-0">{result.evidence.where ? t("check.foundIn", { where: result.evidence.where }) : t("check.foundAs")}</span>
                  <span className="truncate font-medium text-foreground/80">{result.evidence.title}</span>
                  <ArrowUpRight className="size-3 shrink-0" />
                </a>
              ) : null}
              {result.reasoning ? <p className="ms-8 mt-2 text-xs/5 text-muted-foreground">{inWords(result.reasoning)}</p> : null}
              {!result.pass && result.fix && advice ? (
                <p className="ms-8 mt-2 flex items-start gap-2 rounded-xl bg-inset px-3 py-2 text-xs/5">
                  <RotateCcw className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <span className="min-w-0 break-words">{checkWords.fix(result.fix)}</span>
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
function Checks({ rows, report, humanReview, terms, onActivate, onAddCard, onQuote, onFix, onDetails, onRequestReview, onAnother }: { rows: Array<{ id: string; name: string; result?: CheckResult }>; /** None while the checks run. */ report: Report | null; humanReview: boolean; /** What activating takes; null where there is nothing to activate. */ terms?: Terms | null; /** Activates it: free, or paid for once confirmed (`pay`), with a promotion code, and what was shown as due in US dollars. */ onActivate?: (pay: boolean, code?: string, expect?: number) => Promise<void>; /** Off to Stripe's page for saving a card. */ onAddCard?: () => Promise<void>; onQuote?: (code: string) => Promise<Quote>; onFix?: () => void; onDetails?: () => void; onRequestReview?: (comment: string) => Promise<void>; onAnother?: () => void }) {
  const [asking, setAsking] = useAsking();
  const t = useTranslations("publishReports.flow");
  const dollars = useDollars();
  const answered = rows.filter((r) => r.result).length;
  const stage = report ? stageOf(report, humanReview) : null;
  const [activating, start] = useTransition();
  // Only the workspace's admins activate (#1261). A free activation and a paid one both need a saved card; a paid one
  // is confirmed in a dialog first, where a promotion code can lower it.
  const organization = terms?.organization ?? null;
  const admin = terms?.admin ?? true;
  const free = (terms?.free.left ?? 0) > 0;
  const card = terms?.card ?? null;
  const pending = terms?.pending ?? null;
  const price = terms?.price === null || terms?.price === undefined ? null : Math.round(terms.price * 100);
  // Credit on the Stripe balance is taken first, in cents: what's left is what the card pays.
  const credit = Math.round((terms?.credit ?? 0) * 100);
  const [paying, setPaying] = useState(false);
  // The charge's dialog closes when the person stops being an admin while it's open: they can't pay for it any more.
  if (paying && !admin) setPaying(false);
  const [code, setCode] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  // After the bank didn't confirm a payment, its promotion code is quoted again before the dialog opens, so the dialog
  // opens at the price the person was paying. A code that no longer applies leaves the dialog at the full price; a
  // quote that couldn't be had leaves it closed, so a code still good is never dropped from the charge.
  const openPay = () => {
    const again = terms?.refused?.code;
    if (!again || !onQuote) return setPaying(true);
    setQuoting(true);
    onQuote(again)
      .then(
        (quote) => {
          setCode(quote);
          setPaying(true);
        },
        (error: unknown) => {
          if (!promoReason(error)) return said(t("activateFailed"))(error);
          setCode(null);
          setPaying(true);
        },
      )
      .finally(() => setQuoting(false));
  };
  const subtotal = code ? Math.round(code.total * 100) : (price ?? 0);
  const fromCredit = Math.min(credit, subtotal);
  const due = subtotal - fromCredit;
  const activateNow = (pay: boolean, withCode?: string, expect?: number) =>
    start(async () => {
      try {
        await onActivate?.(pay, withCode, expect);
      } catch (error) {
        const reason = promoReason(error);
        if (refusalOf(error)?.code === "BILLING_PAYMENT_DECLINED") toast.error(t("activation.declined"));
        else if (refusalOf(error)?.reason === "noFreeLeft") toast.error(t("activation.noFreeLeft"));
        else if (refusalOf(error)?.reason === "paused") toast.error(t("activation.paused"));
        else if (reason) toast.error(t(`activation.promo.${reason}`, { code: withCode ?? "" }));
        else said(t("activateFailed"))(error);
      }
    });
  /** What Activate takes from the card, beside the word; null when it's free or credit covers it. */
  const amount = free || price === null || price <= credit ? null : dollars(price - credit);
  const head = !report ? (
    <StepHead key="running" title={t("running")} aside={<StatusChip tone="running" icon="tone">{t("ofTotal", { done: answered, total: rows.length })}</StatusChip>}>
      {t("runningHint")}
    </StepHead>
  ) : stage === "ready" && !admin ? (
    <StepHead key="admin" title={t("activation.waitingAdmin")} aside={<StatusChip tone="success" icon={CircleCheck}>{t(report.approved ? "approved" : "passed")}</StatusChip>}>
      {t(report.approved ? "activation.waitingAdminApproved" : "activation.waitingAdminPassed", { organization: organization ?? "" })}
    </StepHead>
  ) : stage === "ready" ? (
    <StepHead key="ready" title={t("ready")} aside={<StatusChip tone="success" icon={CircleCheck}>{t(report.approved ? "approved" : "passed")}</StatusChip>}>
      {t(report.approved ? "readyApproved" : "readyPassed")}
    </StepHead>
  ) : stage === "review" ? (
    <StepHead key="review" title={t("waiting")} aside={<StatusChip tone="running" icon={ReviewQueueIcon}>{t("inReview")}</StatusChip>}>
      {t(rows.some((r) => r.result && !r.result.pass) ? "waitingFlagged" : "waitingPassed")}
    </StepHead>
  ) : stage === "declined" ? (
    <StepHead key="declined" title={t(report.withdrawn ? "withdrawn" : "notPublished")} aside={<StatusChip tone="danger" icon={CircleX}>{t(report.withdrawn ? "withdrawn" : "declined")}</StatusChip>}>
      {t(report.withdrawn ? "withdrawnBody" : "declinedBody")}
    </StepHead>
  ) : (
    <StepHead key="failed" title={t("notYet")} aside={<StatusChip tone="danger" icon={CircleX}>{t("aCheckFailed")}</StatusChip>}>
      {t(report.asked ? "failedAsked" : "failedFix")}
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
      {report?.reviewRequest && stage === "failed" ? <Said label={t("yourRequest")}>{report.reviewRequest.comment || t("noComment")}</Said> : null}
      {report?.note && stage === "declined" ? <Said label={t("reviewerNote")}>{report.note}</Said> : null}
      {terms?.refund && stage !== "live" ? (
        <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <CreditCard className="size-4 shrink-0" />
          {t(terms.refund.done ? "activation.refunded" : "activation.refunding", { amount: dollars(Math.round(terms.refund.amount * 100)) })}
        </p>
      ) : null}
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
              {stage === "ready" && admin && terms ? (
                // An admin's Activate sits in the payment bar, beside the card it's paid with: until there is a card, or
                // while the bank confirms a charge, the bar offers that instead.
                <PaymentLine
                  organization={organization}
                  free={terms.free.left}
                  card={card}
                  credit={credit}
                  price={price}
                  pending={pending}
                  refused={terms.refused !== null}
                  onAddCard={onAddCard}
                  action={
                    terms.paused || (!free && price === null) ? (
                      <TooltipHint label={t(terms.paused ? "activation.paused" : "activation.notForSale")}>
                        <span tabIndex={0}>
                          <ActivateButton label={t("activate")} amount={null} busy={false} disabled onClick={() => {}} />
                        </span>
                      </TooltipHint>
                    ) : (
                      <ActivateButton label={t("activate")} amount={amount} busy={activating || quoting} disabled={false} onClick={free ? () => activateNow(false) : openPay} />
                    )
                  }
                />
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                {stage === "failed" ? (
                  <>
                    {report.asked ? null : (
                      <Button variant="outline" onClick={() => setAsking(true)}>
                        <ReviewQueueIcon /> {t("requestReview")}
                      </Button>
                    )}
                    <Button variant="outline" onClick={onDetails}>
                      <PenLine /> {t("changeDetails")}
                    </Button>
                    <Button onClick={onFix}>
                      <RotateCcw /> {t("uploadNew")}
                    </Button>
                  </>
                ) : (
                  <>
                    {onAnother ? (
                      <Button variant={stage === "declined" ? "default" : stage === "ready" && admin ? "ghost" : "outline"} onClick={onAnother}>
                        <Plus /> {t("publishAnother")}
                      </Button>
                    ) : null}
                    {stage === "ready" && !admin ? (
                      <TooltipHint label={t("activation.onlyAdmin")}>
                        <span tabIndex={0}>
                          <Button disabled>
                            <BadgeCheck /> {t("activate")}
                          </Button>
                        </span>
                      </TooltipHint>
                    ) : stage === "review" ? (
                      <TooltipHint label={t("needsApproval")}>
                        <span tabIndex={0}>
                          <Button disabled>
                            <BadgeCheck /> {t("activate")}
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
      {report && price !== null ? (
        // Asks before the charge: a saved card is charged as soon as it's confirmed, with no page of Stripe's in between.
        <UpgradeConfirmationDialog
          open={paying}
          onOpenChange={(open) => {
            setPaying(open);
            if (!open) setCode(null);
          }}
          title={due === 0 ? t("activation.freeTitle", { key: report.key }) : t("activation.payTitle", { price: dollars(due), key: report.key })}
          description={organization ? t(due === 0 ? "activation.orgCardNothing" : "activation.orgCardCharged", { organization }) : undefined}
          confirmLabel={due === 0 ? t("activate") : t("activation.payConfirm")}
          totalLabel={t("activation.dueNow")}
          labels={{ from: t("activation.doiNow"), to: t("activation.after") }}
          isConfirming={false}
          onConfirm={() => {
            setPaying(false);
            setCode(null);
            activateNow(true, code?.code, due / 100);
          }}
          cardBrand={card?.brand}
          cardLast4={card?.last4}
          preview={{
            currency: "USD",
            immediateChargeCents: due,
            currentPlan: t("activation.reserved"),
            targetPlan: t("activation.live"),
            targetPlanCreditsPerMonth: 0,
            lineItems:
              code || fromCredit > 0
                ? [
                    { description: t("activation.activationLine"), amountCents: code ? Math.round(code.price * 100) : (price ?? 0), currency: "USD" },
                    ...(code ? [{ description: t("activation.codeLine", { code: code.code }), amountCents: -Math.round(code.discount * 100), currency: "USD" }] : []),
                    ...(fromCredit > 0 ? [{ description: t("activation.creditLine"), amountCents: -fromCredit, currency: "USD" }] : []),
                  ]
                : [],
          }}
          extra={onQuote ? <PromoCode applied={code} onApply={setCode} onQuote={onQuote} /> : null}
        />
      ) : null}
    </div>
  );
}

/** Activate, in the payment bar: taller than the buttons around it, its badge in a ring, and what it takes from the card in a segment of its own. */
function ActivateButton({ label, amount, busy, disabled, onClick }: { label: string; amount: string | null; busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <Button size="lg" disabled={disabled || busy} onClick={onClick} className="relative h-11 shrink-0 gap-0 overflow-hidden rounded-xl p-0 text-[15px] font-semibold shadow-sm has-[>svg]:px-0">
      <Working busy={busy}>
        <span className="flex h-11 items-center">
          <span className="flex items-center gap-2.5 ps-2 pe-4">
            <span className="flex size-7 items-center justify-center rounded-full bg-white/25">
              <BadgeCheck className="size-4" />
            </span>
            {label}
          </span>
          {amount === null ? null : (
            <span className="flex h-full items-center border-s border-primary-foreground/25 bg-black/10 px-4 tabular-nums">
              <bdi>{amount}</bdi>
            </span>
          )}
        </span>
      </Working>
    </Button>
  );
}

/** Cents as US dollars in the reader's own format, without cents when there are none: $5, $2.50. */
function useDollars() {
  const format = useFormatter();
  return (cents: number) => format.number(cents / 100, { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 ? 2 : 0 });
}

/**
 * A promotion code for an activation that's paid for, in the charge's dialog: a link until it's wanted, then a field.
 * Autumn quotes the activation with the code, and says when it doesn't know the code or it has been used up.
 */
function PromoCode({ applied, onApply, onQuote }: { applied: Quote | null; onApply: (quote: Quote | null) => void; onQuote: (code: string) => Promise<Quote> }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [wrong, setWrong] = useState<string | null>(null);
  const [checking, check] = useTransition();
  const t = useTranslations("publishReports.flow.activation.promo");
  const apply = () =>
    check(async () => {
      try {
        onApply(await onQuote(typed));
        setWrong(null);
        setTyped("");
      } catch (error) {
        const reason = promoReason(error);
        setWrong(reason ? t(reason, { code: typed.trim() }) : getErrorMessage(error, t("failed")));
      }
    });
  const off = applied && applied.price > 0 ? Math.round((applied.discount / applied.price) * 100) : 0;
  return (
    // Room around it for the buttons' focus rings, which its height animation would clip (WebKit has no clip margin).
    <AutoHeight className="-mx-3 -my-1">
      <div className="px-3 py-1">
        {applied ? (
          <div className="flex items-center gap-2 text-sm">
            <Tag className="size-4 text-muted-foreground" />
            <span className="font-mono font-medium">{applied.code}</span>
            <StatusChip tone="success">{t("off", { percent: off })}</StatusChip>
            <Button variant="ghost" size="icon-sm" className="ms-auto text-muted-foreground" aria-label={t("remove", { code: applied.code })} onClick={() => onApply(null)}>
              <X />
            </Button>
          </div>
        ) : open ? (
          <form
            className="space-y-1.5 p-px"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim()) apply();
            }}
          >
            <div className="flex gap-2">
              <Input
                autoFocus={finePointer()}
                value={typed}
                maxLength={100}
                onChange={(e) => {
                  setTyped(e.target.value);
                  setWrong(null);
                }}
                placeholder={t("label")}
                aria-label={t("label")}
                aria-invalid={!!wrong}
                className="font-mono placeholder:font-sans"
              />
              <Button type="submit" variant="outline" className="shrink-0" disabled={!typed.trim() || checking}>
                {t("apply")}
              </Button>
            </div>
            {wrong ? <p className="text-xs text-destructive">{wrong}</p> : null}
          </form>
        ) : (
          <Button variant="ghost" size="sm" className="-ms-2 text-muted-foreground" onClick={() => setOpen(true)}>
            <Tag /> {t("add")}
          </Button>
        )}
      </div>
    </AutoHeight>
  );
}

/**
 * What activating is paid with, above the Activate button: the workspace's saved card, and whether this activation is
 * free. With no card, the way to add one: Stripe's page for saving a card, which comes back here. A charge the bank
 * asked to confirm says so, with the way back to its page.
 */
function PaymentLine({ organization, free, card, credit, price, pending, refused, onAddCard, action }: { organization: string | null; free: number; card: { brand: string; last4: string } | null; /** Credit on the Stripe balance, in cents. */ credit: number; /** In cents; null while there's no price. */ price: number | null; pending: Terms["pending"]; /** The bank didn't confirm the last payment. */ refused: boolean; onAddCard?: () => Promise<void>; /** Activate, beside the card it's paid with. */ action: ReactNode }) {
  const [saving, save] = useTransition();
  const t = useTranslations("publishReports.flow.activation.card");
  const dollars = useDollars();
  const costs = price === null ? null : organization ? t("costsOrg", { price: dollars(price), organization }) : t("costs", { price: dollars(price) });
  // Off to Stripe's page for saving a card, which comes back here: the card saved there is the one charged from then on.
  const saveCard = () =>
    save(async () => {
      try {
        await onAddCard?.();
      } catch (error) {
        said(t("stripeFailed"))(error);
      }
    });
  return (
    <div className="mb-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-3 rounded-2xl bg-inset/60 py-3 ps-3 pe-3 sm:flex-nowrap">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground">
        <CreditCard className="size-4" />
      </span>
      {/* On a phone the words keep a readable width and the buttons go under them. */}
      <div className="min-w-0 flex-1 basis-48">
        {pending ? (
          <p className="text-sm font-medium">{t("bankAsked")}</p>
        ) : !card && free > 0 ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
            {t("freeTitle")}
            <StatusChip tone="success" icon={CircleCheck}>
              {t("free")}
            </StatusChip>
          </p>
        ) : card ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
            <span className="capitalize">{card.brand}</span>
            {/* ui-rules-allow: dot-separator -- the masked digits of a card number */}
            <span className="tabular-nums">&bull;&bull;&bull;&bull; {card.last4}</span>
            {free > 0 ? (
              <StatusChip tone="success" icon={CircleCheck}>
                {t("free")}
              </StatusChip>
            ) : credit > 0 ? (
              <StatusChip tone="neutral">{t("credit", { amount: dollars(credit) })}</StatusChip>
            ) : null}
          </p>
        ) : (
          <p className="text-sm font-medium">{t("add")}</p>
        )}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {pending
            ? t("goesLive")
            : refused
              ? t("refused")
              : free > 0
                ? t(card ? "freeLeft" : "freeLeftNoCard", { count: free })
                : !card
                  ? (costs ?? t("needed"))
                  : organization
                    ? t("orgCard", { organization })
                    : t("yourCard")}
        </p>
        {/* Where a code goes, said before Activate: the dialog Activate opens takes it, before anything is charged. */}
        {!pending && !refused && free === 0 && price !== null ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Tag className="size-3.5 shrink-0" />
            {t("voucher")}
          </p>
        ) : null}
      </div>
      {pending?.url ? (
        <Button variant="outline" asChild className="ms-auto shrink-0">
          <a href={pending.url}>
            {t("confirm")} <ArrowUpRight />
          </a>
        </Button>
      ) : pending ? null : card || free > 0 ? (
        // A free activation needs no card: Activate is there either way.
        <div className="ms-auto flex shrink-0 items-center gap-2">
          {card ? (
            <Button variant="ghost" size="sm" className="relative text-muted-foreground" disabled={saving} onClick={saveCard}>
              <Working busy={saving}>{t("change")}</Working>
            </Button>
          ) : null}
          {action}
        </div>
      ) : onAddCard ? (
        <Button variant="outline" className="relative ms-auto shrink-0" disabled={saving} onClick={saveCard}>
          <Working busy={saving}>
            <span className="flex items-center gap-2">
              <CreditCard /> {t("addButton")}
            </span>
          </Working>
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A workspace's report as a member who can't change it sees it: where it stands, what the checks said of it, and
 * who can change it. Nothing here acts on the report.
 */
function ReportSeen({ report, humanReview }: { report: Report; humanReview: boolean }) {
  const t = useTranslations("publishReports.flow");
  const stageLabel = useStageLabel();
  const stage = stageOf(report, humanReview);
  const status = STATUS[stage];
  return (
    <div>
      <StepHead title={report.title ?? t("untitled")} aside={<StatusChip tone={status.tone} icon={status.icon}>{stageLabel(stage, report.withdrawn)}</StatusChip>}>
        {report.signer ? t("startedBy", { name: report.signer }) : t("startedBySomeone")}
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
              {t("openPage")} <ArrowUpRight />
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
  const t = useTranslations("publishReports.flow");
  const [comment, setComment] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const [sending, start] = useTransition();
  const send = () =>
    start(async () => {
      try {
        await onSend(comment);
        toast.success(t("sentToReviewer"));
        onClose();
      } catch (error) {
        said(t("requestFailed"))(error);
      }
    });
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !sending && onClose()}>
      <DialogContent
        className="sm:max-w-lg"
        // Typing starts in the box. The dialog puts the focus there itself, so closing it gives the focus back to the
        // button that opened it: a box that took the focus by itself would be what the dialog remembered instead.
        // With a mouse or trackpad only: on touch the dialog keeps the focus, so no keyboard rises as it opens.
        onOpenAutoFocus={(event) => {
          if (!finePointer()) return;
          event.preventDefault();
          box.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("requestReview")}</DialogTitle>
          <DialogDescription>{t("reviewIntro")}</DialogDescription>
        </DialogHeader>
        <Field label={t("reviewQuestion")} counter={`${comment.length} / ${REVIEW_TEXT_MAX}`}>
          {(id) => <Textarea ref={box} id={id} value={comment} onChange={(e) => setComment(e.target.value)} rows={4} maxLength={REVIEW_TEXT_MAX} />}
        </Field>
        <DialogFooter>
          <Button variant="outline" disabled={sending} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button className="relative" disabled={sending} onClick={send}>
            <Working busy={sending}>
              <span className="flex items-center gap-2">
                <ReviewQueueIcon /> {t("sendForReview")}
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
function LiveReport({ report, fresh, onAnother, onCorrect }: { report: Report; fresh: boolean; /** None while publishing is off. */ onAnother?: () => void; onCorrect: () => void }) {
  const reduce = useReducedMotion();
  const t = useTranslations("publishReports.flow");
  const format = useFormatter();
  const tAdded = useTranslations("addedPapers");
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
          {t("liveTitle")}
        </motion.h2>
        <motion.p className="mt-1.5 max-w-md text-sm text-muted-foreground" {...rise(0.55)}>
          {t("liveBody")}
        </motion.p>
      </div>
      <motion.div className="rounded-2xl border border-border-subtle bg-inset/60 p-4" {...rise(0.7)}>
        <div className="flex min-w-0 items-center gap-3">
          <Hash className="size-4 shrink-0 text-primary" />
          <a href={url} target="_blank" rel="noopener noreferrer" dir="ltr" className="min-w-0 flex-1 truncate font-mono text-[0.9375rem] font-medium underline-offset-4 hover:underline">
            doi.org/{report.doi}
          </a>
          <TooltipHint label={t("copyDoi")}>
            <Button variant="ghost" size="icon-sm" aria-label={t("copyDoi")} className="text-muted-foreground" onClick={() => copy(url, t("doiCopied"))}>
              <Copy />
            </Button>
          </TooltipHint>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <RegistrationChips report={report} />
          {/* Green only when every check passed: a report a reviewer approved over one says how many did, plainly. */}
          <StatusChip tone={passed === (report.results?.length ?? 0) ? "success" : "neutral"} icon={ShieldCheck}>
            {t("checksPassed", { passed, total: report.results?.length ?? 0 })}
          </StatusChip>
          {report.correctedAt ? (
            <StatusChip tone="neutral" icon={PenLine}>
              {t("corrected", { date: format.dateTime(report.correctedAt, { day: "numeric", month: "short" }) })}
            </StatusChip>
          ) : null}
        </div>
      </motion.div>
      {/* On a phone the four are two even rows, in place of a ragged wrap; at large text, one column. A label wider than its button wraps and the button grows. */}
      <motion.div className="mt-6 flex flex-wrap justify-end gap-2 max-sm:grid max-sm:grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] max-sm:[&>*]:h-auto max-sm:[&>*]:min-h-9 max-sm:[&>*]:w-full max-sm:[&>*]:whitespace-normal" {...rise(0.8)}>
        {onAnother ? (
          <Button variant="outline" onClick={onAnother}>
            <Plus /> {t("publishAnother")}
          </Button>
        ) : null}
        <Button variant="outline" onClick={onCorrect}>
          <PenLine /> {t("correct")}
        </Button>
        {/* The app's own Add to community list, opened from a named button: a community takes the report by its DOI. */}
        <CommunityControl
          paper={{ id: report.key, title: report.metadata?.title ?? "", doi: report.doi }}
          trigger={(icon) => (
            <Button variant="outline">
              {icon} {tAdded("addToCommunity")}
            </Button>
          )}
        />
        <Button asChild>
          <Link href={`/papers/${report.key}`}>
            {t("openPage")} <ArrowUpRight />
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
  const t = useTranslations("publishReports.flow");
  const changeLabel = useChangeLabel();
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
        <StepHead title={t("changesInReview")} aside={<StatusChip tone="running" icon={ReviewQueueIcon}>{t("inReview")}</StatusChip>}>
          {t(correction.request ? "changesAsked" : again ? "changesAgain" : "changesWait")}
        </StepHead>
      ) : stage === "declined" ? (
        <StepHead title={t("changesDeclined")} aside={<StatusChip tone="danger" icon={CircleX}>{t("declined")}</StatusChip>}>
          {t("changesDeclinedBody")}
        </StepHead>
      ) : (
        <StepHead title={t("changesNotPublished")} aside={<StatusChip tone="danger" icon={CircleX}>{t("aCheckFailed")}</StatusChip>}>
          {t("changesFailedBody")}
        </StepHead>
      )}
      {note ? <Said label={t(stage === "declined" ? "reviewerNote" : "yourRequest")}>{note}</Said> : null}
      {changed.length ? (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="me-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <PenLine className="size-3.5" /> {t("youChanged")}
          </span>
          {changed.map((c) => (
            <StatusChip key={c.label} tone="neutral">
              {changeLabel(c.label)}
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
            {t("openPage")} <ArrowUpRight />
          </Link>
        </Button>
        <Button variant="outline" onClick={() => setDiscarding(true)}>
          <Trash2 /> {t("discardChanges")}
        </Button>
        {stage === "failed" ? (
          <Button variant="outline" onClick={() => setAsking(true)}>
            <ReviewQueueIcon /> {t("requestReview")}
          </Button>
        ) : null}
        <Button variant={stage === "review" ? "outline" : "default"} onClick={onEdit}>
          <PenLine /> {t("editChanges")}
        </Button>
      </div>
      {/* Only where a review can be asked for: an address that still names the dialog opens nothing anywhere else. */}
      <ReviewRequestDialog open={asking && stage === "failed"} onClose={() => setAsking(false)} onSend={onRequestReview} />
      <AlertDialog open={discarding} onOpenChange={setDiscarding}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("discardTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("discardBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("keepThem")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onDiscard().then(() => toast.success(t("changesDiscarded")), said(t("changesDiscardFailed")))}>{t("discard")}</AlertDialogAction>
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
  const t = useTranslations("publishReports.flow");
  const m = report?.metadata;
  const live = report?.step === "done" && report.status === "live";
  const facts: Array<{ id: string; icon: typeof Hash; label: string; href?: string }> = [
    ...(report?.pdf?.pages !== undefined ? [{ id: "pdf", icon: FileText, label: t("pages", { count: report.pdf.pages }) }] : []),
    ...(report ? [{ id: "agreement", icon: PenLine, label: t("agreementVersion", { version: report.agreementVersion }), href: `/publish/agreements/${report.key}` }] : []),
    ...(report?.checksVersion ? [{ id: "checks", icon: ShieldCheck, label: t("checksVersion", { version: report.checksVersion }) }] : []),
  ];
  return (
    // Beside the steps on a wide card; under them on a narrow one, the cover small with its caption next to it.
    <aside className="flex items-start gap-4 @3xl:sticky @3xl:top-24 @3xl:block @3xl:self-start">
      <PaperCover
        className="w-28 shrink-0 @3xl:w-full"
        {...REPORT_COVER}
        title={m?.title || t("yourTitle")}
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
          <p dir="ltr" className={cn("truncate font-mono text-xs", report ? "text-foreground" : "text-muted-foreground")}>{report ? `doi.org/${report.doi}` : t("noDoi")}</p>
        </TooltipHint>
        <p className="mt-0.5 text-xs text-muted-foreground">{basics.series.issn ? t("issn", { issn: basics.series.issn }) : t("issnPending")}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {live ? (
            <StatusChip tone="success" icon={BadgeCheck} className="fade-enter">
              {t("live")}
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
