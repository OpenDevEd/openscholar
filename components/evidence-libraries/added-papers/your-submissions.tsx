"use client";

import { useRef, useState, type ReactNode } from "react";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, CircleX, ExternalLink, ReviewQueueIcon, SearchX, Trash2, Undo2 } from "@/components/icons";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TooltipHint } from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { paperHref, recordHref, SUBMISSIONS_COUNTED } from "@/lib/evidence-libraries/added-papers";
import { useCursorPageAt } from "@/lib/hooks/use-cursor-page";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspaces/url";
import { StatusChip } from "../configuration/status-chip";
import { LIST_FILTER, ListEmpty, ListLoading, STALE_ROWS } from "../list-controls";
import { CommunityIcon } from "../your-communities";
import { LINK, refusalOr } from "./add-papers-dialog";

/** Submissions a page shows. */
const PER_PAGE = 8;
/** A row's height, which every row keeps, so a page holds its height and the pager stays put. */
const ROW_REM = 4;

const SHOWS = ["all", "queued", "published", "returned", "withdrawn", "removed"] as const;
type Show = (typeof SHOWS)[number];
type Submission = FunctionReturnType<typeof api.evidenceLibraries.submissions.mine>["page"][number];

/**
 * The person's submissions, read with the Communities page whichever tab it shows, so the list is there when its tab
 * is picked: the page shown, of the status picked and the page's search, and how many there are of each status.
 */
export function useSubmissions(search: string, signedIn: boolean) {
  const [show, setShow] = useState<Show>("all");
  const read = useCursorPageAt("page", api.evidenceLibraries.submissions.mine, signedIn ? { ...(show === "all" ? {} : { status: show }), ...(search ? { search } : {}) } : "skip", PER_PAGE);
  const counts = useProtectedQuery(api.evidenceLibraries.submissions.counts, signedIn ? {} : "skip").data;
  return { read, counts, show, setShow };
}

/**
 * Every paper you sent to a community, yours or a public one, and where it got to: waiting in its review queue,
 * published, declined with the reviewer's reason, or withdrawn by you. One still waiting can be withdrawn.
 */
export function YourSubmissions({ search, heading, submissions }: { search: string; heading: ReactNode; submissions: ReturnType<typeof useSubmissions> }) {
  const t = useTranslations("addedPapers");
  const format = useFormatter();
  const { read, counts, show, setShow } = submissions;
  const label: Record<Show, string> = { all: t("everyStatus"), queued: t("inQueue"), published: t("statusPublished"), returned: t("returned"), withdrawn: t("statusWithdrawn"), removed: t("statusRemoved") };

  return (
    <section aria-label={t("tabSubmissions")} className="@container/subs flex min-w-0 flex-col p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {heading}
        <Select value={show} onValueChange={(value) => setShow(value as Show)}>
          <SelectTrigger size="sm" aria-label={t("statusLabel")} className={cn("w-44", LIST_FILTER)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {SHOWS.map((id) => (
              <SelectItem key={id} value={id}>
                <span className="flex w-full items-center justify-between gap-3">
                  {label[id]}
                  {counts ? (
                    <span className="fade-enter tabular-nums text-muted-foreground">
                      {/* Past the count's cap, it's at least that many. */}
                      {format.number(counts[id])}
                      {counts.capped && (id === "all" || counts[id] >= SUBMISSIONS_COUNTED) ? "+" : ""}
                    </span>
                  ) : null}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <AutoHeight>
        {read.isLoading ? (
          <ListLoading label={t("tabSubmissions")} />
        ) : read.items.length ? (
          // A full page's height while there are pages, so a short last page keeps the pager where it was.
          <ul
            key={`${show}:${search}:${read.page}`}
            className={cn("fade-enter divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle", read.isStale && STALE_ROWS)}
            inert={read.isStale || undefined}
            style={read.hasPages ? { minHeight: `calc(${PER_PAGE * ROW_REM}rem + ${PER_PAGE + 1}px)` } : undefined}
          >
            {read.items.map((submission) => (
              <SubmissionRow key={submission.submissionId} submission={submission} date={format.dateTime(submission.sentAt, { day: "numeric", month: "short" })} />
            ))}
          </ul>
        ) : (
          <ListEmpty icon={SearchX} description={search || show !== "all" ? undefined : t("noneYetHint")}>
            {search || show !== "all" ? t("noMatches") : t("noneYet")}
          </ListEmpty>
        )}
        {read.hasPages ? (
          <CommandCenterPagination
            className="mt-4"
            currentPage={read.page}
            itemLabel="submissions"
            steps={{ canPrevious: read.canPrevious, canNext: read.canNext || (read.isStale && read.hasPages), onPrevious: read.previous, onNext: read.next, offset: read.offset, shown: read.items.length }}
          />
        ) : null}
      </AutoHeight>
    </section>
  );
}

/** One paper sent: what it is, the community it went to, and where it stands there. */
function SubmissionRow({ submission, date }: { submission: Submission; date: string }) {
  const t = useTranslations("addedPapers");
  const { community, status } = submission;
  const remove = useAction(api.evidenceLibraries.assistant.removeAddedPaper);
  // Withdrawn from a workspace that reaches the community, whichever one the page is in.
  const here = useWorkspace();
  const workspaceId = here;
  const [withdrawing, setWithdrawing] = useState(false);
  // Withdrawn, its button goes: the keyboard stays on the paper instead of falling to the page's start.
  const title = useRef<HTMLAnchorElement>(null);
  const withdraw = async () => {
    if (!workspaceId) return;
    setWithdrawing(true);
    try {
      await remove({ libraryId: community.libraryId, workspaceId, itemKey: submission.itemKey });
      toast.success(t("withdrawn"));
      title.current?.focus();
    } catch (error) {
      toast.error(refusalOr(error, t("removeFailed")));
    } finally {
      setWithdrawing(false);
    }
  };
  const name = community.address ? (
    <a href={community.address} target="_blank" rel="noopener noreferrer" className={cn("min-w-0 truncate font-medium text-foreground/80", LINK)}>{community.name}</a>
  ) : (
    <span className="min-w-0 truncate font-medium text-foreground/80">{community.name}</span>
  );
  const words = { queued: t("inQueue"), published: t("statusPublished"), returned: t("returned"), withdrawn: t("statusWithdrawn"), removed: t("statusRemoved") };
  return (
    <li style={{ height: `${ROW_REM}rem` }} className="flex items-center gap-3 px-3">
      <CommunityIcon fadeIn community={{ faviconUrl: community.faviconUrl, owner: community.owner ?? { name: community.name, imageUrl: null, kind: "organization" } }} />
      <div className="min-w-0 flex-1">
        <TooltipHint label={submission.title} onlyWhenClipped>
          {/* A narrow row gives a long title two lines, so it can be told apart; a wide one cuts it at one. */}
          <a ref={title} href={paperHref(submission)} className={cn("line-clamp-2 text-sm/5 font-medium @md/subs:block @md/subs:truncate", LINK)}>{submission.title}</a>
        </TooltipHint>
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <TooltipHint label={community.name} onlyWhenClipped>{name}</TooltipHint>
          {status === "returned" && submission.note ? (
            <span className="flex min-w-0 items-center gap-1 ink-warning">
              {/* A narrow row's status shows as its icon alone: the word comes before the team's reason. Seen only, as the chip says it. */}
              <span aria-hidden className="shrink-0 font-medium @md/subs:hidden">{words.returned}</span>
              <Undo2 className="size-3.5 shrink-0" />
              <TooltipHint label={submission.note} onlyWhenClipped>
                <span className="truncate">{submission.note}</span>
              </TooltipHint>
            </span>
          ) : (
            <>
              {/* A narrow row's status shows as its icon alone, so its words take the date's place here. */}
              {/* Seen only: the chip at the row's end already says it to a screen reader. */}
              <span aria-hidden className="shrink-0 font-medium text-foreground/80 @md/subs:hidden">{words[status]}</span>
              <span className="hidden shrink-0 tabular-nums @md/subs:inline">{date}</span>
            </>
          )}
        </div>
      </div>
      {status === "queued" ? (
        <StatusChip className="shrink-0" tone="running" icon={ReviewQueueIcon}><Said>{t("inQueue")}</Said></StatusChip>
      ) : status === "returned" && submission.note ? (
        // The reason is cut off in the row and a hover tooltip never opens on touch, so a tap on the chip opens it whole.
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <StatusChip className="cursor-pointer transition-colors hover:bg-warning/20" tone="warning" icon={CircleX}><Said>{t("returned")}</Said></StatusChip>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" aria-label={t("returned")} className="p-3 text-sm whitespace-pre-wrap break-words">{submission.note}</PopoverContent>
        </Popover>
      ) : status === "returned" ? (
        <StatusChip className="shrink-0" tone="warning" icon={CircleX}><Said>{t("returned")}</Said></StatusChip>
      ) : status === "withdrawn" ? (
        <StatusChip className="shrink-0" tone="neutral" icon={Undo2}><Said>{t("statusWithdrawn")}</Said></StatusChip>
      ) : status === "removed" ? (
        <StatusChip className="shrink-0" tone="neutral" icon={Trash2}><Said>{t("statusRemoved")}</Said></StatusChip>
      ) : (
        <StatusChip className="shrink-0" tone="success" icon={CheckCircle2}><Said>{t("statusPublished")}</Said></StatusChip>
      )}
      {/* Every row keeps the action's place, so the chips line up. */}
      <span className="flex w-8 shrink-0 justify-center">
        {status === "queued" ? (
          <TooltipHint label={t("withdraw")}>
            <Button type="button" variant="ghost" size="icon-sm" disabled={withdrawing} aria-label={t("withdrawLabel", { title: submission.title })} className="text-muted-foreground hover:text-destructive" onClick={() => void withdraw()}>
              <Undo2 />
            </Button>
          </TooltipHint>
        ) : status === "published" && community.address ? (
          <TooltipHint label={t("openIn", { community: community.name })}>
            <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground">
              <a href={recordHref(community.address, submission.itemKey)} target="_blank" rel="noopener noreferrer" aria-label={t("openLabel", { title: submission.title, community: community.name })}>
                <ExternalLink />
              </a>
            </Button>
          </TooltipHint>
        ) : null}
      </span>
    </li>
  );
}

/** A status's words: on a narrow row only its icon shows, and the words are read out. */
function Said({ children }: { children: ReactNode }) {
  return <span className="sr-only @md/subs:not-sr-only">{children}</span>;
}
