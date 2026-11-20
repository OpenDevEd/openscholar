"use client";

// Publishing a work in Openscholar Reports (plans/publish-reports). Sign the agreement, which reserves the DOI;
// upload the PDF with the byline on it; correct the details read from it; the checks run; activate it, or wait for
// review. Everything shown is read live from Convex (convex/reports/flow.ts), so a reload, another tab, a reviewer's
// word or a changed setting all land on the page by themselves.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useTransition, type ReactNode, type RefObject, useSyncExternalStore } from "react";
import { CONTACT_EMAIL, CURRENCY_MAIL as SUPPORT_MAIL } from "@/lib/billing/contact";
import { useAction, useConvex, useMutation, useQueries, useQuery } from "convex/react";
import { createPortal } from "react-dom";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { parseAsBoolean, parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates, useQueryState } from "nuqs";
import { useFormatter, useTranslations, useLocale } from "next-intl";
import type { Locale } from "@/i18n/config";
import { copyText } from "@/components/copy-text";
import { toast } from "sonner";
import { ConvexError } from "convex/values";
import { RedirectToSignIn, useAuth, useClerk, useUser } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
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
import { FieldHelp, type HelpKey } from "@/components/reports/field-help";
import { RegistrationChips } from "@/components/reports/registration";
import { SHOWS, STATUS, StatusFilter, YourReports, stageShown, useStageLabel } from "@/components/reports/your-reports";
import { Problem, useProblem } from "@/components/reports/problem";
import { useChangeLabel, useCheckWords } from "@/components/reports/words";
import { Working } from "@/components/settings/parts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AutoHeight } from "@/components/ui/auto-height";
import { SaveControl } from "@/components/library/save-control";
import { Button } from "@/components/ui/button";
import { NextButton } from "@/components/reports/next-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { EASE } from "@/components/ui/opening";
import { EDGE_FADE } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { TooltipHint } from "@/components/ui/tooltip";
import { UpgradeConfirmationDialog } from "@/components/billing/upgrade-confirmation-dialog";
import { AiIcon, ArrowLeft, ArrowUpRight, BadgeCheck, CircleCheck, CircleX, Copy, CreditCard, FileCheck2, FileText, FileUp, Hash, ListChecks, Lock, PenLine, Plus, PublishIcon, ReviewQueueIcon, RotateCcw, ShieldCheck, Tag, Trash2, TriangleAlert, Wallet, X } from "@/components/icons";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { REPORT_COVER } from "@/lib/papers/cover";
import { choosesLicence, fillAgreement } from "@/lib/reports/agreement";
import { LicenceChoice, type LicencePick } from "@/components/reports/licence-choice";
import { ArchiveChoice } from "@/components/reports/archive-choice";
import { useConnectZenodo, useZenodoAccount } from "@/lib/zenodo/account";
import { preloadZenodoMark } from "@/components/icons/zenodo-mark";
import { FileAccessChange, FileAccessChoice } from "@/components/reports/file-access-choice";
import { refusalOr } from "@/components/evidence-libraries/added-papers/add-papers-dialog";
import { StripeIcon } from "@/components/icons/stripe-icon";
import { Bill, PaidBill, PayWithSwitch } from "@/components/reports/payment-choice";
import { WayOnButton, WorkspaceChoice, type WayOn } from "@/components/reports/workspace-choice";
import { useCurrentWorkspace, useWorkspaces, type WorkspaceRow } from "@/components/workspaces/parts";
import { inSentence, useMoney } from "@/lib/hooks/use-money";
import { drawCover } from "@/lib/reports/draw-cover";
import { reportPaper } from "@/lib/reports/report-paper";
import { CHECK_SAID, CHECK_WHERE, sameStudySure, RUN_STUCK_MS, REVIEW_TEXT_MAX, SIGNER_NAME_MAX, DEFAULT_LICENCE, changesOf, fileAccessOf, licenceName, ownLicence, payment, pickedLicence, priceOf, type FileAccess, stageOf, stepsOf, isAuthor, type PayWith, type Prices, type CheckResult, type Licence, type Metadata } from "@/lib/reports/report";
import { bylineOf } from "@/lib/reports/settings";
import { getErrorMessage, useAppToast } from "@/lib/toast/use-app-toast";
import { stepBack, withoutKeys } from "@/lib/url-state/step-back";
import { useWorkspaceSlug, workspaceHref } from "@/lib/workspaces/href";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";
import { MAX_PDF_BYTES, MAX_PDF_MB } from "@/lib/files/limits";
import { cn, finePointer } from "@/lib/utils";


type Basics = FunctionReturnType<typeof api.reports.settings.forAuthors>;
type Found = NonNullable<FunctionReturnType<typeof api.reports.flow.get>>;
type Report = Extract<Found, { report: unknown }>["report"];
type Starts = FunctionReturnType<typeof api.reports.flow.starts>;
type Terms = NonNullable<FunctionReturnType<typeof api.reports.activation.terms>>;
/** What an activation costs with a promotion code, in US dollars, as Autumn quotes it. */
/** A promotion code applied, with the share of what a card pays that Autumn quoted it takes off, 0 to 1. */
type Quote = { code: string; off: number };

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
const refusalOf = (error: unknown) => (error instanceof ConvexError ? (error.data as { code?: string; reason?: string; currency?: string } | undefined) : undefined);
const PROMO_REASONS = ["unknownCode", "nothingOff", "codeTooLong"] as const;
const promoReason = (error: unknown) => PROMO_REASONS.find((reason) => reason === refusalOf(error)?.reason);
/**
 * The report's bill under its cover, from the moment it is signed: what its licence costs, and what that comes to with
 * the way of paying and the code kept with it, and once it is live, what it was paid with. Where the report is activated, the checks' own bar
 * draws it with what is chosen there.
 */
function KeptBill({ report, terms, humanReview, beside }: { report: Report; terms: Terms; humanReview: boolean; beside: HTMLDivElement }) {
  const t = useTranslations("publishReports.flow");
  const stage = stageOf(report, humanReview);
  const openReceipt = useReceipt(report.key);
  // Live, the bill is what was paid, with Stripe's receipt under it, for whoever may see it (its owner and the workspace's admins).
  if (stage === "live") return terms.paid ? createPortal(<PaidBill className="mt-5 border-t border-border-subtle pt-4" licence={licenceName(report.licence)} paid={terms.paid} onReceipt={openReceipt} />, beside) : null;
  // The checks' bar has it, where the report is activated.
  const atBar = report.step === "done" && stage === "ready" && terms.admin && !terms.pending;
  // Declined, nothing is due; a member who can't pay for it isn't shown what it comes to.
  if (stage === "declined" || atBar || !(report.mine || terms.admin)) return null;
  return createPortal(<Bill className="mt-5 border-t border-border-subtle pt-4" licence={licenceName(report.licence)} price={terms.price} funds={terms} owner={terms.organization} payWith={payWithOf(terms)} code={terms.voucher} note={t("payment.later")} />, beside);
}

/** What pays for a report: as kept with it, else the balance while it holds something, else a card. */
const payWithOf = (terms: Pick<Terms, "payWith" | "balance">): PayWith => (terms.balance === 0 ? "card" : (terms.payWith ?? "balance"));

/** A section's name inside a step: the step's own heading is above them all. */
const SECTION = "mb-3 flex items-center gap-1 text-sm font-semibold";


/** Who puts the line on the PDF: its author, on the cover, or Openscholar, on a last page it adds. */
const BYLINE_BY = ["self", "added"] as const;
type BylineBy = (typeof BYLINE_BY)[number];

/** A report's steps as the address names them, in order: the DOI is the address with no step. */
const TRAIL = ["doi", "upload", "details", "checks"] as const;

/** The step of `key`'s report that an address stands at; null for another report's address, or another page's. */
function stepIn(url: URL, key: string) {
  if (url.pathname !== window.location.pathname || url.searchParams.get("report") !== key) return null;
  return TRAIL.find((step) => step === url.searchParams.get("step")) ?? "doi";
}

/** Whether a report can be sent to a step from where it stands, as the server decides (convex/reports/flow.ts `goTo`). */
function opens(report: Report, step: BackStep, humanReview: boolean) {
  // A report whose author asked for a human review waits on that: stepping back to its details would take the
  // request back with it, which the browser's Back must never do. Its own buttons still can.
  if (!report.mine || report.run || (report.step === "done" && (stageOf(report, humanReview) !== "failed" || report.asked))) return false;
  return step !== "details" || (!!report.metadata && report.pdf?.pages !== undefined);
}

type HistoryEntry = { index: number; key: string; url: string | null };
type Navigation = EventTarget & { currentEntry: HistoryEntry | null; entries(): HistoryEntry[]; /** How this load of the page was come to. */ activation?: { navigationType: string | null; from: HistoryEntry | null; entry: HistoryEntry } | null };
/** The browser's history, where it can be asked what its entries are (the Navigation API). */
const historyOf = () => (window as { navigation?: Navigation }).navigation;

/**
 * Whether the browser says when its history moves, and where from (the Navigation API's `currententrychange`). One
 * engine has the API's object and never fires the event, so it is believed only once it has been heard: the page's
 * own first step, or the app's own upkeep of the entry it is on, is enough.
 */
let heard = false;
// What counts is hearing an entry the page itself made or replaced (the app does so soon after every load). One
// engine reports the person's Back and Forward but never those, so its list of entries is wrong and a step pushed
// there would have nothing to tell Back where it came from.
if (typeof window !== "undefined") {
  historyOf()?.addEventListener("currententrychange", (event) => {
    const type = (event as EntryChange).navigationType;
    if (type === "push" || type === "replace") heard = true;
  });
}
const hearsHistory = () => heard && historyOf()?.currentEntry?.url === window.location.href;

/** The browser's own name for the history entry the page is at, which changes as the history moves; none where it isn't said. */
const watchEntry = (wake: () => void) => {
  const navigation = historyOf();
  navigation?.addEventListener("currententrychange", wake);
  return () => navigation?.removeEventListener("currententrychange", wake);
};
const entryKey = () => historyOf()?.currentEntry?.key ?? "";

/** The history entries a signed report was started from, by the browser's key, kept with the tab: a reload doesn't forget them. */
/**
 * A report just signed for another workspace than the page's: its page is another one there, so that it was just
 * signed goes with it for a few seconds. Written as the page is left, read as the next one opens.
 */
let followed: { key: string; until: number } | null = null;
/** As many of the person's workspaces as the agreement offers and reads the day of: the first page, whatever the rail has loaded since. */
const OFFERED = 20;
/** The minute a page's reads of a workspace's day are asked for, so they aren't read again on every draw. */
const thisMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

const STARTED_FROM = "publish:started-from";
const startedFrom = () => {
  try {
    return window.sessionStorage.getItem(STARTED_FROM) ?? "";
  } catch {
    return "";
  }
};
const keepStartedFrom = (key: string) => {
  try {
    window.sessionStorage.setItem(STARTED_FROM, `${startedFrom()} ${key}`.trim());
  } catch {
    // Without the tab's storage the entry is forgotten on a reload, and shows Prepare again.
  }
};
/** Read as the page is drawn, and written only by a signing, which draws it again. */
const unwatched = () => () => undefined;
type EntryChange = Event & { navigationType: string | null; from: HistoryEntry };

/**
 * Back and Forward between a report's steps. Each step is an entry in the browser's history that names it, and where
 * a report stands is the report's own, so a step the browser goes to is one the report is sent to: Back from the
 * details is the details' own Back button. An entry for a step the report can't open again (it passed its checks),
 * or for the one it already shows, is gone past the way the person was going, so no press leaves the screen as it was.
 * After a reload the entries behind belong to the page's earlier load, and Back to one loads the page again: that
 * arrival is settled the same way, once, when the report is in.
 */
let arrived = false;
function useStepHistory(report: Report | null, humanReview: boolean, send: (step: BackStep | "checks") => void) {
  // The browser's history is the outside system: it says where a step came from only through the Navigation API.
  useEffect(() => {
    const navigation = historyOf();
    if (!report || !navigation) return;
    /** The browser came from the entry `from` to the one it is at. */
    const land = (from: HistoryEntry) => {
      const at = navigation.currentEntry;
      if (!from.url || !at) return;
      const was = stepIn(new URL(from.url), report.key);
      const to = stepIn(new URL(window.location.href), report.key);
      // Another report, another page, or the same step with something else opened over it: not a step between steps.
      if (!was || !to || was === to) return;
      // The step on the screen as the browser left it. Before its PDF is the report's, the DOI and the upload are two
      // screens of one state, which the address picks.
      const shown = report.step === "done" ? "checks" : report.step === "doi" && was !== "doi" ? "upload" : report.step;
      // What an entry's step comes to: shown by the address alone, one the report is sent to, or neither.
      const reach = (step: (typeof TRAIL)[number]) => (step === shown ? null : report.step === "doi" && (step === "doi" || step === "upload") ? "shown" : step === "checks" ? (report.reopened && report.step !== "details" ? "sent" : null) : opens(report, step, humanReview) ? "sent" : null);
      const here = reach(to);
      if (here === "shown") return;
      if (here === "sent") return send(to);
      // On past it, the way the person was going, to the first entry that is another screen: in one step, since
      // each entry of an earlier load of the page would load it again.
      const direction = Math.sign(at.index - from.index);
      if (!direction) return;
      const entries = navigation.entries();
      let next = at.index + direction;
      for (let url = entries[next]?.url; url; url = entries[next]?.url) {
        const step = stepIn(new URL(url), report.key);
        if (!step || reach(step)) break;
        next += direction;
      }
      window.history.go(next - at.index);
    };
    // This load of the page was itself a step of Back or Forward, and the page is still on the entry it loaded at.
    const arrival = navigation.activation;
    if (!arrived && arrival?.navigationType === "traverse" && arrival.from && arrival.entry.key === navigation.currentEntry?.key) land(arrival.from);
    arrived = true;
    const onChange = (event: Event) => {
      const { navigationType, from } = event as EntryChange;
      if (navigationType === "traverse") land(from);
    };
    navigation.addEventListener("currententrychange", onChange);
    return () => navigation.removeEventListener("currententrychange", onChange);
  }, [report, humanReview, send]);
}

/** Where the Publish page is, kept in its address so a link, a reload and the back button all land on it. */
const PLACE = {
  view: parseAsStringLiteral(["new", "reports"] as const).withDefault("new"),
  /** The report shown, by its key; "new" for one not started yet. */
  report: parseAsString,
  /** A live report's details open to be corrected. */
  correct: parseAsBoolean.withDefault(false),
  /** The step the address stands at: the agreement before a report has one, then the report's own (`useStepHistory`). */
  step: parseAsStringLiteral(["agreement", "upload", "details", "checks"] as const),
  show: parseAsStringLiteral(SHOWS).withDefault("all"),
  page: parseAsInteger.withDefault(1),
  /** Who adds the byline to the report shown, as chosen on the way to its upload. It is one report's choice: another report starts without one. */
  byline: parseAsStringLiteral(BYLINE_BY),
};

export function PublishFlow() {
  const { isLoaded, isSignedIn } = useAuth();
  const workspaceId = useWorkspace();
  const convex = useConvex();
  const router = useRouter();
  // The person's workspaces, which the agreement offers: read by the rail, and waited for so its choice is there as it opens.
  const workspaces = useWorkspaces();
  const t = useTranslations("publishReports.flow");
  // In an organisation's workspace every member sees its reports, so each row says who signed.
  const shared = useWorkspaceSlug() !== undefined;
  const [{ view, report: named, correct, step: at, show, page }, setPlace] = useQueryStates(PLACE);
  // An address cut off after "report=" names none: it is the page with no report named.
  const asked = named || null;
  // Moving to another report, view or page of the list is a step forward in the browser's history, so Back returns
  // to where the person was. It is another screen, so it opens at its top, as History's and the library's pages do;
  // the browser puts the place back on the way back.
  // What went wrong with something done on this page, said on the screen it was done on, until the page moves on.
  const trouble = useProblem(`${view}:${asked ?? ""}`);
  const go = (next: Partial<{ [K in keyof typeof PLACE]: ReturnType<(typeof PLACE)[K]["parse"]> | null }>) => {
    trouble.say(null);
    void setPlace("report" in next ? { byline: null, ...next } : next, { history: "push", scroll: true });
  };
  // Leaving a screen with its own button is the step back when that step is there (lib/url-state/step-back.ts), so
  // Back afterwards never reopens it; what a link or a reload opened closes in place.
  const up = (...closed: Array<keyof typeof PLACE>) => {
    if (!stepBack(withoutKeys(closed))) void setPlace(Object.fromEntries(closed.map((key) => [key, null])));
  };

  // Asked once for the minute the page opened in, so the count isn't read again on every draw; a report started
  // here changes the count by itself.
  const [now] = useState(thisMinute);
  const basics = useQuery(api.reports.settings.forAuthors, {});
  const { data: counts } = useProtectedQuery(api.reports.flow.counts, inWorkspace(workspaceId, {}));
  // Reports ready in the person's other workspaces, read with the page so their notice is there when it opens.
  const { data: waiting } = useProtectedQuery(api.reports.flow.waitingElsewhere, inWorkspace(workspaceId, {}));
  const { data: starts } = useProtectedQuery(api.reports.flow.starts, inWorkspace(workspaceId, { now }));
  // With no report named the page opens the workspace's reports, and a new report only when it has none. Opened on
  // that new report, it stays on it while it is signed: its own first report must not turn the page into the list
  // before the address names it.
  const bare = asked === null && view !== "reports";
  const [began, setBegan] = useState<typeof workspaceId>(undefined);
  if (bare ? began !== workspaceId && counts?.all === 0 : began !== undefined) setBegan(bare ? workspaceId : undefined);
  // A report signed here took its agreement's place in the history, and the Prepare it was started from is still
  // the entry behind it. Back from its DOI lands there, on a report already started: that entry shows the list
  // from then on, never a second new report nobody asked for. Entries are told apart by the browser's own key.
  const used = useSyncExternalStore(unwatched, startedFrom, () => "");
  const entry = useSyncExternalStore(watchEntry, entryKey, () => "");
  const listed = view === "reports" || (bare && began !== workspaceId && (counts?.all ?? 0) > 0) || (entry !== "" && used.split(" ").includes(entry));
  const shownKey = listed ? null : (asked ?? "new");
  const { data: found } = useProtectedQuery(api.reports.flow.get, shownKey && shownKey !== "new" ? inWorkspace(workspaceId, { key: shownKey }) : "skip");
  // What the shown report costs and what pays for it, read with it so its screen opens with its bill in place.
  const { data: terms } = useProtectedQuery(api.reports.activation.terms, shownKey && shownKey !== "new" ? inWorkspace(workspaceId, { key: shownKey }) : "skip");
  // A charge left under way by an action that died stops holding the report once its time is up.
  const chargeOver = usePassed(terms?.paying?.until ?? undefined);
  // With no report named, the list is read along with the counts that decide it shows, so it lands with them instead of a
  // round trip later.
  const { data: list } = useProtectedQuery(api.reports.flow.page, listed || bare ? inWorkspace(workspaceId, { page, ...(stageShown(show) && { show: stageShown(show) }) }) : "skip");
  // A list page keeps showing while the next one is read, so paging never empties the card.
  const [lastList, setLastList] = useState(list);
  if (list && list !== lastList) setLastList(list);

  const discard = useMutation(api.reports.flow.discard);
  // Said at once, before the answer is back: the screen follows the press, and a second press of Back or Forward
  // right behind it starts from where the first one led.
  const goTo = useMutation(api.reports.flow.goTo).withOptimisticUpdate((store, { key, step }) => {
    for (const { args, value } of store.getAllQueries(api.reports.flow.get)) {
      if (!value || !("report" in value) || value.report.key !== key) continue;
      // Ready to activate, waiting for a reviewer, or failed with its author asking for one, it can go back to its checks
      // as they were (convex/reports/flow.ts `goTo`).
      const stage = value.report.step === "done" ? stageOf(value.report, basics?.humanReview ?? false) : null;
      const waiting = stage === "ready" || stage === "review" || (stage === "failed" && value.report.asked === true);
      store.setQuery(api.reports.flow.get, args, { ...value, report: { ...value.report, step, reopened: value.report.reopened || waiting } });
    }
  });
  const backToChecks = useMutation(api.reports.flow.backToChecks).withOptimisticUpdate((store, { key }) => {
    for (const { args, value } of store.getAllQueries(api.reports.flow.get)) {
      if (value && "report" in value && value.report.key === key) store.setQuery(api.reports.flow.get, args, { ...value, report: { ...value.report, step: "done", reopened: false } });
    }
  });
  const saved = found && "report" in found ? found.report : null;
  // The details form open now: an edit it still holds is saved before the report moves, so the move never leaves it behind.
  const form = useRef<{ flush: () => void }>(null);
  // The place under the cover, beside the steps on a wide page, where a step shows what it is working out: the element
  // itself, given by its ref, so the step draws into it.
  const [beside, setBeside] = useState<HTMLDivElement | null>(null);
  const send = (step: BackStep | "checks") => void (saved && workspaceId && (form.current?.flush(), step === "checks" ? backToChecks({ workspaceId, key: saved.key }) : goTo({ workspaceId, key: saved.key, step })).catch(trouble.failed(t("stepFailed"))));
  useStepHistory(saved, basics?.humanReview ?? false, send);
  // What just happened here and now, signing or activating: only then does its step play its moment. A step opened
  // any other way is already settled.
  const [fresh, setFresh] = useState<{ key: string; step: "doi" | "live" } | null>(() => (followed && followed.key === asked && Date.now() < followed.until ? { key: followed.key, step: "doi" } : null));
  if (listed && fresh) setFresh(null);
  // A report signed for another of the person's workspaces is that workspace's, and so is its page: they go with it,
  // as with anything moved to one. What its page reads first is read before leaving and held while the page changes,
  // so it opens on the report's DOI and not on the page's loading frame.
  const follow = async (to: WorkspaceRow, key: string) => {
    const at = { workspaceId: to.workspaceId };
    const reads = [
      to.slug ? convex.watchQuery(api.workspaces.queries.bySlug, { slug: to.slug }) : convex.watchQuery(api.workspaces.queries.personal, {}),
      convex.watchQuery(api.reports.settings.forAuthors, {}),
      convex.watchQuery(api.reports.flow.counts, at),
      convex.watchQuery(api.reports.flow.waitingElsewhere, at),
      convex.watchQuery(api.reports.flow.starts, { ...at, now: thisMinute() }),
      // The next page asks for the minute it opens in, which is the next one when the move crosses it.
      convex.watchQuery(api.reports.flow.starts, { ...at, now: thisMinute() + 60_000 }),
      convex.watchQuery(api.reports.flow.get, { ...at, key }),
      convex.watchQuery(api.reports.activation.terms, { ...at, key }),
    ];
    const read = (watch: (typeof reads)[number]) => {
      try {
        return watch.localQueryResult() !== undefined;
      } catch {
        // A read that fails is the next page's to say.
        return true;
      }
    };
    const all = Promise.all(
      reads.map(
        (watch) =>
          new Promise<void>((done) => {
            const stop = watch.onUpdate(() => void (read(watch) && done()));
            if (read(watch)) done();
            // Let go once the next page has had time to take the read up.
            setTimeout(stop, 15_000);
          }),
      ),
    );
    // ponytail: a read slower than four seconds is left to the next page, which then shows its loading frame.
    await Promise.race([all, new Promise((done) => setTimeout(done, 4_000))]);
    followed = { key, until: Date.now() + 15_000 };
    router.replace(`${workspaceHref(to.slug, "/publish")}?report=${key}`);
  };
  // Just signed, its report is still on its way: the agreement stays up until it is here, and the page never falls
  // back to its loading frame in between (that would start the screens anew, and the DOI's moment with them).
  const arriving = !listed && found === undefined && fresh?.step === "doi" && fresh.key === shownKey;
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
  const ready = basics !== undefined && isLoaded && (signedOut || (counts !== undefined && waiting !== undefined && starts !== undefined && workspaceId !== undefined && (workspaces.list !== undefined || shownKey !== "new") && (listed ? (list ?? lastList) !== undefined : shownKey === "new" || (found !== undefined && (!found || !("report" in found) || terms !== undefined)) || arriving || opening)));
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

  // Before its PDF is read, a report's DOI and its upload are two screens of one state, so which shows is the
  // address's: opening the upload is a step forward, and Back from it returns to the DOI. Any other step an
  // address names is only a name: the report shows where it stands.
  // A report back at its DOI with a PDF already attached was sent back there: it shows the DOI.
  const report = saved?.step === "doi" && at === "upload" ? { ...saved, step: "upload" as const } : saved;
  // Every new report starts on Prepare, what publishing asks for, then the agreement: a step forward in the
  // browser's history, so Back from the agreement is Prepare. A signing on its way stays on the agreement.
  const preparing = !report && at !== "agreement" && !arriving;
  // On to a report's next step: a step forward in the browser's history. Asked for when the work that leads there
  // is done (a PDF sent, the checks run), which can be after the person has left for another report: then nothing.
  const stepOn = (step: Exclude<(typeof TRAIL)[number], "doi">) => {
    setFresh(null);
    const from = saved && stepIn(new URL(window.location.href), saved.key);
    if (!from || from === step) return;
    // The upload is the address's alone. The steps after it are the report's, and Back between them needs the
    // browser to say where a step came from: without that the upload's step is taken back as the report moves on,
    // so Back never lands on a step that shows the same screen again.
    if (step === "upload" || hearsHistory()) {
      // The entry being left is first named for the screen it showed, so Back from the next step returns to that
      // screen: a report opened from the list at its upload has an address that names no step.
      const shown = report ? (report.step === "done" ? "checks" : report.step) : from;
      const named = shown !== from && shown !== step && hearsHistory() ? setPlace({ step: shown === "doi" ? null : shown }) : Promise.resolve();
      void named.then(() => go({ step }));
    } else if (from !== "doi") up("step");
  };
  // To a step the trail or a screen's own button names. Back is the browser's own step back when the entry behind
  // is that step, and the history then sends the report there; a step opened by a link or a reload moves in place.
  const toStep = (step: BackStep | "checks") => {
    if (!saved || !report) return;
    setFresh(null);
    if (TRAIL.indexOf(step) > TRAIL.indexOf(report.step === "done" ? "checks" : report.step)) {
      send(step);
      return stepOn(step as "upload" | "details" | "checks");
    }
    // A step back the address alone makes, or one the history then sends the report to (useStepHistory).
    // Only where the history will send the report there itself (it won't for one a review was asked for, which Back
    // must leave alone): otherwise this button's own press sends it, in place.
    if (step === "checks") return;
    if ((saved.step === step || (hearsHistory() && opens(saved, step, basics.humanReview))) && stepBack((behind) => stepIn(behind, saved.key) === step, (between) => stepIn(between, saved.key) !== null)) return;
    if (saved.step !== step) send(step);
    void setPlace({ step: step === "doi" ? null : step });
  };
  const elsewhere = found && "elsewhere" in found ? found.elsewhere : null;
  const missing = !listing && shownKey !== "new" && !report && !arriving;
  const another = () => {
    setFresh(null);
    go({ view: null, report: "new", correct: null, step: null });
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
      intro={!listing && !missing && !closed ? <StepTrail report={report} preparing={preparing} onPrepare={() => up("step")} humanReview={basics.humanReview} paying={!!terms?.paying && !chargeOver} onStep={toStep} /> : undefined}
    >
      {listing ? (
        <div className={cn("transition-opacity", (!list || opening) && "opacity-60")} aria-busy={!list || opening || undefined} inert={opening || undefined}>
          <WaitingElsewhere waiting={waiting?.first ?? null} className="px-4 pt-4 sm:px-6" />
          <Problem className="px-4 pt-4 sm:px-6">{trouble.problem}</Problem>
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
            onDiscard={(key) => (trouble.say(null), discard({ workspaceId: workspaceId!, key }).then(() => void toast.success(t("discarded")), trouble.failed(t("discardFailed"))))}
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
          {preparing ? <WaitingElsewhere waiting={waiting?.first ?? null} className="col-span-full" /> : null}
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
            onPrepared={() => go({ step: "agreement" })}
            onUnprepare={() => up("step")}
            signed={arriving ? fresh.key : null}
            basics={basics}
            report={report}
            starts={starts ?? null}
            terms={terms ?? null}
            workspaceId={workspaceId}
            fresh={fresh}
            setFresh={setFresh}
            onSigned={(key, into) => {
              const navigation = hearsHistory() ? historyOf() : undefined;
              const behind = navigation?.entries()[(navigation.currentEntry?.index ?? 0) - 1];
              if (behind?.url && withoutKeys(["step"])(new URL(behind.url))) keepStartedFrom(behind.key);
              if (into) void follow(into, key);
              else void setPlace({ report: key, step: null, byline: null });
            }}
            onAnother={another}
            correcting={correct}
            onStep={toStep}
            onMoved={stepOn}
            form={form}
            beside={beside}
            trouble={trouble}
            onCorrect={() => {
              setFresh(null);
              go({ correct: true });
            }}
            onCorrected={() => up("correct")}
          />
          <ReportCover basics={basics} report={report} slot={setBeside} />
          {/* The report's bill stays under its cover from signing until it is live. */}
          {report && terms && beside ? <KeptBill report={report} terms={terms} humanReview={basics.humanReview} beside={beside} /> : null}
        </div>
      )}
    </LibraryPageShell>
  );
}

/**
 * Reports ready in another of the person's workspaces, said where they are looking: each workspace's Publish lists
 * only its own. One workspace at a time, the first that holds some; the next shows once these are activated.
 */
function WaitingElsewhere({ waiting, className }: { waiting: { name: string; slug: string | null; ready: number } | null; className?: string }) {
  const t = useTranslations("publishReports.flow");
  if (!waiting) return null;
  const { name, slug, ready } = waiting;
  return (
    <div className={className}>
      <p role="status" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl bg-inset px-4 py-3 text-sm">
        <span className="flex min-w-0 items-start gap-2.5">
          <PublishIcon className="mt-0.5 size-4 shrink-0 text-primary" />
          {slug ? t("waitingIn", { count: ready, name }) : t("waitingOwn", { count: ready })}
        </span>
        <Button size="sm" variant="outline" asChild>
          {/* A plain address: the other workspace's own reports, the ready ones. */}
          <a href={`${slug ? `/o/${slug}` : ""}/publish?view=reports&show=ready`}>
            {t("waitingOpen", { count: ready })} <ArrowUpRight />
          </a>
        </Button>
      </p>
    </div>
  );
}

/** The one report's screen, chosen from where the report stands. */
function Screens({ form, beside, preparing, onPrepared, onUnprepare, basics, report, starts, terms, workspaceId, fresh, setFresh, signed, onSigned, onAnother, correcting, onStep, onMoved, onCorrect, onCorrected, trouble }: { /** Where the details form lets the page save an edit it still holds. */ form: RefObject<{ flush: () => void } | null>; /** The place under the cover, on a wide page. */ beside: HTMLDivElement | null; /** What went wrong on the screen shown, said at its top. */ trouble: ReturnType<typeof useProblem>; /** The page before the agreement is open. */ preparing: boolean; onPrepared: () => void; /** Back to Prepare from the agreement. */ onUnprepare: () => void; basics: Basics; report: Report | null; starts: Starts | null; /** What activating the report takes; null before it has one. */ terms: Terms | null; workspaceId: Id<"workspaces"> | undefined; fresh: { key: string; step: "doi" | "live" } | null; setFresh: (fresh: { key: string; step: "doi" | "live" } | null) => void; /** The report just signed here, while it is on its way. */ signed: string | null; /** `into` is the workspace it was signed for, when that isn't the page's. */ onSigned: (key: string, into?: WorkspaceRow) => void; onAnother: () => void; /** A live report's details are open to be corrected. */ correcting: boolean; /** To a step already done, on to the details already read, or back to the checks it left. */ onStep: (step: BackStep | "checks") => void; /** The report is on its way to its next step: from the DOI to the upload, to its details with its PDF sent, to its checks once they have run. */ onMoved: (step: "upload" | "details" | "checks") => void; onCorrect: () => void; /** The form of changes is left: sent, or given up. */ onCorrected: () => void }) {
  const t = useTranslations("publishReports.flow");
  const locale = useLocale() as Locale;
  const readAgain = useMutation(api.reports.flow.readAgain);
  const saveDetails = useMutation(api.reports.flow.saveDetails);
  const requestReview = useMutation(api.reports.flow.requestReview);
  const activate = useAction(api.reports.activation.activate);
  const quoteCode = useAction(api.reports.activation.quoteCode);
  const cancelPayment = useAction(api.reports.activation.cancelPayment);
  // Said at once: the bill follows the press, before the server has kept the choice.
  const choosePayment = useMutation(api.reports.flow.choosePayment).withOptimisticUpdate((store, { key, payWith, voucher }) => {
    for (const { args, value } of store.getAllQueries(api.reports.activation.terms)) {
      if (value && args.key === key) store.setQuery(api.reports.activation.terms, args, { ...value, ...(payWith && { payWith }), ...(voucher !== undefined && { voucher }) });
    }
  });
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
    // A screen that changed without a press here, as when the report went live from another tab, opens at its top
    // too: left where the page was scrolled, its heading sat under the page's bar.
    // The bars fixed at the top of the page (the notice, the phone's header, the page's own) cover about this much.
    if (window.scrollY > 0 && node.getBoundingClientRect().top < 160) window.scrollTo({ top: 0 });
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
          <Problem className="pb-4">{trouble.problem}</Problem>
          {!report && preparing ? (
            <Overview series={basics.series.name} reviewed={basics.humanReview} prices={basics.prices} balance={starts ? starts.balance : 0} onStart={onPrepared} />
          ) : !report ? (
            <AgreementStep
              onBack={onUnprepare}
              beside={beside}
              basics={basics}
              starts={starts}
              workspaceId={workspaceId}
              signed={signed}
              onSigned={(key, into) => {
                // A report of another workspace opens on its own page there, which is told it was just signed.
                if (!into) setFresh({ key, step: "doi" });
                // In place of the unsigned page, so going back never lands on an agreement that starts a second report.
                onSigned(key, into);
              }}
            />
          ) : !report.mine ? (
            <ReportSeen report={report} humanReview={basics.humanReview} />
          ) : busy ? (
            <Checks rows={basics.checks.map((check) => ({ id: check.id, name: check.name, result: report.run?.results.find((result) => result.checkId === check.id) }))} report={null} humanReview={basics.humanReview} />
          ) : report.step === "doi" ? (
            <DoiStep report={report} fresh={fresh?.key === report.key && fresh.step === "doi"} onNext={() => onMoved("upload")} />
          ) : report.step === "upload" ? (
            <UploadStep report={report} workspaceId={workspaceId!} onAttached={() => onMoved("details")} onBack={() => onStep("doi")} onNext={report.pdf?.pages !== undefined && report.metadata ? () => onStep("details") : undefined} />
          ) : report.step === "details" && report.metadata && report.pdf ? (
            <>
              <PdfNotice trouble={report.pdf.trouble} lineAdded={report.pdf.bylineBy === "added" && !report.pdf.lacksByline} onUpload={() => onStep("upload")} />
              {report.pdf.kept ? <KeptNotice onReadAgain={() => readAgain({ ...here, key: report.key })} /> : null}
              <DetailsStep
                onBack={() => onStep("upload")}
                ref={form}
                onReturn={report.reopened ? () => onStep("checks") : undefined}
                writing={report.pdf?.trouble === "textless" ? undefined : { key: report.key, workspaceId: workspaceId! }}
                registrars={report.registration}
                unread={report.pdf.trouble !== undefined}
                // The details of another PDF are another form.
                key={report.pdf.at}
                initial={report.metadata}
                onRun={async (metadata: Metadata) => {
                  toTop();
                  trouble.say(null);
                  setStarting(true);
                  try {
                    await runChecks({ ...here, key: report.key, metadata, from: { pdfAt: report.pdf!.at }, locale });
                    onMoved("checks");
                  } catch (error) {
                    // The form comes back at its top, which is where this is said.
                    trouble.failed(t("checksFailed"))(error);
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
              writing={report.pdf?.trouble === "textless" ? undefined : { key: report.key, workspaceId: workspaceId! }}
              registrars={report.registration}
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
                trouble.say(null);
                setStarting(true);
                try {
                  const stands = await runChecks({ ...here, key: report.key, metadata, from: { changesSince: since! }, locale });
                  // Live or kept for a reviewer, the changes are with the report now: the form closes on where they stand.
                  setAttempt(null);
                  onCorrected();
                  if (stands === "live") toast.success(t("changesLive"));
                  else if (stands === "review") toast.success(t("changesWithReviewer"));
                } catch (error) {
                  trouble.failed(t("checksFailed"))(error);
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
            <LiveReport report={report} series={basics.series} fresh={fresh?.key === report.key && fresh.step === "live"} />
          ) : (
            <Checks
              beside={beside}
              rows={(report.results ?? []).map((result) => ({ id: result.checkId, name: result.name, result }))}
              report={report}
              humanReview={basics.humanReview}
              // Said before the report answers: it turns live ahead of this call's own answer, and the live screen
              // plays its moment only if it opens knowing the report was activated here.
              terms={terms}
              onActivate={(payWith, code, price, expect, otherCard) => {
                setFresh({ key: report.key, step: "live" });
                return activate({ ...here, key: report.key, payWith, ...(code && { code }), price, expect, locale, card: terms?.card?.last4 ?? null, ...(otherCard && { otherCard }) }).then(
                  (done) => {
                    // The payment is made on Stripe's page, or confirmed at the bank: both come back here.
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
              onChoose={(choice) => void choosePayment({ ...here, key: report.key, ...choice }).catch(said(t("saveFailed")))}
              onQuote={(code, amount) => quoteCode({ ...here, code, amount }).then(({ off }) => ({ code: code.trim(), off }))}
              onCancelPayment={() => cancelPayment({ ...here, key: report.key }).then(() => undefined)}
              onFix={() => onStep("upload")}
              onDetails={() => onStep("details")}
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

/**
 * The six steps as one track that fills as the report moves on. Steps already done can be gone back to until the
 * report is live, as the server allows (convex/reports/flow.ts `goTo`), and one taken back from its checks with
 * nothing changed can return to them. A step that can't be opened is locked and faded, and says why.
 */
function StepTrail({ report, preparing, onPrepare, humanReview, paying, onStep }: { report: Report | null; /** The page before the agreement is open. */ preparing: boolean; /** Back to it from the agreement. */ onPrepare: () => void; humanReview: boolean; /** Its payment is going through. */ paying: boolean; /** To a step already done, on to the details already read, or back to the checks it left. */ onStep: (step: BackStep | "checks") => void }) {
  const reduce = useReducedMotion();
  const t = useTranslations("publishReports.flow");
  const running = report?.step === "details" && !!report.run;
  const place = running ? CHECKS_AT : placeOf(report, preparing);
  const stage = report?.step === "done" ? stageOf(report, humanReview) : null;
  const failed = stage === "failed" || stage === "declined";
  const waiting = stage === "review";
  // Why the steps already done stay shut, said on each of them.
  const shut = !report
    ? null
    : !report.mine
      ? t("steps.notYours")
      : running
        ? t("steps.running")
        : paying
          ? t("steps.paying")
          : stage === "live"
            ? t("steps.liveNow")
            : stage === "declined" && report.activatedAt !== undefined
              ? t("steps.closed")
              : null;
  const canGoBack = !!report && !shut;
  // Not from the details: the form keeps an edit a moment before saving it, and its own button returns once nothing is typed.
  const returns = !!report && !shut && report.reopened && report.step !== "done" && report.step !== "details";
  return (
    <div className="px-4 pb-4 pt-5 sm:px-6">
      <ol className="grid grid-cols-7 gap-1 max-sm:flex max-sm:justify-between">
        {STEPS.map((s, i) => {
          const done = i < place || (i === place && place === LIVE_AT);
          const current = i === place && place !== LIVE_AT;
          // Once signed, Prepare and the agreement are done for good: they can't be opened again.
          const sealed = done && (s.id === "agreement" || s.id === "prepare") && !!report;
          // A step done that can't be opened, and why: signed for good, or one that could be gone back to (the DOI, the
          // PDF, the details) while something shuts it. Every one of them looks the same, locked and faded, with its
          // reason on it: a lock that only a hover told apart from an open step read as a broken link.
          const blocked = sealed ? t("steps.sealed") : shut && done && i > 1 && i < CHECKS_AT ? shut : null;
          const Icon = blocked ? Lock : done ? CircleCheck : current && failed ? CircleX : current && waiting ? ReviewQueueIcon : s.icon;
          // Every step done before the checks can be gone back to, as each step's Back button goes: the DOI, the PDF and
          // the details. The agreement is signed for good. Back at the upload, the details already read are still a step away.
          // Before a report, Prepare is a step back from the agreement.
          const back = !report && s.id === "prepare" && !preparing;
          const clickable = back || (returns && i === CHECKS_AT) || (canGoBack && i > 1 && i < CHECKS_AT && (done || (s.id === "details" && report.step === "upload" && report.pdf?.pages !== undefined && !!report.metadata)));
          const body = (
            <>
              <Icon className={cn("size-4 shrink-0", blocked ? "text-muted-foreground" : done ? "text-primary" : current ? (failed ? "text-destructive" : "text-primary") : "text-muted-foreground/60")} />
              {/* On a phone only the current step keeps its name; the others are their icons. */}
              <span className={cn("truncate text-xs font-medium", done || current ? "text-foreground" : "text-muted-foreground", !current && "max-sm:sr-only")}>{t(`steps.${s.id}`)}</span>
            </>
          );
          return (
            <li key={s.id} className={cn("min-w-0", current && "max-sm:flex-1")}>
              {clickable ? (
                <button type="button" onClick={() => (back ? onPrepare() : onStep(s.id as BackStep | "checks"))} className="flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 text-start transition-colors hover:text-primary">
                  {body}
                </button>
              ) : blocked ? (
                <TooltipHint label={blocked}>
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

function StepHead({ title, aside, help, children }: { title: string; aside?: ReactNode; /** The "?" beside the title, for a step whose words people may not know. */ help?: HelpKey; children?: ReactNode }) {
  return (
    <div className="mb-5 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1 text-lg font-semibold tracking-tight">
          {title}
          {help ? <FieldHelp field={help} /> : null}
        </h2>
        {aside}
      </div>
      {children ? <p className="max-w-xl text-sm text-muted-foreground">{children}</p> : null}
    </div>
  );
}

/**
 * The agreement's confirmation as last ticked in this tab, for the agreement as it then read. Its own key: a tick
 * saved under the old one agreed for the signer alone, and must never count for their co-authors.
 */
const TICKS = "publish:agreement-tick";
type Ticks = { version: number; agreed: boolean };
function keptTicks(version: number): Ticks | null {
  try {
    const kept = JSON.parse(window.sessionStorage.getItem(TICKS) ?? "null") as Ticks | null;
    return kept && kept.version === version && typeof kept.agreed === "boolean" ? { version, agreed: kept.agreed } : null;
  } catch {
    return null;
  }
}
function keepTicks(ticks: Ticks | null) {
  try {
    if (ticks) window.sessionStorage.setItem(TICKS, JSON.stringify(ticks));
    else window.sessionStorage.removeItem(TICKS);
  } catch {
    // Without the tab's storage the ticks are made again after signing in.
  }
}

function AgreementStep({ basics, starts: here, workspaceId: pageWorkspace, signed, onSigned, onBack, beside }: { /** The place under the cover, on a wide page: the bill goes there. */ beside: HTMLDivElement | null; /** Back to Prepare. */ onBack?: () => void; basics: Basics; /** The page's workspace's day; null signed out. */ starts: Starts | null; workspaceId: Id<"workspaces"> | undefined; /** The report this signing just made, until its screen opens: the step waits for it as it waited for the signing. */ signed: string | null; /** `into` is the workspace it was signed for, when that isn't the page's. */ onSigned: (key: string, into?: WorkspaceRow) => void }) {
  const { openSignIn } = useClerk();
  const { user } = useUser();
  const t = useTranslations("publishReports.flow");
  const { problem, say, failed } = useProblem();
  const sign = useMutation(api.reports.flow.sign);
  const locale = useLocale();
  // The workspace the report is to belong to: the page's, until another of the person's is picked here. What the
  // others' days and balances hold is read with the step, so picking one changes the payment at once.
  // The first page of them, with the page's own, which someone in more than a page of them may be past.
  const first = useWorkspaces().list?.slice(0, OFFERED);
  const current = useCurrentWorkspace();
  const list = first && current && !first.some((workspace) => workspace.workspaceId === current.workspaceId) ? [...first, current] : first;
  const slug = useWorkspaceSlug();
  const [into, setInto] = useState<Id<"workspaces"> | null>(null);
  // One picked and then left, as when a membership is taken away meanwhile, is picked no longer: the page's own is back.
  const chosen = into !== null && into !== pageWorkspace ? list?.find((workspace) => workspace.workspaceId === into) : undefined;
  const away = chosen !== undefined;
  const workspaceId = chosen ? chosen.workspaceId : pageWorkspace;
  // Whose Stripe credit the bill names: the organisation that would pay, or null for the person's own.
  const paying = chosen ?? current;
  const payer = paying?.kind === "organization" ? paying.name : null;
  // Credit a missing card leaves unused: whoever manages the paying workspace's cards saves one on Stripe's page, which
  // comes back here, to the workspace's own Publish page, marked so the card is read again.
  const openPortal = useAction(api.billing.actions.openPortal);
  const appToast = useAppToast();
  const saveCard =
    paying && (paying.kind === "personal" || paying.role === "admin")
      ? () => {
          const back = `${workspaceHref(paying.kind === "organization" ? paying.slug : undefined, "/publish")}?report=new&step=agreement&back=${crypto.randomUUID()}`;
          void openPortal({ ...(paying.kind === "organization" && { workspaceId: paying.workspaceId }), back }).then((url) => window.location.assign(url), appToast.billing.portalFailed);
        }
      : undefined;
  const [now] = useState(thisMinute);
  const others = here && pageWorkspace ? (list ?? []).filter((workspace) => workspace.workspaceId !== pageWorkspace).map((workspace) => workspace.workspaceId) : [];
  const asked = others.join(" ");
  const elsewhere = useQueries(useMemo(() => Object.fromEntries(asked.split(" ").filter(Boolean).map((id) => [id, { query: api.reports.flow.starts, args: { workspaceId: id as Id<"workspaces">, now } }])), [asked, now]));
  const there = chosen ? (elsewhere[chosen.workspaceId] as Starts | Error | undefined) : undefined;
  // Until the picked workspace's day is read, the page's stays up, and nothing in it can be pressed.
  const settling = away && (there === undefined || there instanceof Error);
  const starts = away && !settling ? (there as Starts) : here;
  // What is said of the workspace's day (a DOI reserved there, a day used up) waits for that read: until then the
  // day on screen is the page's own, and its reserved DOI is not the picked workspace's to continue.
  const day = settling ? null : starts;
  // Signed for another workspace, the step waits for that workspace's page as it waited for the signing.
  const [leaving, setLeaving] = useState(false);
  const signedFor = (key: string) => {
    if (chosen) setLeaving(true);
    onSigned(key, chosen);
  };
  // Today, kept for as long as the step is open, so the text doesn't change under the reader at midnight.
  const [today] = useState(() => new Date());
  // The name they are known by, until they type another.
  const [typed, setTyped] = useState<string | null>(null);
  const name = typed ?? user?.fullName ?? "";
  const [busy, start] = useTransition();
  // The report this step just signed, which the day then counts as reserved and untouched.
  const [made, setMade] = useState<string | null>(null);
  const { agreement } = basics;
  // The licence, which the agreement names: CC BY unless the author picks another, and only where the agreement lets them.
  const [pick, setPick] = useState<LicencePick>(DEFAULT_LICENCE);
  // Who gets its PDF, as the licence allows: anyone, unless the author picks otherwise.
  const [access, setAccess] = useState<FileAccess | null>(null);
  // A promotion code, quoted here and kept with the report when it is signed, for what a card pays to activate it.
  const [quoted, setQuoted] = useState<(Quote & { for?: Id<"workspaces"> }) | null>(null);
  // A code is quoted for one workspace's customer, so it counts only for the workspace it was asked for: with another
  // picked it is asked again, and an answer that comes back after the pick is not the new workspace's either.
  const voucher: Quote | null = quoted && quoted.for === workspaceId ? { code: quoted.code, off: quoted.off } : null;
  const [typedCode, setTypedCode] = useState("");
  const quoteCode = useAction(api.reports.activation.quoteCode);
  // How the report is to be paid: from the balance while it holds something, unless the author picks the card. Kept
  // with the report when it is signed, and open to change until it is activated.
  const [picked, setPicked] = useState<PayWith | null>(null);
  const payWith: PayWith = starts?.balance === 0 ? "card" : (picked ?? "balance");
  // Where the report's permanent copy is kept (#1237): Openscholar's Zenodo account, or the author's own. Kept in
  // the address, so it is still picked after connecting Zenodo in the page itself.
  const [archive, setArchive] = useQueryState("archive", parseAsStringLiteral(["openscholar", "own"] as const).withDefault("openscholar"));
  const zenodo = useZenodoAccount();
  const connectZenodo = useConnectZenodo();
  const [connecting, setConnecting] = useState(false);
  // Zenodo's mark, in the archive choice and its "?", is fetched with the step.
  preloadZenodoMark();
  // Their own account picked, with none connected (or one Zenodo stopped accepting): it can't be signed until it is.
  const zenodoNeeded = archive === "own" && (!zenodo || zenodo.broken);
  const choosing = choosesLicence(agreement.text);
  // An own licence counts once it is named, has its address, and says whether it lets anyone share the report.
  const licence: Licence | null = !choosing ? DEFAULT_LICENCE : typeof pick === "string" ? pick : pick.open === undefined ? null : ownLicence(pick.name, pick.url, pick.open);
  // The licence as far as it is picked: the price, the file's choices, the bill and the agreement all read it.
  const named: Licence = choosing ? pickedLicence(pick) : DEFAULT_LICENCE;
  // The bill names an own licence not yet named as such, never "…".
  const billed = typeof pick !== "string" && choosing && !pick.name.trim() ? t("licence.own") : licenceName(named);
  // What the licence picked costs, in dollars, and how many of them a card would buy, before any code.
  const priceNow = priceOf(named, basics.prices);
  const sum = starts ? payment({ price: priceNow, balance: starts.balance, payWith, off: voucher?.off ?? 0, credit: starts.credit, cardSaved: starts.cardSaved }) : null;
  const bought = sum?.bought ?? 0;
  // One tick agrees for the signer and any co-authors, as the agreement has one author sign for all: the authors
  // aren't known until the PDF is read, so a tick only some signers needed let reports with several go unconfirmed.
  // It is for the agreement as it read when it was made. One changed since, while the page was open, is read and
  // ticked again before it can be signed.
  // Kept with the tab until the report is signed: someone who ticks it signed out, then signs up, finds it as they
  // left it and not cleared without a word. The step is drawn only in the browser, once the page has its data.
  const [ticks, setTicks] = useState(() => keptTicks(agreement.version) ?? { version: agreement.version, agreed: false });
  const changed = ticks.version !== agreement.version && ticks.agreed;
  const agreed = ticks.version === agreement.version && ticks.agreed;
  const tick = (now: boolean) => {
    const next = { version: agreement.version, agreed: now };
    setTicks(next);
    keepTicks(next);
  };
  // The workspace has used up its day, or has none: no new report can start, and the page says which. A DOI the
  // person reserved and did nothing with is theirs again by signing, whatever the day has left.
  // The workspace's plan has used up its new reports for the day, or has none: no new report can start, and the page
  // says which and where the plans are. A DOI the person reserved and did nothing with is theirs again by signing,
  // whatever the day has left.
  // The same in a few words, for beside the workspace picked: one line that never wraps.
  const dayShut = day && !day.untouched && day.perDay !== null && day.left === 0 ? t(`shut.${day.perDay > 0 ? "used" : day.kind === "personal" ? "ownClosed" : "closed"}`) : null;
  const dayBlocked = day && !day.untouched && day.perDay !== null && day.left === 0 ? t(`limit.${day.kind === "personal" ? "personal" : "workspace"}${day.perDay === 0 ? "Closed" : ""}`, { count: day.perDay }) : null;
  // A workspace whose Stripe account is in another currency can't pay a card's part in dollars: it is said before
  // signing, where the workspace is picked, so nobody signs for a report it can't make live.
  const foreign = starts?.currency && (sum?.bought ?? 0) > 0 ? starts.currency : null;
  const shut = dayShut ?? (foreign ? t("shut.currency", { currency: foreign }) : null);
  const blocked = dayBlocked ?? (foreign ? t("payment.currency", { currency: foreign }) : null);
  // The way on: the plans of the workspace picked, which isn't always the page's, or an email to us about its Stripe account.
  const way: WayOn = dayShut ? { label: t("seePlans"), href: workspaceHref(away ? chosen?.slug : slug, "/pricing") } : { label: t("emailUs"), href: SUPPORT_MAIL };
  return (
    <div>
      <StepHead title={t("agreementTitle", { series: basics.series.name })} help="agreement" aside={<StatusChip tone="neutral">{t("version", { version: agreement.version })}</StatusChip>}>
        {t("agreementIntro")}
        {/* Said before it is read: the agreement's text is the same for everyone, whatever language the page is in. */}
        {locale.startsWith("en") ? null : ` ${t("agreementInEnglish")}`}
      </StepHead>
      {/* Three things in turn, each under its own name: the licence, how it is paid, and the agreement to sign. What
          the first two come to is a bill beside them, under the cover, so the steps themselves stay short. */}
      {choosing ? (
        <section className="mb-7">
          <LicenceChoice value={pick} onChange={setPick} disabled={busy || !!signed} prices={basics.prices} />
        </section>
      ) : null}
      <section className="mb-7">
        <FileAccessChoice licence={named} value={access} onChange={setAccess} disabled={busy || !!signed} />
      </section>
      {/* Where the permanent copy goes, said before the agreement that promises one. */}
      <section className="mb-7" inert={busy || !!signed || leaving || undefined}>
        <ArchiveChoice
          value={archive}
          onChange={(chosen) => void setArchive(chosen === "openscholar" ? null : chosen)}
          account={zenodo ?? null}
          connecting={connecting}
          onConnect={() => {
            // Signed out, there is no one to connect Zenodo for yet: signing in comes first, back on this step.
            if (!user) return openSignIn();
            // A window of its own, so everything picked on this step stays as it is while Zenodo is connected.
            setConnecting(true);
            void connectZenodo(window.location.pathname + window.location.search, { window: true })
              .catch((error: unknown) => say(error instanceof Error ? error.message : String(error)))
              .finally(() => setConnecting(false));
          }}
        />
      </section>
      {/* Whose the report will be, for someone in more than one workspace: said before what pays, which is that workspace's balance. */}
      {here && workspaceId && list && list.length > 1 ? (
        <section className="mb-7" inert={busy || !!signed || leaving || undefined}>
          <WorkspaceChoice heading={SECTION} workspaces={list} value={workspaceId} onChange={setInto} blocked={shut ? { why: shut, way } : null} />
        </section>
      ) : null}
      {/* For the workspace that would pay: signed out, the licences show their prices and no more. */}
      {starts && workspaceId ? (
        <section className="mb-7" inert={busy || !!signed || leaving || settling || undefined}>
          {/* With nothing in the balance a card pays: no choice to show, so the section is the voucher's, its field open. */}
          <h3 className={SECTION}>{t(starts.balance === 0 ? "payment.voucher" : "payment.title")}</h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {starts.balance === 0 ? null : <PayWithSwitch funds={starts} payWith={payWith} onPayWith={setPicked} />}
            {/* A code lowers what the card pays: with nothing for a card to pay, its field is put away. A code applied
                is kept, and is back when a card pays again. */}
            {/* Another workspace's balance changes how wide the way to pay is: the field slides to its new place. */}
            <motion.div layout="position" transition={{ duration: 0.3, ease: EASE }} className="min-w-0 flex-1 basis-64 sm:max-w-sm">
              <AutoHeight>
                {bought > 0 ? (
                  <div className={cn("py-1", starts.balance !== 0 && "px-3")}>
                    <PromoCode fixed={starts.balance === 0} applied={voucher} onApply={setQuoted} onQuote={(code) => quoteCode({ workspaceId, code, amount: bought }).then(({ off }) => ({ code: code.trim(), off, for: workspaceId }))} typed={typedCode} onTyped={setTypedCode} />
                  </div>
                ) : null}
              </AutoHeight>
            </motion.div>
          </div>
          {/* The bill: under the cover on a wide page, here on a narrow one, where the cover is under the steps. */}
          <Bill boxed className="mt-4 @3xl:hidden" licence={billed} price={priceNow} funds={starts} owner={payer} payWith={payWith} code={voucher} note={t("payment.later")} onSaveCard={saveCard} />
          {beside ? createPortal(<Bill className="mt-5 hidden border-t border-border-subtle pt-4 @3xl:block" licence={billed} price={priceNow} funds={starts} owner={payer} payWith={payWith} code={voucher} note={t("payment.later")} onSaveCard={saveCard} />, beside) : null}
        </section>
      ) : null}
      <h3 className={SECTION}>{t("payment.sign")}</h3>
      <div lang="en" dir="ltr" className="max-h-[22rem] overflow-y-auto rounded-2xl border border-border-subtle bg-inset/40 px-5" style={{ maskImage: `linear-gradient(to bottom, transparent, black ${EDGE_FADE}px, black calc(100% - ${EDGE_FADE}px), transparent)`, paddingBlock: EDGE_FADE }}>
        <MarkdownContent content={fillAgreement(agreement.text, { name, date: today, byline: bylineOf(basics.series, "…", named), licence: named })} className="text-sm sm:text-sm [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:leading-snug [&_h2]:text-base" />
      </div>
      <div className="mt-5 grid gap-4 sm:max-w-md">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t("signedBy")}</span>
          <Input value={name} maxLength={SIGNER_NAME_MAX} onChange={(e) => setTyped(e.target.value)} autoComplete="name" />
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <Checkbox checked={agreed} onCheckedChange={(v) => tick(v === true)} className="mt-0.5" />
          <span className="text-pretty">{t("agree")}</span>
        </label>
      </div>
      {/* Notices run the step's full width, as every other step's do: only the form's fields keep a narrow column. */}
      {/* Not while signing, nor for the report signed here: the day reads it as reserved the moment it is, before the page moves on to it. */}
      {day?.untouched && day.untouched !== signed && day.untouched !== made && !busy ? (
        // A reload while signing lands here with the DOI already reserved: it is this one, and signing gives it again.
        <p role="status" className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-inset px-4 py-3 text-sm">
          <span className="min-w-0 flex-1 basis-56">
            {t.rich("untouched", { key: day.untouched, mono: (chunks) => <span className="font-mono">{chunks}</span> })}
          </span>
          <Button size="sm" variant="outline" disabled={leaving} onClick={() => signedFor(day.untouched!)}>
            {t("continueWith")} <ArrowUpRight />
          </Button>
        </p>
      ) : null}
      {changed ? (
        <p role="status" className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 ink-warning" />
          {t("agreementChanged")}
        </p>
      ) : null}
      <Problem className="pt-4">{problem}</Problem>
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        {onBack ? (
          <Button variant="ghost" className="-ms-3 me-auto text-muted-foreground" onClick={onBack}>
            <ArrowLeft /> {t("back")}
          </Button>
        ) : null}
        {/* Why Sign is shut while an own licence lacks its name or address, said beside it. */}
        {!licence && !blocked ? <p className="text-sm text-muted-foreground">{t("licence.ownNeeded")}</p> : null}
        {licence && zenodoNeeded && !blocked ? <p className="text-sm text-muted-foreground">{t("archive.connectNeeded")}</p> : null}
        {blocked ? (
          <>
            <p className="text-sm text-muted-foreground">{blocked}</p>
            <WayOnButton way={way} />
          </>
        ) : null}
        {starts ? (
          <NextButton
            busy={busy || !!signed || leaving}
            disabled={!agreed || !name.trim() || !licence || zenodoNeeded || busy || !!signed || leaving || settling || !!blocked || !workspaceId}
            onClick={() =>
              start(async () => {
                say(null);
                try {
                  // The licence is the report's from here on; what pays and the code can still change until it is activated.
                  const key = await sign({ workspaceId: workspaceId!, name, onBehalfOfAll: true, version: agreement.version, licence: licence!, fileAccess: fileAccessOf(licence!, access), archive, payWith, ...(voucher && { voucher }) });
                  setMade(key);
                  // Signed, the tick has done its work: the next report's agreement starts unticked.
                  keepTicks(null);
                  signedFor(key);
                } catch (error) {
                  failed(t("signFailed"))(error);
                }
              })
            }
          >
            {t("sign")}
          </NextButton>
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
  // The choice made here, or the one a PDF already attached was uploaded with.
  const [chosen, setBy] = useBylineBy();
  const by = chosen ?? report.pdf?.bylineBy ?? null;
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
      <motion.h2
        // Just reserved, the signing screen it replaced took the focus with it: the heading takes it, as each step's does,
        // so a keyboard carries on from here and a screen reader says the DOI is reserved.
        ref={(heading) => {
          if (!heading || !fresh || (document.activeElement && document.activeElement !== document.body)) return;
          heading.tabIndex = -1;
          heading.focus({ preventScroll: true });
        }}
        className="mt-5 flex items-center gap-1 text-2xl font-semibold tracking-tight"
        {...rise(0.3)}
      >
        {t("doiReserved")}
        <FieldHelp field="doi" />
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
        <StepHead title={t("bylineFirst")} help="byline">{t("bylineFirstBody")}</StepHead>
        <BylineChoice byline={report.byline} by={by} onPick={(picked) => void setBy(picked)} />
        <StepNav
          hint={by ? undefined : t("bylineBy.choose")}
          next={
            <NextButton disabled={!by} onClick={onNext}>
              {t("nextUpload")}
            </NextButton>
          }
        />
      </motion.div>
    </div>
  );
}

/** The line a report's PDF carries on its cover, to copy. Its DOI is one long word: it breaks anywhere, so on a phone it wraps inside the box and the copy button stays in reach. */
function BylineBox({ byline, className }: { byline: string; className?: string }) {
  const t = useTranslations("publishReports.flow");
  const tToast = useTranslations("toast");
  return (
    <div className={cn("flex items-start gap-2 rounded-xl border border-border-subtle bg-inset px-3.5 py-3", className)}>
      <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{byline}</span>
      <TooltipHint label={t("copyByline")}>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t("copyByline")} className="-me-1 text-muted-foreground" onClick={() => void copyText(byline, { copied: t("bylineCopied"), failed: tToast("couldntCopy"), select: tToast("copyFailedDescription") })}>
          <Copy />
        </Button>
      </TooltipHint>
    </div>
  );
}

/** Back and on, at the foot of a step: back to the step before, and on to the next one where it is open. */
// Held in the page's address from the DOI's page to the upload, where it is saved with the PDF.
const useBylineBy = () => useQueryState("byline", PLACE.byline);

/**
 * The line, and the choice of who adds it. Neither is chosen for the author: the DOI's page and the upload's both
 * wait for one, so nobody uploads a PDF before knowing the line has to be in it.
 */
function BylineChoice({ byline, by, onPick, disabled = false }: { byline: string; by: BylineBy | null; onPick: (by: BylineBy) => void; disabled?: boolean }) {
  const t = useTranslations("publishReports.flow.bylineBy");
  const id = useId();
  return (
    <div className="mb-5">
      <BylineBox byline={byline} />
      <RadioGroup aria-label={t("label")} value={by ?? ""} disabled={disabled} onValueChange={(picked) => onPick(picked as BylineBy)} className="mt-3 gap-3 sm:grid-cols-2">
        {([["self", PenLine], ["added", FileCheck2]] as const).map(([value, Icon]) => (
          <label key={value} htmlFor={`${id}-${value}`} className={cn("flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors", disabled ? "opacity-60" : "cursor-pointer", by === value ? "border-primary bg-primary/[0.06]" : cn("border-border", !disabled && "hover:border-foreground/25 hover:bg-muted/50"))}>
            <RadioGroupItem id={`${id}-${value}`} value={value} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                {t(`${value}.title`)}
                <Icon className="ms-auto size-4 shrink-0 text-muted-foreground" />
              </span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{t(`${value}.body`)}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}

function StepNav({ onBack, next, hint }: { onBack?: () => void; next?: ReactNode; /** Why the way on is shut, said beside it. */ hint?: string }) {
  const t = useTranslations("publishReports.flow");
  return (
    // A Next too wide to sit beside Back (a phone at large text) takes a line of its own.
    <div className="mt-6 flex flex-wrap items-center gap-3">
      {onBack ? (
        <Button variant="ghost" className="-ms-3 text-muted-foreground" onClick={onBack}>
          <ArrowLeft /> {t("back")}
        </Button>
      ) : null}
      {hint ? <p className="ms-auto text-sm text-muted-foreground">{hint}</p> : null}
      <div className={cn("min-w-0 max-w-full", !hint && "ms-auto")}>{next}</div>
    </div>
  );
}

/** What publishing a report takes, before anything is signed: the steps, and what the author brings to them. */
function Overview({ series, reviewed, prices, balance, onStart }: { series: string; /** What a report costs under each kind of licence, in US dollars, said here so it is no surprise at the last step. */ prices: Prices; /** What the workspace's publication balance holds, which pays for the last step before a card does; null for no limit, 0 signed out. */ balance: number | null; /** A reviewer approves each report before it can go live, which takes longer than the steps do. */ reviewed: boolean; onStart: () => void }) {
  const t = useTranslations("publishReports.flow.overview");
  const flow = useTranslations("publishReports.flow");
  const money = useMoney();
  /** The balance has something to pay the last step with. */
  const spendable = balance !== 0;
  const items = [
    { id: "agreement", icon: PenLine },
    { id: "doi", icon: Hash },
    { id: "pdf", icon: FileText },
    { id: "details", icon: ListChecks },
    { id: "checks", icon: ShieldCheck },
    { id: "activate", icon: spendable ? BadgeCheck : CreditCard },
  ] as const;
  const activating = t(spendable ? "activate.bodyPrices" : "activate.bodyCard", { price: money(prices.standard), priceOfThree: money(prices.other), priceClosed: money(prices.closed) });
  return (
    <div>
      <StepHead title={t("title", { series })}>{reviewed ? `${t("introReviewed")} ${flow("reviewTakes")}` : t("intro")}</StepHead>
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
              <span className="block text-sm text-muted-foreground">{id === "activate" ? activating : t(`${id}.body`)}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex justify-end">
        <NextButton onClick={onStart}>{t("start")}</NextButton>
      </div>
    </div>
  );
}

/**
 * Said over details kept from the PDF this one replaced: they may be the wrong file's, and the author can have them
 * read from this PDF instead, which replaces them.
 */
function KeptNotice({ onReadAgain }: { onReadAgain: () => Promise<null> }) {
  const t = useTranslations("publishReports.flow");
  const [reading, read] = useTransition();
  // Asked first: the details shown go, with whatever was typed into them.
  const [asking, setAsking] = useState(false);
  const { problem, say, failed } = useProblem();
  return (
    <div className="mb-5">
    <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-2xl bg-inset px-4 py-3 text-sm">
      <p className="flex min-w-0 flex-1 basis-72 items-start gap-2.5">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0">{t("keptDetails")}</span>
      </p>
      <Button size="sm" variant="outline" className="relative ms-auto" disabled={reading} onClick={() => setAsking(true)}>
        <Working busy={reading}>
          <span className="flex items-center gap-2">
            <RotateCcw /> {t("readAgain")}
          </span>
        </Working>
      </Button>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("readAgainTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("readAgainBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("readAgainKeep")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => (say(null), read(() => onReadAgain().then(() => {}, failed(t("readAgainFailed")))))}>{t("readAgain")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    <Problem className="ps-1 pt-2">{problem}</Problem>
    </div>
  );
}

/** What a PDF's reading fell short of, said where the author fills in what it left. */
function PdfNotice({ trouble, lineAdded, onUpload }: { trouble: NonNullable<Report["pdf"]>["trouble"]; /** Openscholar added the byline's page, so a scan has the line all the same. */ lineAdded: boolean; onUpload: () => void }) {
  const t = useTranslations("publishReports.flow");
  if (trouble !== "textless" && trouble !== "unread") return null;
  return (
    <div role="status" className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-2xl bg-inset px-4 py-3 text-sm">
      <p className="flex min-w-0 flex-1 basis-72 items-start gap-2.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 ink-warning" />
        <span className="min-w-0">
          {t(trouble === "textless" ? (lineAdded ? "textlessAdded" : "textless") : "unreadPdf")}
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

/**
 * Sets `--fill` on a screen: the height that brings the page's foot to the window's, so the screen reaches the bottom of
 * the window and the page doesn't scroll for empty space. Read from the layout (offsets), not the screen, so a screen
 * still rising in is measured where it will stand; again when the window is resized. What lies below it is the grid it
 * stands in (the one the cover sets `--cover-height` on) and its page: their bottom padding, borders and margins, and
 * anything laid out after them, such as a footer.
 */
function fillsWindow(element: HTMLDivElement | null) {
  const grid = element?.closest<HTMLElement>(".grid");
  if (!element || !grid) return;
  const fit = () => {
    let top = 0;
    for (let at: HTMLElement | null = element; at; at = at.offsetParent as HTMLElement | null) top += at.offsetTop;
    let below = 0;
    for (let at: HTMLElement | null = grid; at && at !== document.body; at = at.parentElement) {
      const style = getComputedStyle(at);
      below += Number.parseFloat(style.paddingBottom) + Number.parseFloat(style.borderBottomWidth) + Number.parseFloat(style.marginBottom);
      // Only what takes room on the page: a banner or toast fixed over it, say the cookie notice, takes none.
      for (let next = at.nextElementSibling; next; next = next.nextElementSibling)
        if (next instanceof HTMLElement && !["fixed", "absolute"].includes(getComputedStyle(next).position)) below += next.offsetHeight;
    }
    element.style.setProperty("--fill", `${Math.max(0, window.innerHeight - top - below)}px`);
  };
  fit();
  addEventListener("resize", fit);
  return () => removeEventListener("resize", fit);
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
  const addByline = useMutation(api.reports.flow.addByline);
  // The choice made on the way here, or the one the PDF already attached was uploaded with.
  const [chosen, setBy] = useBylineBy();
  const by = chosen ?? report.pdf?.bylineBy ?? null;
  const here = { workspaceId, key: report.key };
  // A PDF already here without the line gets its page as soon as its author asks for it, by the choice or the notice.
  // What went wrong with the last file or choice, said under the drop area until the next one.
  const { problem, say, failed } = useProblem();
  const pick = (picked: BylineBy) => {
    say(null);
    void setBy(picked);
    if (picked === "added" && report.pdf?.lacksByline && report.pdf.bylineBy !== "added") void addByline(here).catch(failed(t("bylineBy.addFailed")));
  };
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
    if (!picked || busy || !by) return;
    say(null);
    if (!/\.pdf$/i.test(picked.name)) return say(t("notPdf", { name: picked.name }));
    if (picked.size === 0) return say(t("emptyFile"));
    if (picked.size > MAX_PDF_BYTES) return say(t("tooBig", { max: MAX_PDF_MB }));
    setSending(picked);
    // Whether the file got as far as Openscholar: a failure says which half went wrong.
    let arrived = false;
    try {
      // The PDF goes up while its first page is drawn here: a cover that can't be drawn leaves the title page.
      const [file, cover] = await Promise.all([
        put(picked, "application/pdf"),
        drawCover(picked).then(async (drawn) => (drawn ? { id: await put(drawn.picture, "image/jpeg"), shape: drawn.shape } : undefined)).catch(() => undefined),
      ]);
      arrived = true;
      const refused = await attachPdf({ ...here, file, name: picked.name, bylineBy: by, ...(cover && { cover: cover.id, coverShape: cover.shape }) });
      if (refused) return say(refused);
      onAttached();
    } catch (error) {
      // A browser's own words for a request that never left ("Load failed") tell an author nothing: the file wasn't
      // kept, and the connection is what to look at.
      if (error instanceof TypeError) say(t("offline"));
      else failed(t(arrived ? "uploadFailed" : "notSent"))(error);
    } finally {
      setSending(null);
      if (input.current) input.current.value = "";
    }
  };
  return (
    // The drop area takes the height the window has to spare, so Back and Next sit at its foot. Not the cover's column:
    // that grows when the bill under it arrives, and the drop area would grow after it.
    <div ref={fillsWindow} className="flex min-h-[var(--fill,0px)] flex-col">
      <StepHead title={t("uploadPdf")} help="byline">{t("uploadIntro")}</StepHead>
      <BylineChoice byline={report.byline} by={by} disabled={busy} onPick={pick} />
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
        disabled={busy || !by}
        className={cn("flex min-h-44 w-full flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-center transition-colors", !by ? "border-border opacity-60" : over ? "border-primary bg-primary/5" : "border-border hover:border-primary/60 hover:bg-muted/50")}
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
            <span className="text-sm font-medium">{t(by ? "drop" : "bylineBy.chooseFirst")}</span>
            <span className="text-xs text-muted-foreground">{t("dropHint", { max: MAX_PDF_MB })}</span>
          </>
        )}
      </button>
      <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void send(e.target.files?.[0])} />
      <Problem className="ps-1 pt-3">{problem}</Problem>
      {report.pdf?.trouble === "unopened" && !busy ? (
        <p role="alert" className="mt-3 flex items-start gap-2 ps-1 text-sm text-destructive">
          <CircleX className="mt-0.5 size-4 shrink-0" />
          {t("unopenedPdf", { name: report.pdf.name })}
        </p>
      ) : report.pdf?.lacksByline && !busy ? (
        // Said here, where the PDF is replaced, not after the checks: the line is shown above, with its copy button,
        // and so is the way out for an author who can't edit their PDF.
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 ps-1 text-sm text-destructive">
          <p className="flex min-w-0 flex-1 basis-72 items-start gap-2">
            <CircleX className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{t(report.pdf.bylineBy === "added" ? "bylineBy.failed" : "lacksByline", { name: report.pdf.name })}</span>
          </p>
          {report.pdf.bylineBy === "added" ? null : (
            <Button
              size="sm"
              variant="outline"
              className="ms-auto text-foreground"
              onClick={() => pick("added")}
            >
              <FileCheck2 /> {t("bylineBy.added.title")}
            </Button>
          )}
        </div>
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
            <NextButton onClick={onNext}>{t("nextDetails")}</NextButton>
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
/** What Already published said when it found nothing, before it searched Openscholar Reports too: said as it was. */
const BEFORE_OWN_REPORTS = "Not in OpenAlex, Openscholar's index or our communities.";

export function CheckRow({ name, result, advice = true, overruled = false }: { name: string; result?: CheckResult; /** Whether to say what the author can do about a failed check: only where they still can. */ advice?: boolean; /** A reviewer approved the report over this check's answer. */ overruled?: boolean }) {
  const reduce = useReducedMotion();
  const t = useTranslations("publishReports.flow");
  /** What a check says, in the page's language when it's one of the fixed things a check says. */
  const inWords = (words: string | undefined) => {
    // A result saved before Openscholar Reports itself was searched (2026-11-12) says what was searched then.
    if (words === BEFORE_OWN_REPORTS) return t("check.said.notPublishedElsewhere");
    const sure = sameStudySure(words);
    if (sure !== undefined) return t("check.said.sameStudy", { percent: format.number(sure / 100, { style: "percent" }) });
    const key = (Object.keys(CHECK_SAID) as Array<keyof typeof CHECK_SAID>).find((said) => CHECK_SAID[said] === words);
    return key ? t(`check.said.${key}`) : words;
  };
  /** Where it was found, said whole for the places that aren't a community's or series' name: languages join "in" to what follows. */
  const foundIn = (where: string) => {
    const key = (Object.keys(CHECK_WHERE) as Array<keyof typeof CHECK_WHERE>).find((said) => CHECK_WHERE[said] === where);
    return key ? t(`check.foundAt.${key}`) : t("check.foundIn", { where });
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
                  <span className="shrink-0">{result.evidence.where ? foundIn(result.evidence.where) : t("check.foundAs")}</span>
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
function Checks({ beside = null, rows, report, humanReview, terms, onActivate, onChoose, onQuote, onCancelPayment, onFix, onDetails, onRequestReview, onAnother }: { /** The place under the cover, on a wide page: the bill stays there until the report is live. */ beside?: HTMLDivElement | null; rows: Array<{ id: string; name: string; result?: CheckResult }>; /** None while the checks run. */ report: Report | null; humanReview: boolean; /** What the report costs and what pays for it; null where there is nothing to activate. */ terms?: Terms | null; /** Activates it, paid as chosen, with the code applied to a card's part, and the price and what is due as they were shown, in US dollars. */ onActivate?: (payWith: PayWith, code: string | undefined, price: number, expect: number, /** Paid this once on Stripe's page, with a card other than the saved one. */ otherCard?: boolean) => Promise<void>; /** Keeps with the report what pays, or the code applied (null takes it off). */ onChoose?: (choice: { payWith?: PayWith; voucher?: Quote | null }) => void; /** The share a code takes off `amount` dollars a card would buy. */ onQuote?: (code: string, amount: number) => Promise<Quote>; /** Gives up a payment still to be made. */ onCancelPayment?: () => Promise<void>; onFix?: () => void; onDetails?: () => void; onRequestReview?: (comment: string) => Promise<void>; onAnother?: () => void }) {
  const [asking, setAsking] = useAsking();
  const t = useTranslations("publishReports.flow");
  const dollars = useDollars();
  const answered = rows.filter((r) => r.result).length;
  const stage = report ? stageOf(report, humanReview) : null;
  /** A report a reviewer declined before it ever went live: its author changes it and runs the checks again. */
  const reopens = stage === "declined" && !!report && !report.withdrawn && report.activatedAt === undefined;
  const [activating, start] = useTransition();
  // Only the workspace's admins activate (#1261). The report costs its licence's price. What pays is the person's to
  // choose until it is live: the workspace's publication balance, which pays what it can and leaves a card the rest, or
  // a card alone. A code lowers what the card pays. Nothing due activates at once; a charge is confirmed in a dialog
  // first, and with no saved card it is paid on Stripe's page.
  const organization = terms?.organization ?? null;
  const admin = terms?.admin ?? true;
  const card = terms?.card ?? null;
  const pending = terms?.pending ?? null;
  // A payment going through, started here or in another tab: the report can't change until it ends (flow.ts `goTo`).
  const chargeOver = usePassed(terms?.paying?.until ?? undefined);
  const charging = !!terms?.paying && !chargeOver;
  /** In US dollars. */
  const price = terms?.price ?? 0;
  const [paying, setPaying] = useState(false);
  // Stripe's portal, where the workspace's cards are added, removed and made the default: the person's own, or the organisation's.
  const openPortal = useAction(api.billing.actions.openPortal);
  const workspaceId = useWorkspace();
  // It comes back to this report, not to Plan and credits.
  const appToast = useAppToast();
  // The card is read again as the dialog opens: one changed in Stripe's portal a moment ago shows, and is the one charged.
  const refreshMine = useAction(api.billing.accounts.refreshMine);
  const askToPay = () => {
    void refreshMine(organization && workspaceId ? { workspaceId } : {}).catch(() => {});
    setPaying(true);
  };
  // It comes back marked as back from Stripe (`back`), so the page reads the card again: one saved there counts at once.
  const manageBilling = () => {
    const here = new URL(window.location.href);
    here.searchParams.set("back", crypto.randomUUID());
    void openPortal({ ...(organization && workspaceId ? { workspaceId } : {}), back: `${here.pathname}${here.search}` }).then((url) => window.location.assign(url), appToast.billing.portalFailed);
  };
  // What pays and the code are kept with the report, so the bill reads the same on every step and after a reload.
  const payWith: PayWith = terms ? payWithOf(terms) : "card";
  const code = terms?.voucher ?? null;
  // What the report's price comes to: what the balance pays, what a card buys, and what the code takes off that.
  const sum = payment({ price, balance: terms ? terms.balance : 0, payWith, off: code?.off ?? 0, credit: terms?.credit ?? 0, cardSaved: terms?.cardSaved ?? true });
  /** Where a code can be used: while a card pays something and no payment is waiting. It lowers what the card pays. */
  const vouchers = !!terms && sum.bought > 0 && !pending && !!onQuote;
  // What is typed in the code's field, kept here so paying sees it.
  const [typed, setTyped] = useState("");
  // A code typed and not applied: nothing is charged past it, or the price without the code would be.
  const unapplied = vouchers && typed.trim() !== "";
  // The charge's dialog closes when the person stops being an admin while it's open: they can't pay for it any more.
  // It never stays open over a code still to be applied either.
  if (paying && (!admin || unapplied)) setPaying(false);
  // What went wrong with activating or paying, said above the payment bar.
  const { problem, say, failed } = useProblem();
  const fromCredit = Math.round(sum.fromCredit * 100);
  /** What a card is charged, in cents: nothing when the balance, a code or the Stripe credit covers it all. */
  const due = Math.round(sum.due * 100);
  const activateNow = (otherCard = false) =>
    start(async () => {
      say(null);
      try {
        // The code goes with it only where a card buys something for it to lower.
        await onActivate?.(payWith, sum.bought > 0 ? code?.code : undefined, price, due / 100, otherCard);
      } catch (error) {
        const reason = promoReason(error);
        if (refusalOf(error)?.code === "BILLING_PAYMENT_DECLINED") say(t("activation.declined"));
        else if (refusalOf(error)?.reason === "changed") say(t("activation.changed"));
        else if (refusalOf(error)?.reason === "paused") say(t("activation.paused"));
        else if (refusalOf(error)?.reason === "currency") say(t("payment.currency", { currency: refusalOf(error)?.currency ?? "" }));
        else if (reason) say(t(`activation.promo.${reason}`, { code: code?.code ?? "" }));
        else failed(t("activateFailed"))(error);
      }
    });
  const [cancelling, cancel] = useTransition();
  /** Why the report can't be paid for now, said on its button; null when it can. */
  const shut = terms?.paused ? t("activation.paused") : unapplied ? t("activation.promo.applyFirst") : due > 0 && !terms?.sells ? t("activation.notForSale") : sum.bought > 0 && terms?.currency ? t("payment.currency", { currency: terms.currency }) : null;

  const head = !report ? (
    <StepHead key="running" title={t("running")} help="checks" aside={<StatusChip tone="running" icon="tone">{t("ofTotal", { done: answered, total: rows.length })}</StatusChip>}>
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
    <StepHead key="review" title={t("waiting")} help="checks" aside={<StatusChip tone="running" icon={ReviewQueueIcon}>{t("inReview")}</StatusChip>}>
      {t(rows.some((r) => r.result && !r.result.pass) ? "waitingFlagged" : "waitingPassed")} {t("reviewTakes")}
    </StepHead>
  ) : stage === "declined" ? (
    <StepHead key="declined" title={t(report.withdrawn ? "withdrawn" : "notPublished")} aside={<StatusChip tone="danger" icon={CircleX}>{t(report.withdrawn ? "withdrawn" : "declined")}</StatusChip>}>
      {t(report.withdrawn ? "withdrawnBody" : "declinedBody")}
      {reopens ? ` ${t("declinedFix")}` : null}
    </StepHead>
  ) : (
    // Asked of a reviewer, it reads as waiting on them, with how long that takes: "A check failed" alone left people
    // unsure their request had gone anywhere.
    <StepHead key="failed" title={t("notYet")} help="checks" aside={report.asked ? <StatusChip tone="running" icon={ReviewQueueIcon}>{t("inReview")}</StatusChip> : <StatusChip tone="danger" icon={CircleX}>{t("aCheckFailed")}</StatusChip>}>
      {t(report.asked ? "failedAsked" : "failedFix")}
      {report.asked ? ` ${t("reviewTakes")}` : null}
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
      {terms?.kept && stage !== "live" ? (
        <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <BadgeCheck className="size-4 shrink-0" />
          {organization ? t("activation.keptOrg", { organization }) : t("activation.kept")}
        </p>
      ) : null}
      <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
        {rows.map((r) => (
          // What to do about a failed check shows while it can still be done: failed, or waiting for a reviewer, when the
          // author can still go back and send another PDF. Once a reviewer has approved the report, its checks say so.
          <CheckRow key={r.id} name={r.name} result={r.result} advice={stage === "failed" || stage === "review"} overruled={!!report?.approved && stage !== "declined" && r.result?.pass === false} />
        ))}
      </ul>
      <AutoHeight>
        <AnimatePresence initial={false}>
          {report ? (
            <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className="mt-6">
              <Problem className="pb-3 ps-1">{problem}</Problem>
              {stage === "ready" && admin && terms && !pending ? (
                // How the report is paid, laid out as where its licence was chosen: what pays and a code under a
                // heading, with the bill under the cover. Activate is with the step's other buttons, where Next is on
                // every step before it. Only the licence, which set the price, is fixed.
                <section className="mb-7" inert={activating || undefined}>
                  {/* With nothing in the balance a card pays: no choice to show, so the section is the voucher's, its field
                      open, and with no code to take either, it has no heading at all. */}
                  {terms.balance !== 0 || vouchers ? <h3 className={SECTION}>{t(terms.balance === 0 ? "payment.voucher" : "payment.title")}</h3> : null}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {terms.balance === 0 ? null : <PayWithSwitch funds={terms} payWith={payWith} onPayWith={(next) => onChoose?.({ payWith: next })} />}
                    {/* A code lowers what the card pays: with nothing for a card to pay, its field is put away. A code
                        applied is kept, and is back when a card pays again. */}
                    <AutoHeight className="min-w-0 flex-1 basis-64 sm:max-w-sm">
                      {vouchers ? (
                        <div className={cn("py-1", terms.balance !== 0 && "px-3")}>
                          <PromoCode fixed={terms.balance === 0} applied={code} onApply={(quote) => onChoose?.({ voucher: quote })} onQuote={(typedCode) => onQuote(typedCode, sum.bought)} typed={typed} onTyped={setTyped} />
                        </div>
                      ) : null}
                    </AutoHeight>
                  </div>
                  {/* The bill: under the cover on a wide page, where it has been since the report was signed, and here on a narrow one. */}
                  <Bill now boxed className="mt-4 @3xl:hidden" licence={licenceName(report.licence)} price={price} funds={terms} owner={organization} payWith={payWith} code={code} onSaveCard={admin ? manageBilling : undefined} />
                  {beside ? createPortal(<Bill now className="mt-5 hidden border-t border-border-subtle pt-4 @3xl:block" licence={licenceName(report.licence)} price={price} funds={terms} owner={organization} payWith={payWith} code={code} onSaveCard={admin ? manageBilling : undefined} />, beside) : null}
                  {terms.refused ? <p className="mt-2 ps-1 text-xs text-muted-foreground">{t("activation.card.refused")}</p> : null}
                </section>
              ) : admin && pending && stage !== "live" ? (
                // A payment still to be made, on Stripe's page or at the bank: the way back to it, and the way out of it.
                // Wherever the report stands: declined meanwhile, the payment still holds it and the workspace's others.
                <PendingPayment
                  pending={pending}
                  goesLive={stage === "ready"}
                  cancelling={cancelling}
                  onCancel={
                    onCancelPayment
                      ? () =>
                          cancel(async () => {
                            say(null);
                            await onCancelPayment().catch(failed(t("activation.card.cancelFailed")));
                          })
                      : undefined
                  }
                />
              ) : null}
              {/* Activate turns to a spinner while it works: said in words too, so nobody wonders whether to press again.
                  With something to pay and no saved card, what it is doing is opening Stripe's page: nothing is activated yet. */}
              <AutoHeight>{activating ? <p role="status" className="pb-3 text-end text-xs text-muted-foreground">{t(due > 0 && !card ? "activation.onStripe" : "activatingNow")}</p> : null}</AutoHeight>
              <div className="flex flex-wrap justify-end gap-2">
                {/* Back to the details, as every other step has a way back to the one before it: wherever the server
                    lets a checked report change (flow.ts `goTo`). */}
                {stage === "failed" || stage === "ready" || stage === "review" || reopens ? (
                  <Button variant="ghost" className="-ms-3 me-auto text-muted-foreground" disabled={activating || charging} onClick={onDetails}>
                    <ArrowLeft /> {t("back")}
                  </Button>
                ) : null}
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
                    {/* Declined before it ever went live, it can be changed and sent round again: the reviewer's note is a reason to, not the end of it. */}
                    {reopens ? (
                      <>
                        <Button variant="outline" onClick={onFix}>
                          <RotateCcw /> {t("uploadNew")}
                        </Button>
                        <Button onClick={onDetails}>
                          <PenLine /> {t("changeDetails")}
                        </Button>
                      </>
                    ) : null}
                    {/* Only where this report has come to its end, declined for good or taken down: there it is the way
                        on. Beside Pay, or beside the buttons that change the report, it read as one more thing to do with
                        this report. A new one starts from the list, as ever. */}
                    {onAnother && stage === "declined" && !reopens ? (
                      <Button onClick={onAnother}>
                        <Plus /> {t("publishAnother")}
                      </Button>
                    ) : null}
                    {stage === "ready" && admin && terms && !pending ? (
                      // What pressing it does, in a "?" beside it: people asked what Activate would do before they
                      // pressed. It opens above the two, where it leaves the button in sight.
                      <FieldHelp field="activation" side="top" around="flex min-w-0 max-w-full items-center justify-end gap-1.5">
                        {shut ? (
                          // Shut, with why: paused, a code typed and not applied, or nothing on sale to pay with.
                          <TooltipHint label={shut}>
                            <span tabIndex={0}>
                              <ActivateButton label={t(due === 0 ? "activateFree" : "activate")} amount={null} busy={false} disabled onClick={() => {}} />
                            </span>
                          </TooltipHint>
                        ) : (
                          // With nothing due there is nothing to pay: the button activates, and no dialog asks. With
                          // something due, it pays, and says how much.
                          <ActivateButton label={t(due === 0 ? "activateFree" : "activate")} amount={due > 0 ? dollars(due) : null} busy={activating} disabled={false} onClick={due === 0 ? () => activateNow() : askToPay} />
                        )}
                      </FieldHelp>
                    ) : null}
                    {stage === "ready" && !admin ? (
                      <TooltipHint label={t("activation.onlyAdmin")}>
                        <span tabIndex={0}>
                          <Button disabled>
                            <BadgeCheck /> {t("activateFree")}
                          </Button>
                        </span>
                      </TooltipHint>
                    ) : stage === "review" ? (
                      <TooltipHint label={t("needsApproval")}>
                        <span tabIndex={0}>
                          <Button disabled>
                            <BadgeCheck /> {t("activateFree")}
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
      {report && terms ? (
        // Asks before the charge: a saved card is charged as soon as it's confirmed, with no page of Stripe's in
        // between. With none saved, confirming goes on to Stripe's page, and the dialog says so.
        <UpgradeConfirmationDialog
          open={paying}
          onOpenChange={setPaying}
          title={t("activation.payTitle", { price: dollars(due), key: report.key })}
          // Who pays and where, in a few words: an organisation's card, or Stripe's page with no card saved.
          description={!card ? t("activation.onStripe") : organization ? t("activation.orgCardCharged", { organization }) : undefined}
          confirmLabel={t(card ? "activate" : "activation.toStripe")}
          totalLabel={t("activation.dueNow")}
          labels={{ from: t("activation.doiNow"), to: t("activation.after") }}
          isConfirming={false}
          onConfirm={() => {
            setPaying(false);
            activateNow();
          }}
          cardBrand={card?.brand}
          cardLast4={card?.last4}
          toTone="success"
          onManageBilling={manageBilling}
          // This once on Stripe's page, which offers the saved cards and takes a new one: the saved card is left as it is.
          onOtherCard={
            // Not while Stripe credit pays part: Stripe's page takes a payment whole and wouldn't draw on it.
            card && fromCredit === 0
              ? () => {
                  setPaying(false);
                  activateNow(true);
                }
              : undefined
          }
          preview={{
            currency: "USD",
            immediateChargeCents: due,
            currentPlan: t("activation.reserved"),
            targetPlan: t("activation.live"),
            targetPlanCreditsPerMonth: 0,
            lineItems:
              sum.fromBalance > 0 || sum.discount > 0 || fromCredit > 0
                ? [
                    { description: licenceName(report.licence), amountCents: Math.round(price * 100), currency: "USD" },
                    ...(sum.fromBalance > 0 ? [{ description: t("activation.balanceLine"), amountCents: -Math.round(sum.fromBalance * 100), currency: "USD" }] : []),
                    ...(code && sum.discount > 0 ? [{ description: t("activation.codeLine", { code: code.code }), amountCents: -Math.round(sum.discount * 100), currency: "USD" }] : []),
                    ...(fromCredit > 0 ? [{ description: t("payment.credit"), amountCents: -fromCredit, currency: "USD" }] : []),
                  ]
                : [],
          }}
        />
      ) : null}
    </div>
  );
}

/** Activate, in the payment bar: taller than the buttons around it, its badge in a ring, and what it takes from the card in a segment of its own. */
function ActivateButton({ label, amount, busy, disabled, onClick }: { label: string; amount: string | null; busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    // On a phone it never outgrows what holds it: its words wrap, and it grows taller.
    <Button size="lg" disabled={disabled || busy} onClick={onClick} className="relative h-11 shrink-0 gap-0 overflow-hidden rounded-xl p-0 text-[15px] font-semibold shadow-sm has-[>svg]:px-0 max-sm:h-auto max-sm:min-h-11 max-sm:max-w-full max-sm:shrink max-sm:whitespace-normal">
      <Working busy={busy}>
        <span className="flex h-11 items-center max-sm:h-auto max-sm:min-h-11">
          <span className="flex items-center gap-2.5 ps-2 pe-4 max-sm:py-1.5 max-sm:text-start">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/25">
              <BadgeCheck className="size-4" />
            </span>
            {label}
          </span>
          {amount === null ? null : (
            <span className="flex h-full items-center self-stretch border-s border-primary-foreground/25 bg-black/10 px-4 tabular-nums">
              <bdi dir="ltr">{amount}</bdi>
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
 * A promotion code for an activation that's paid for, in the payment bar: a link until it's wanted, then a field.
 * Autumn quotes the activation with the code, and says when it doesn't know the code or it has been used up.
 */
function PromoCode({ applied, onApply, onQuote, typed, onTyped, fixed = false }: { /** The field is all the section holds (a card is the only way to pay): it stays open, with no way to shut it. */ fixed?: boolean; applied: Quote | null; onApply: (quote: Quote | null) => void; /** Quotes a code typed: the share it takes off what a card would pay. */ onQuote?: (code: string) => Promise<Quote>; /** What is typed in the field, which its owner holds: nothing is charged while a code waits there. */ typed: string; onTyped: (typed: string) => void }) {
  // A code already typed (it came back from Stripe's page in the address) opens the field with it.
  const [opened, setOpen] = useState(typed !== "");
  const open = fixed || opened;
  const [wrong, setWrong] = useState<string | null>(null);
  const [checking, check] = useTransition();
  const field = useRef<HTMLInputElement>(null);
  const wrongId = useId();
  const t = useTranslations("publishReports.flow.activation.promo");
  const close = useTranslations("common");
  const apply = () =>
    check(async () => {
      try {
        if (!onQuote) return;
        onApply(await onQuote(typed));
        setWrong(null);
        onTyped("");
      } catch (error) {
        const reason = promoReason(error);
        setWrong(reason ? t(reason, { code: typed.trim() }) : getErrorMessage(error, t("failed")));
        // Apply was disabled while the code was checked, which took the keyboard's place: it goes back to the field.
        field.current?.focus();
      }
    });
  const off = applied ? Math.round(applied.off * 100) : 0;
  return (
    // Room around it for the buttons' focus rings, which its height animation would clip (WebKit has no clip margin).
    <AutoHeight className="-mx-3 -my-1">
      <div className="@container/code px-3 py-1">
        {applied ? (
          // Too narrow for one line (a phone at large text), what it takes off and the way to remove it go under the code.
          <div className="flex min-h-[calc(2.25rem+2px)] items-center gap-2 text-sm @max-[11rem]/code:flex-wrap">
            <Tag className="size-4 shrink-0 text-muted-foreground" />
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
                // Opened by a press, it takes the keyboard; there from the start, it leaves the page where it is.
                autoFocus={!fixed && finePointer()}
                value={typed}
                maxLength={100}
                onChange={(e) => {
                  onTyped(e.target.value);
                  setWrong(null);
                }}
                placeholder={t("label")}
                ref={field}
                aria-label={t("label")}
                aria-invalid={!!wrong}
                aria-describedby={wrong ? wrongId : undefined}
                className="font-mono placeholder:font-sans"
              />
              {/* A code typed and not yet applied: Apply stands out as what to press next, in place of a line saying so. */}
              <Button type="submit" variant={typed.trim() ? "default" : "outline"} className="shrink-0" disabled={!typed.trim() || checking}>
                {t("apply")}
              </Button>
              {/* The way out for someone with no code: the field shuts, and what was typed in it goes. */}
              {fixed ? null : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground"
                aria-label={close("close")}
                onClick={() => {
                  onTyped("");
                  setWrong(null);
                  setOpen(false);
                }}
              >
                <X />
              </Button>
              )}
            </div>
            {wrong ? (
              <p id={wrongId} role="alert" className="text-xs text-destructive">
                {wrong}
              </p>
            ) : null}
          </form>
        ) : (
          // As tall as the field it opens into and the code it ends as, so neither moves what is under or beside it.
          <div className="flex min-h-[calc(2.25rem+2px)] items-center">
            <Button variant="ghost" size="sm" className="-ms-1.5 text-muted-foreground max-sm:h-auto max-sm:min-h-8 max-sm:max-w-full max-sm:whitespace-normal max-sm:text-start" onClick={() => setOpen(true)}>
              <Tag /> {t("add")}
            </Button>
          </div>
        )}
      </div>
    </AutoHeight>
  );
}

/** The return from Stripe's pages already brought into view: a page opens at its top, and on a phone the bar is below it. */
let returnedTo: string | null = null;
/**
 * Back from Stripe's page, or the bank's, the bar the person left from is brought into view, once per return: the
 * page opens at its top, which on a phone leaves the bar out of sight.
 */
function inViewOnReturn(node: HTMLDivElement | null) {
  if (!node) return;
  const mark = new URLSearchParams(window.location.search).get("back");
  if (!mark || mark === returnedTo) return;
  returnedTo = mark;
  node.scrollIntoView({ block: "center" });
}

/**
 * A payment for the report that is still to be made: on Stripe's page, where a workspace with no saved card pays, or
 * at the bank, which asked to confirm it. The way back to that page, and the way out: giving the payment up opens the
 * report's steps and its other ways of paying again. A report that can't go live any more, declined while its payment
 * waited, has only the way out: paying it now would publish nothing.
 */
function PendingPayment({ pending, goesLive, cancelling, onCancel }: { pending: NonNullable<Terms["pending"]>; /** Whether making the payment still puts the report live. */ goesLive: boolean; cancelling: boolean; onCancel?: () => void }) {
  const t = useTranslations("publishReports.flow.activation.card");
  return (
    <div ref={inViewOnReturn} className="mb-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-3 rounded-2xl bg-inset/60 p-3">
      <CreditCard className="size-4 shrink-0 self-start text-muted-foreground max-sm:hidden sm:mt-0.5" />
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm font-medium">{t(pending.checkout ? "unfinished" : "bankAsked")}</p>
        {goesLive ? <p className="mt-0.5 text-xs text-muted-foreground">{t("goesLive")}</p> : null}
      </div>
      {/* Side by side while they fit; on a narrow or enlarged phone they stack and their words wrap. */}
      <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2 max-sm:[&>*]:h-auto max-sm:[&>*]:min-h-8 max-sm:[&>*]:max-w-full max-sm:[&>*]:whitespace-normal max-sm:[&>*]:py-1.5">
        {onCancel ? (
          <Button variant="ghost" size="sm" className="relative text-muted-foreground" disabled={cancelling} onClick={onCancel}>
            <Working busy={cancelling}>{t("cancel")}</Working>
          </Button>
        ) : null}
        {pending.url && goesLive ? (
          <Button variant="outline" asChild>
            <a href={pending.url}>
              {t(pending.checkout ? "toPayment" : "confirm")} <ArrowUpRight />
            </a>
          </Button>
        ) : null}
      </div>
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
        <>
          <div className="mt-6 flex justify-end">
            <Button asChild>
              <Link href={`/papers/${report.key}`}>
                {t("openPage")} <ArrowUpRight />
              </Link>
            </Button>
          </div>
          {/* A member who can't change the report is still told how one comes down. */}
          <TakeDown reportKey={report.key} className="mt-4 text-end" />
        </>
      ) : null}
    </div>
  );
}

/** A live report is its author's to correct, not to remove: taking one down is asked of us, and this says how. */
function TakeDown({ reportKey, className }: { reportKey: string; className?: string }) {
  const t = useTranslations("publishReports.flow");
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      {t.rich("takeDown", {
        email: CONTACT_EMAIL,
        key: reportKey,
        mail: (chunks) => (
          <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(reportKey)}`} className="underline underline-offset-2 hover:text-foreground">
            {chunks}
          </a>
        ),
      })}
    </p>
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
  const { problem, say, failed } = useProblem();
  // Closed, it forgets what went wrong: opened again, it starts clean.
  const close = () => {
    say(null);
    onClose();
  };
  const send = () =>
    start(async () => {
      say(null);
      try {
        await onSend(comment);
        toast.success(t("sentToReviewer"));
        onClose();
      } catch (error) {
        failed(t("requestFailed"))(error);
      }
    });
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !sending && close()}>
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
        <Problem>{problem}</Problem>
        <DialogFooter>
          <Button variant="outline" disabled={sending} onClick={close}>
            {t("cancel")}
          </Button>
          <Button className="relative max-sm:h-auto max-sm:min-h-9 max-sm:shrink max-sm:py-1 max-sm:whitespace-normal" disabled={sending} onClick={send}>
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

/** Opens Stripe's receipt for what a live report was paid with, read on the press: a tab opens at once, before Stripe answers, so the browser doesn't take it for a pop-up and block it. */
function useReceipt(reportKey: string) {
  const t = useTranslations("publishReports.flow");
  const workspaceId = useWorkspace();
  const receiptOf = useAction(api.reports.activation.receipt);
  return () => {
    if (!workspaceId) return;
    const tab = window.open("", "_blank");
    void receiptOf({ workspaceId, key: reportKey }).then(
      (url) => {
        if (url && tab) tab.location.href = url;
        else tab?.close();
      },
      (error: unknown) => {
        tab?.close();
        said(t("paid.receiptFailed"))(error);
      },
    );
  };
}

/** The report once it's live: its seal, its DOI and where to go next. Plays its moment only right after Activate. */
/** The live report's file access, saved as it is picked; a refusal is said and the row shows what is saved. */
function LiveFileAccess({ report }: { report: Report }) {
  const workspaceId = useWorkspace();
  const setFileAccess = useMutation(api.reports.flow.setFileAccess);
  const t = useTranslations("publishReports.flow");
  return (
    <FileAccessChange
      licence={report.licence}
      saved={report.fileAccess}
      live
      disabled={!workspaceId}
      onSave={(fileAccess) => setFileAccess({ workspaceId: workspaceId!, key: report.key, fileAccess }).catch((error: unknown) => void toast.error(refusalOr(error, t("saveFailed"))))}
    />
  );
}

function LiveReport({ report, series, fresh }: { report: Report; /** The series it is published in, which its saved copy names. */ series: Parameters<typeof reportPaper>[2]; fresh: boolean }) {
  // The report as the app's papers are, for saving it: the same as its own page saves.
  const paper = report.metadata ? reportPaper({ key: report.key, doi: report.doi, pdfUrl: `/papers/${report.key}/report.pdf`, updatedAt: report.updatedAt }, report.metadata, series) : null;
  const reduce = useReducedMotion();
  const t = useTranslations("publishReports.flow");
  const tToast = useTranslations("toast");
  const format = useFormatter();
  const play = fresh && !reduce;
  // Each part rises in after the seal has drawn, in reading order.
  const rise = (delay: number) => (play ? { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay, duration: 0.4, ease: EASE } } : {});
  const url = `https://doi.org/${report.doi}`;
  const passed = report.results?.filter((r) => r.pass).length ?? 0;
  return (
    // As tall as the cover's column beside it (`ReportCover`'s `--cover-height`): the seal takes the height it has to
    // spare, centred, and the DOI, the buttons and the way to take it down end level with the column's foot.
    <div className="flex flex-col @3xl:min-h-[var(--cover-height,0px)]">
      <div className="flex flex-col items-center justify-center pb-7 pt-3 text-center @3xl:flex-1 @3xl:pb-12 @3xl:pt-10">
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
            <Button variant="ghost" size="icon-sm" aria-label={t("copyDoi")} className="text-muted-foreground" onClick={() => void copyText(url, { copied: t("doiCopied"), failed: tToast("couldntCopy"), select: tToast("copyFailedDescription") })}>
              <Copy />
            </Button>
          </TooltipHint>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <RegistrationChips report={report} own={report.archiveIn === "openscholar" ? undefined : report.archiveIn} />
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
        {/* "Live" beside "Sending to Crossref" left people unsure whether to wait: the page is open now, the DOI follows. */}
        {/* It goes when the registrations are done: closed over a moment, so the buttons below don't jump under a finger. */}
        <AutoHeight>{stepsOf(report).some((step) => step.state === "working" || step.state === "waiting") ? <p className="pt-3 text-xs text-muted-foreground">{t("registering")}</p> : null}</AutoHeight>
      </motion.div>
      {/* Who gets its PDF, which those who may change the report change here as on its agreement: its registrars take it again. */}
      {report.mayChange ? (
        <motion.div className="mt-6" {...rise(0.75)}>
          <LiveFileAccess report={report} />
        </motion.div>
      ) : null}
      {/* On a phone the three are even rows, in place of a ragged wrap; at large text, one column. A label wider than its button wraps and the button grows. */}
      <motion.div className="mt-6 flex flex-wrap justify-end gap-2 max-sm:grid max-sm:grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] max-sm:[&>*]:h-auto max-sm:[&>*]:min-h-9 max-sm:[&>*]:w-full max-sm:[&>*]:whitespace-normal" {...rise(0.8)}>
        {/* The app's own three, as on the report's page: save to the library, add to a collection, add to a community. */}
        {paper ? <SaveControl paper={paper} named /> : null}
        <Button asChild size="sm">
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
  const { problem, say, failed } = useProblem();
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
          <CheckRow key={r.checkId} name={r.name} result={r} advice={(stage === "failed" || stage === "review") && !overruled.has(r.checkId)} />
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
      <Problem className="pt-3">{problem}</Problem>
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
            <AlertDialogAction onClick={() => (say(null), void onDiscard().then(() => toast.success(t("changesDiscarded")), failed(t("changesDiscardFailed"))))}>{t("discard")}</AlertDialogAction>
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
function ReportCover({ basics, report, slot }: { basics: Basics; report: Report | null; /** Given the element under the cover, on a wide page, where a step shows what it is working out. */ slot?: (element: HTMLDivElement | null) => void }) {
  const t = useTranslations("publishReports.flow");
  const format = useFormatter();
  const m = report?.metadata;
  const live = report?.step === "done" && report.status === "live";
  // Its height on the grid it stands in (`--cover-height`), which a screen beside it fills to stand level with it. A
  // ResizeObserver, as the cover, its facts and its bill grow.
  const aside = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = aside.current;
    const grid = element?.parentElement;
    if (!element || !grid) return;
    const set = () => grid.style.setProperty("--cover-height", `${element.offsetHeight}px`);
    set();
    const observer = new ResizeObserver(set);
    observer.observe(element);
    return () => {
      observer.disconnect();
      grid.style.removeProperty("--cover-height");
    };
  }, []);
  // The report's facts, as rows of a label and its value, as the bill under them reads.
  const facts: Array<{ id: string; label: string; value: ReactNode; href?: string }> = [
    ...(live ? [{ id: "status", label: t("status"), value: <span className="inline-flex items-center gap-1 font-medium ink-success"><BadgeCheck className="size-3.5" />{t("live")}</span> }] : []),
    ...(report?.pdf?.pages !== undefined ? [{ id: "pdf", label: t("steps.upload"), value: t("pages", { count: report.pdf.pages }) }] : []),
    ...(report ? [{ id: "agreement", label: t("steps.agreement"), value: t("version", { version: report.agreementVersion }), href: `/publish/agreements/${report.key}` }] : []),
    ...(report?.checksVersion ? [{ id: "checks", label: t("steps.checks"), value: t("version", { version: report.checksVersion }) }] : []),
    // What was chosen when it was signed, kept in sight on the steps after, where the choices are locked. Live, the
    // screen shows both itself: who gets the file, and the archive's chip.
    ...(report && !live ? [{ id: "file", label: t("fileAccess.short"), value: report.fileAccess.mode === "embargo" ? t("fileAccess.until", { date: format.dateTime(new Date(`${report.fileAccess.until}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" }) }) : t(`fileAccess.${report.fileAccess.mode}`) }] : []),
    ...(report?.registration.zenodo && !live ? [{ id: "archive", label: t("archive.label"), value: t(report.archiveIn === "openscholar" ? "archive.openscholar" : report.archiveIn === "mine" ? "archive.own" : "archive.signers") }] : []),
  ];
  return (
    // Beside the steps on a wide card; under them on a narrow one, the cover small with its caption next to it, or above
    // it on a phone at large text, where the cover would leave the caption and the bill no room. The query reads the
    // page, which is under 18rem on a phone only from 125% text: at 150% on a 390px phone the caption beside the cover
    // was 100px. Once the page is under 22rem, from 112.5% text on a 390px phone, a fact or a bill line too long for its
    // row puts its value under its label, and a label too long for the caption wraps instead of being cut, nested ones
    // such as the Stripe credit's included: at 112.5% and 125% the cover is still beside a caption of 118 to 172px, where
    // "Agreement" was cut to "A…". At normal text (22.5rem on a 360px phone) every row stays as it was. As the page
    // scrolls it stays under the page's bar, as far from it as it is from the card's edge.
    <aside ref={aside} className="flex items-start gap-4 max-sm:@max-[18rem]:flex-col @3xl:sticky @3xl:top-[calc(var(--app-navbar-height)+var(--page-header-height,4rem)+1.5rem)] @3xl:block @3xl:self-start">
      <PaperCover
        className="w-28 shrink-0 @3xl:w-full"
        {...REPORT_COVER}
        title={m?.title || t("yourTitle")}
        authors={m?.authors.filter(isAuthor).map((a) => a.name).filter(Boolean) ?? []}
        source={basics.series.name}
        year={m?.date ? Number(m.date.slice(0, 4)) : null}
        type="report"
        // The picture of the PDF's first page takes the title page's place once it's made.
        image={report?.coverUrl ?? null}
        shape={report?.coverShape ?? null}
        href={report?.pdf?.url ?? null}
        pdf={!!report?.pdf?.url}
      />
      <div className="min-w-0 flex-1 max-sm:@max-[18rem]:w-full max-sm:@max-[22rem]:[&_dl>div]:flex-wrap max-sm:@max-[22rem]:[&_dt]:whitespace-normal max-sm:@max-[22rem]:[&_dt_.truncate]:whitespace-normal @3xl:mt-4">
        <TooltipHint label={report ? `doi.org/${report.doi}` : ""} onlyWhenClipped>
          <p dir="ltr" className={cn("truncate font-mono text-xs", report ? "text-foreground" : "text-muted-foreground")}>{report ? `doi.org/${report.doi}` : t("noDoi")}</p>
        </TooltipHint>
        <p className="mt-0.5 flex items-center gap-0.5 text-xs text-muted-foreground">
          {basics.series.issn ? t("issn", { issn: basics.series.issn }) : t("issnPending")}
          <FieldHelp field="issn" />
        </p>
        {facts.length > 0 ? (
          <dl className="mt-4 space-y-1.5 border-t border-border-subtle pt-3 text-sm">
            {facts.map((fact) => (
              <div key={fact.id} className="fade-enter flex items-center justify-between gap-3">
                {/* The labels are a word each and keep it; a long value ("Private until Nov 20, 2027") wraps instead. */}
                <dt className="shrink-0 text-muted-foreground">{fact.label}</dt>
                <dd className="min-w-0 text-end tabular-nums">
                  {fact.href ? (
                    // The agreement as signed, in a tab of its own to read, save or print.
                    <Link href={fact.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 rounded-sm underline-offset-2 outline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                      {fact.value} <ArrowUpRight className="size-3" />
                    </Link>
                  ) : (
                    fact.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {/* Where a step shows what it is working out, on a wide page: the agreement's bill. */}
        <div ref={slot} />
      </div>
    </aside>
  );
}
