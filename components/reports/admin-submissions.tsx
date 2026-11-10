"use client";

// Settings > Admin > Publishing, Submissions (plans/publish-reports): every report whose checks have run, with a
// dialog per report where a reviewer approves, declines, withdraws or reinstates it, decides on changes to a live
// one, and opens its details to edit.

import { useState, useTransition, type ReactNode, useRef } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useLocale, useTranslations } from "next-intl";
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { ENTRY_OPEN, Entry } from "@/components/command-center/entry";
import { Field } from "@/components/evidence-libraries/configuration/section-card";
import { StatusChip, StatusIcon } from "@/components/evidence-libraries/configuration/status-chip";
import { FunderName } from "@/components/papers/paper-entities";
import { CheckRow } from "@/components/reports/publish-flow";
import { RegistrationChips, standingOf, stepTone, stepWords } from "@/components/reports/registration";
import { Enter, LIST, Paged, Segmented, Working, Zone, pagerOf } from "@/components/settings/parts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { CountryFlag } from "@/components/ui/country-flag";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TooltipHint } from "@/components/ui/tooltip";
import Link from "@/components/workspace-link";
import { ArrowUpRight, BadgeCheck, Building2, Check, CircleCheck, CircleX, FileText, Hash, PenLine, ReviewQueueIcon, RotateCcw, Search, SearchX, ShieldCheck } from "@/components/icons";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { getRegionDisplayName } from "@/lib/i18n/region-names";
import { SDGS } from "@/lib/openalex/vocabulary";
import { REVIEW_TEXT_MAX, changesOf, stageOf, type Metadata, type Stage } from "@/lib/reports/report";
import { getErrorMessage } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";

type Page = FunctionReturnType<typeof api.reports.review.page>;
type Row = Page["rows"][number];
type Report = NonNullable<FunctionReturnType<typeof api.reports.review.get>>;

export const SHOWS = ["all", "review", "ready", "live", "failed", "declined"] as const;
type Show = (typeof SHOWS)[number];
const SORTS = ["newest", "oldest", "title"] as const;
type Sort = (typeof SORTS)[number];
/** A pause in typing this long ends one search: what is typed next is another. */
const SEARCH_PAUSE_MS = 1000;
const PER_PAGE = 8;
/** A row with its divider: an entry's padding and its two lines. */
const ROW = 73;

const STATUS: Record<Exclude<Stage, "draft">, { label: string; tone: "running" | "success" | "danger" | "neutral"; icon: typeof Check }> = {
  review: { label: "In review", tone: "running", icon: ReviewQueueIcon },
  ready: { label: "Ready to activate", tone: "success", icon: CircleCheck },
  live: { label: "Live", tone: "success", icon: BadgeCheck },
  failed: { label: "Failed checks", tone: "danger", icon: CircleX },
  declined: { label: "Declined", tone: "neutral", icon: CircleX },
};
const SHOW_LABEL: Record<Show, string> = { all: "All", review: "In review", ready: "Ready to activate", live: "Live", failed: "Failed", declined: "Declined" };
const CHANGES = { review: { label: "Changes to review", tone: "running" }, failed: { label: "Changes failed a check", tone: "danger" }, declined: { label: "Changes declined", tone: "neutral" } } as const;
const REVIEWED: Record<Report["reviews"][number]["decision"], string> = { approve: "Approved", decline: "Declined", withdraw: "Withdrawn", reinstate: "Reinstated", "approve-changes": "Changes approved", "decline-changes": "Changes declined", edit: "Details edited" };
/** What a reviewer is asked before saying no, each with room for a note to the author. */
const ASKS = {
  decline: { title: "Decline this report?", says: "It isn't published, and its author reads your note on the report.", action: "Decline" },
  withdraw: { title: "Withdraw this report?", says: "Its page will say it was withdrawn. Its DOI keeps leading to that page. You can reinstate it later.", action: "Withdraw" },
  "decline-changes": { title: "Decline these changes?", says: "The report stays live as it was. Its author can change the details and send them again.", action: "Decline the changes" },
} as const;
/** The dialog's buttons, kept in view at its foot however long the report above them is. */
const FOOT = "sticky -bottom-6 z-10 -mx-6 -mb-6 border-t border-border-subtle bg-background px-6 py-4";

const day = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const failed = (error: unknown) => void toast.error(getErrorMessage(error, "Something went wrong"));
/** A report's status in words. A declined report that had been live was withdrawn. */
const labelOf = (report: { withdrawn: boolean }, stage: Exclude<Stage, "draft">) => (stage === "declined" && report.withdrawn ? "Withdrawn" : STATUS[stage].label);

/** The list as it's searched, filtered, sorted and paged, in the address, so a reload or a link comes back to the same place. */
export const LIST_PLACE = {
  q: parseAsString.withDefault(""),
  show: parseAsStringLiteral(SHOWS).withDefault("all"),
  sort: parseAsStringLiteral(SORTS).withDefault("newest"),
  page: parseAsInteger.withDefault(1),
};

export function Submissions({ open, onOpen, onEdit }: { /** The report the address names. */ open: string | null; onOpen: (key: string | null) => void; onEdit: () => void }) {
  const [{ q: query, show, sort, page }, setList] = useQueryStates(LIST_PLACE);
  const { data: list } = useProtectedQuery(api.reports.review.page, { page, show, sort, ...(query.trim() && { q: query.trim() }) });
  const { data: opened } = useProtectedQuery(api.reports.review.get, open ? { key: open } : "skip");
  // The last page read stays up, dimmed, while a search, a filter or the next page is read.
  const [shown, setShown] = useState(list);
  if (list && list !== shown) setShown(list);
  // The report in the dialog stays as it was while it closes, so the fade-out shows what was there.
  const [last, setLast] = useState(opened);
  if (opened && opened !== last) setLast(opened);
  const decide = useMutation(api.reports.review.decide);
  // When the search box was last typed in, which tells typing on from starting another search.
  const typed = useRef(0);
  if (!shown) return <Enter ready={false}>{null}</Enter>;
  // Another filter or order is another list, and a step Back returns from; typing in the box changes the address in place.
  const step = (next: Parameters<typeof setList>[0]) => void setList(next, { history: "push", scroll: false });
  const pager = pagerOf(shown.total, PER_PAGE, shown.page, (next) => void setList({ page: next }, { history: "push", scroll: true }));
  return (
    <Zone label={shown.series}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            {/* Each search is a step Back returns from: one starts with the first letter typed, or the first after a
                pause, and the letters typed on from there change it in place. */}
            <Input
              value={query}
              onChange={(e) => {
                const now = Date.now();
                const another = !query || now - typed.current > SEARCH_PAUSE_MS;
                typed.current = now;
                void setList({ q: e.target.value, page: null }, { history: another ? "push" : "replace", scroll: false });
              }}
              placeholder="Find a report, its key or its DOI"
              aria-label="Find a report"
              className="h-9 ps-9"
            />
          </div>
          <Select value={sort} onValueChange={(v) => step({ sort: v as Sort, page: null })}>
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
        <Segmented label="Which reports" value={show} fill="labels" onChange={(next) => step({ show: next, page: null })} options={SHOWS.map((id) => ({ id, label: SHOW_LABEL[id], detail: <span className="tabular-nums opacity-70">{shown.counts[id]}</span> }))} />
        <div className={cn("transition-opacity", !list && "opacity-60")} aria-busy={!list || undefined}>
          <Paged pager={pager} rowHeight={ROW} label="reports">
            {shown.rows.length ? (
              <ul className={LIST}>
                {shown.rows.map((row) => (
                  <SubmissionRow
                    key={row.key}
                    row={row}
                    stage={stageOf(row, shown.humanReview)}
                    onOpen={() => onOpen(row.key)}
                    onApprove={() => decide({ key: row.key, decision: "approve", ...(row.pdfAt !== undefined && { seenPdfAt: row.pdfAt }) }).then(() => void toast.success("Approved. Its author can activate it now."), failed)}
                  />
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
      </div>
      <SubmissionDialog report={open ? (opened ?? null) : null} last={last ?? null} onClose={() => onOpen(null)} onEdit={onEdit} />
      {/* A link to a report that is no longer there says so, in place of a page that shows nothing. */}
      <Dialog open={!!open && opened === null} onOpenChange={(next) => !next && onOpen(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>This report isn&apos;t here</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{open}</span> was discarded by its author before it was checked, or the link is wrong.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </Zone>
  );
}

function SubmissionRow({ row, stage, onOpen, onApprove }: { row: Row; stage: Stage; onOpen: () => void; onApprove: () => Promise<void> }) {
  const [busy, start] = useTransition();
  const status = stage === "draft" ? undefined : STATUS[stage];
  // A live report's registrations: the one refused, else the one under way, else the last one done.
  const standing = row.status === "live" ? standingOf(row) : null;
  const wants = row.changes === "review" ? CHANGES.review.label : stage === "failed" && row.asked ? "Review asked" : null;
  const title = row.title ?? "Untitled";
  return (
    // An entry of the app's lists: the whole row opens the report, and on a phone its status and actions take a
    // line of their own under the title, which keeps its width.
    <li>
      <Entry viewMode="list-detail" className="items-center">
        <div className="min-w-0 flex-1 space-y-0.5">
          <button type="button" onClick={onOpen} className={cn(ENTRY_OPEN, "block w-full")}>
            <span className="block truncate">{title}</span>
          </button>
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {row.first?.country ? <CountryFlag countryCode={row.first.country} /> : null}
            <span className="truncate">{row.first?.name ?? row.signer}</span>
            <span className="shrink-0 font-mono">{row.key}</span>
            <span className="shrink-0 tabular-nums">{day(row.updatedAt)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 max-sm:basis-full max-sm:justify-between">
          <span className="flex items-center gap-2">
            {standing ? <StatusIcon className="relative z-10" tone={stepTone(standing)} label={stepWords(standing)} icon={standing.state === "done" ? Hash : undefined} /> : null}
            {row.changes && !wants ? <StatusIcon className="relative z-10" tone={CHANGES[row.changes].tone} label={CHANGES[row.changes].label} icon={PenLine} /> : null}
            {status && stage !== "draft" ? (
              // A row that wants a reviewer says what for, in place of where the report stands.
              <StatusChip tone={wants ? "running" : status.tone} icon={wants ? ReviewQueueIcon : status.icon} className="shrink-0">
                {wants ?? labelOf(row, stage)}
              </StatusChip>
            ) : null}
          </span>
          {/* Room for the two quick actions a row can have, so every row's status ends on the same line. */}
          <span className="relative z-10 flex min-w-[4.25rem] shrink-0 justify-end gap-1">
            {stage === "review" ? (
              <>
                <TooltipHint label="Decline with a note">
                  <Button variant="ghost" size="icon-sm" aria-label={`Decline ${row.key}`} className="text-muted-foreground hover:text-destructive" onClick={onOpen}>
                    <CircleX />
                  </Button>
                </TooltipHint>
                <TooltipHint label="Approve">
                  <Button variant="ghost" size="icon-sm" aria-label={`Approve ${row.key}`} className="relative text-primary" disabled={busy} onClick={() => start(onApprove)}>
                    <Working busy={busy}>
                      <Check />
                    </Working>
                  </Button>
                </TooltipHint>
              </>
            ) : row.status === "live" ? (
              <TooltipHint label="Open its page">
                <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground">
                  <Link href={`/papers/${row.key}`} aria-label={`Open the page of ${row.key}`}>
                    <ArrowUpRight />
                  </Link>
                </Button>
              </TooltipHint>
            ) : null}
          </span>
        </div>
      </Entry>
    </li>
  );
}

function SubmissionDialog({ report, last, onClose, onEdit }: { /** The report open now; null when none is. */ report: Report | null; /** The one last open, shown while the dialog closes. */ last: Report | null; onClose: () => void; /** Opens the report's details in the form. */ onEdit: () => void }) {
  const decideReport = useMutation(api.reports.review.decide);
  const decideItsChanges = useMutation(api.reports.review.decideChanges);
  const [note, setNote] = useState("");
  const [busy, start] = useTransition();
  const s = report ?? last;
  /** Sends a reviewer's word. A refusal, when the report moved on since it was opened, is said and the dialog stays. */
  const send = (run: () => Promise<unknown>, done: string) =>
    start(async () => {
      try {
        await run();
        toast.success(done);
        setNote("");
        onClose();
      } catch (error) {
        failed(error);
      }
    });
  // Saying no asks first, with room for a note to the author: declining a report, withdrawing a live one, which
  // takes its page down for everyone, or declining changes to it. It belongs to the report it was opened on:
  // another report opened meanwhile, as by Back, never inherits it.
  // It is also for the PDF and the changes that were open when it was asked: ones that replaced them while the
  // question stood are never what the answer is given on.
  const [asked, setAsked] = useState<{ report: string; what: keyof typeof ASKS; pdfAt?: number; changesAt?: number } | null>(null);
  const asking = asked && asked.report === s?.key ? asked.what : null;
  const setAsking = (what: keyof typeof ASKS | null) => setAsked(what && s ? { report: s.key, what, pdfAt: s.pdf?.at, changesAt: s.status === "live" ? s.correction?.at : undefined } : null);
  const DONE = { approve: "Approved. Its author can activate it now.", reinstate: "Reinstated. It's live again.", withdraw: "Withdrawn", decline: "Declined" };
  const decide = (decision: keyof typeof DONE) => {
    const seenPdfAt = asking ? asked!.pdfAt : s?.pdf?.at;
    return s && send(() => decideReport({ key: s.key, decision, ...(seenPdfAt !== undefined && { seenPdfAt }), ...(note.trim() && { note: note.trim() }) }), DONE[decision]);
  };
  const correction = s?.status === "live" ? s.correction : undefined;
  const changes = s && correction ? { correction, stage: s.changes ?? "review" } : null;
  /** The reviewer's word on changes to a live report: the ones open here, by when they were checked. */
  const decideChanges = (decision: "approve" | "decline") =>
    s && changes && send(() => decideItsChanges({ key: s.key, decision, seenAt: (asking ? asked!.changesAt : undefined) ?? changes.correction.at, ...(note.trim() && { note: note.trim() }) }), decision === "approve" ? "Changes approved. They're live." : "Changes declined. The report stays as it was.");
  const changed = s?.metadata && changes ? changesOf(s.metadata, changes.correction.metadata) : [];
  // Why the changes stand where they do, for a reviewer who arrives from an email.
  const approvedOver = new Set((s?.results ?? []).filter((r) => !r.pass).map((r) => r.checkId));
  const short = changes?.correction.results.filter((r) => !r.pass) ?? [];
  const again = short.filter((r) => approvedOver.has(r.checkId)).map((r) => r.name);
  const why = !changes
    ? ""
    : changes.stage === "declined"
      ? "A reviewer declined these. The author can change them and send them again, or discard them."
      : changes.stage === "failed"
        ? "A check these changes newly fail left them with the author, who can fix them or ask for a review. You can still decide."
        : changes.correction.request
          ? "A check failed, and the author asked for a review."
          : again.length
            ? `${again.join(" and ")} failed again. A reviewer approved this report over ${again.length === 1 ? "it" : "them"} before, so its changes need a reviewer too.`
            : short.length
              ? "A check flagged these changes."
              : "Human review is on, so changes wait for a reviewer.";
  const stage = s ? stageOf(s, s.humanReview) : undefined;
  const status = stage && stage !== "draft" ? STATUS[stage] : undefined;
  // A reviewer's own edit of the details, at the start of the dialog's buttons and apart from the decisions. Not
  // while the author's changes are waiting: those are decided first.
  const edits =
    s?.metadata && s.step === "done" && !s.correction ? (
      <Button variant="outline" className="sm:me-auto" disabled={busy} onClick={onEdit}>
        <PenLine /> Edit the details
      </Button>
    ) : (
      <span className="sm:me-auto" />
    );
  return (
    <Dialog open={!!report} onOpenChange={(open) => !open && onClose()}>
      {/* One column no wider than the dialog: a long title or link wraps or is cut, and never widens it. */}
      <DialogContent className="max-h-[85vh] grid-cols-1 overflow-y-auto sm:max-w-2xl">
        {s ? (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{s.key}</span>
                {status && stage && stage !== "draft" ? <StatusChip tone={status.tone} icon={status.icon}>{labelOf(s, stage)}</StatusChip> : <StatusChip tone="neutral" icon={PenLine}>With its author</StatusChip>}
                {s.status === "live" ? (
                  <Link href={`/papers/${s.key}`} className="flex items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                    Open its page <ArrowUpRight className="size-3" />
                  </Link>
                ) : null}
              </div>
              <DialogTitle className="line-clamp-4 break-words text-lg leading-snug">{s.metadata?.title || s.title || "Untitled"}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {s.metadata?.authors.map((a, i) => (
                  <span key={`${a.name}:${i}`} className="inline-flex items-center gap-1.5">
                    {a.affiliations[0]?.country ? <CountryFlag countryCode={a.affiliations[0].country} /> : null}
                    {a.name}
                  </span>
                ))}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-5">
              {changes ? (
                // Changes to a live report that haven't gone live: what they are, what the checks said, and the author's words.
                <div className="space-y-3 rounded-xl bg-inset p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <PenLine className="size-3.5 text-primary" /> The author changed the details
                      <span className="tabular-nums">{day(changes.correction.at)}</span>
                    </span>
                    <StatusChip tone={CHANGES[changes.stage].tone}>{CHANGES[changes.stage].label}</StatusChip>
                  </div>
                  <p className="text-sm text-muted-foreground">{why}</p>
                  {[
                    { label: "The author says", words: changes.correction.request ? changes.correction.request.comment || "No comment" : "" },
                    { label: "The reviewer's note", words: changes.correction.declined?.note ?? "" },
                  ].map(({ label, words }) =>
                    words ? (
                      <div key={label} className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">{label}</p>
                        <p className="whitespace-pre-wrap break-words text-sm">{words}</p>
                      </div>
                    ) : null,
                  )}
                  <dl className="space-y-3">
                    {changed.map((c) => (
                      <div key={c.label} className="space-y-1">
                        <dt className="text-xs font-medium text-muted-foreground">{c.label}</dt>
                        <dd className="grid gap-1 text-sm sm:grid-cols-2 sm:gap-3">
                          <span className="line-clamp-6 whitespace-pre-wrap break-words text-muted-foreground line-through decoration-muted-foreground/40">{c.from || "Empty"}</span>
                          <span className="line-clamp-6 whitespace-pre-wrap break-words">{c.to || "Empty"}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <ul className={cn(LIST, "bg-background")}>
                    {changes.correction.results.map((r) => (
                      // What the author is told to do about a check is theirs to read, and a live report takes no new PDF.
                      <CheckRow key={r.checkId} name={r.name} result={r} advice={false} />
                    ))}
                  </ul>
                </div>
              ) : null}
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
                  {s.pdf?.url ? (
                    <a href={s.pdf.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-1 font-medium underline decoration-border underline-offset-4 hover:decoration-foreground">
                      <span className="truncate">{s.pdf.pages === undefined ? "Open the PDF" : `Open the PDF, ${s.pdf.pages} ${s.pdf.pages === 1 ? "page" : "pages"}`}</span>
                      <ArrowUpRight className="size-3 shrink-0" />
                    </a>
                  ) : (
                    "None"
                  )}
                </Fact>
                <Fact icon={Building2} label="Owner" wide>
                  <span className="truncate">{[s.workspace, s.owner.name, s.owner.email].filter(Boolean).join(", ")}</span>
                </Fact>
                <Fact icon={PenLine} label="Signed">
                  <Link href={`/publish/agreements/${s.key}`} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-1 underline decoration-border underline-offset-4 hover:decoration-foreground">
                    <span className="truncate">{s.signer}</span>
                    <ArrowUpRight className="size-3 shrink-0" />
                  </Link>{" "}
                  <Tag>v{s.agreementVersion}</Tag>
                </Fact>
                <Fact icon={ShieldCheck} label="Checks">
                  {s.results?.filter((r) => r.pass).length ?? 0} of {s.results?.length ?? 0} passed {s.checksVersion ? <Tag>v{s.checksVersion}</Tag> : null}
                </Fact>
              </div>
              {/* What the checks said comes straight after the facts: it is what a reviewer decides on. With changes
                  open, their checks above are the ones to read, and the report's own would say most of it twice. */}
              {s.results?.length && !changes ? (
                <ul className={LIST}>
                  {s.results.map((r) => (
                    <CheckRow key={r.checkId} name={r.name} result={r} />
                  ))}
                </ul>
              ) : null}
              {s.status === "live" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <RegistrationChips report={s} />
                  {s.correctedAt ? <StatusChip tone="neutral" icon={PenLine}>Corrected {day(s.correctedAt)}</StatusChip> : null}
                </div>
              ) : null}
              {s.reviews.length ? (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {s.reviews.map((r) => (
                    <li key={`${r.at}:${r.decision}`} className="flex flex-wrap items-center gap-x-1.5">
                      <ReviewQueueIcon className="size-3.5 shrink-0" />
                      <span className="font-medium text-foreground/80">{REVIEWED[r.decision]}</span> by {r.by}
                      <span className="tabular-nums">{day(r.at)}</span>
                      {r.decision === "edit" && r.note ? <span className="truncate">{r.note}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {s.metadata?.abstract ? <p className="line-clamp-5 text-sm/6 text-muted-foreground">{s.metadata.abstract}</p> : null}
              {s.metadata ? <Subjects m={s.metadata} /> : null}
              {s.status === "declined" && s.note ? <p className="whitespace-pre-wrap break-words rounded-xl bg-inset p-3 text-sm">{s.note}</p> : null}
            </div>
            {/* A reviewer acts on any report, whatever its checks said: approve one not yet cleared, decline it, withdraw a live one, or reinstate a withdrawn one. */}
            {stage === "declined" && s.withdrawn ? (
              <DialogFooter className={FOOT}>
                {edits}
                <Button className="relative" disabled={busy} onClick={() => decide("reinstate")}>
                  <Working busy={busy}>
                    <span className="flex items-center gap-2">
                      <RotateCcw /> Reinstate
                    </span>
                  </Working>
                </Button>
              </DialogFooter>
            ) : stage && stage !== "declined" && stage !== "draft" ? (
              <DialogFooter className={FOOT}>
                {stage === "live" ? (
                  // What a reviewer does to the report itself sits at the start, apart from the buttons about
                  // changes; withdrawing asks before it happens.
                  <>
                    <Button variant="outline" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => setAsking("withdraw")}>
                      <CircleX /> Withdraw the report
                    </Button>
                    {edits}
                  </>
                ) : (
                  <>
                    {edits}
                    <Button variant="outline" disabled={busy} onClick={() => setAsking("decline")}>
                      <CircleX /> Decline
                    </Button>
                  </>
                )}
                {/* Changes waiting have their own word: the report stays live either way. */}
                {changes && changes.stage !== "declined" ? (
                  <>
                    <Button variant="outline" disabled={busy} onClick={() => setAsking("decline-changes")}>
                      <CircleX /> Decline the changes
                    </Button>
                    <Button className="relative" disabled={busy} onClick={() => decideChanges("approve")}>
                      <Working busy={busy}>
                        <span className="flex items-center gap-2">
                          <Check /> Approve the changes
                        </span>
                      </Working>
                    </Button>
                  </>
                ) : null}
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
            ) : stage === "declined" && s.metadata ? (
              // A declined report has no decision left to take, and its details can still be put right.
              <DialogFooter className={FOOT}>{edits}</DialogFooter>
            ) : null}
            <AlertDialog
              open={!!asking}
              onOpenChange={(open) => {
                if (open) return;
                setAsking(null);
                setNote("");
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{asking ? ASKS[asking].title : ""}</AlertDialogTitle>
                  <AlertDialogDescription>{asking ? ASKS[asking].says : ""}</AlertDialogDescription>
                </AlertDialogHeader>
                <Field label="Note to the author" counter={`${note.length} / ${REVIEW_TEXT_MAX}`}>
                  {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={REVIEW_TEXT_MAX} placeholder="Optional. They read it on the report." autoFocus />}
                </Field>
                <AlertDialogFooter>
                  <AlertDialogCancel>{asking === "withdraw" ? "Keep it live" : "Cancel"}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => (asking === "decline-changes" ? decideChanges("decline") : asking ? decide(asking) : undefined)}>{asking ? ASKS[asking].action : ""}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** What the report is about and who paid for it, as chips: topics, goals, places and funders. */
function Subjects({ m }: { m: Metadata }) {
  const locale = useLocale();
  const tf = useTranslations("searchFilters");
  // A place's name: a country's, or a region's as the country filter names it ("africa", "eastern_africa").
  const placeName = (id: string) => getRegionDisplayName(id, locale, (key) => (tf as (key: string) => string)(key));
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
const Tag = ({ children }: { children: ReactNode }) => <span className="shrink-0 rounded bg-background px-1.5 text-2xs tabular-nums text-muted-foreground">{children}</span>;

function Fact({ icon: Icon, label, wide = false, children }: { icon: typeof Hash; label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5 rounded-xl bg-inset px-3 py-2", wide && "sm:col-span-2")}>
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="w-14 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 truncate">{children}</span>
    </div>
  );
}
