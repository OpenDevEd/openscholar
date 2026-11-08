"use client";

import { useState, type ReactNode } from "react";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Link2, ReviewQueueIcon, Search, X } from "@/components/icons";
import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { TooltipHint } from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { readConvexErrorData } from "@/convex/lib/errors";
import { ADDED_PAPERS_MAX, paperHref, parsePaste, type PastedPaper } from "@/lib/evidence-libraries/added-papers";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspaces/url";
import { StatusChip } from "../configuration/status-chip";
import { PublishChoice } from "./publish-choice";

/** Our own refusal as written, such as a creator choosing Publish; anything else, including a community's own words, as `fallback`. */
export function refusalOr(error: unknown, fallback: string) {
  const refusal = readConvexErrorData(error);
  return refusal?.code === "FORBIDDEN" && refusal.message ? refusal.message : fallback;
}

/** A link that reads as one: underlined on hover and when focused. */
export const LINK = "underline-offset-2 decoration-foreground/40 outline-none hover:underline focus-visible:underline";

type ShownPaper = { title: string; authors: string; year: number | null; openalexId: string | null; doi: string | null };

/** A paper on one line and its authors under it, with where it was found as its icon. Every list of added papers uses it. */
export function PaperLine({ paper, trailing, muted, newTab, under }: {
  paper: ShownPaper;
  trailing?: ReactNode;
  muted?: boolean;
  /** Opens the paper's page in a new tab, as from a dialog, which the page would otherwise replace. */
  newTab?: boolean;
  /** In place of the authors and year, such as a reviewer's reason for returning it. */
  under?: ReactNode;
}) {
  const t = useTranslations("addedPapers");
  return (
    <div className={cn("flex h-14 items-center gap-3 px-3", muted && "opacity-60")}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted" aria-hidden>
        {paper.openalexId ? <OpenAlexIcon className="size-4" /> : <Link2 className="size-4 text-muted-foreground" />}
      </span>
      <div className="min-w-0 flex-1">
        <TooltipHint label={paper.title} onlyWhenClipped>
          <a href={paperHref(paper)} {...(newTab || !paper.openalexId ? { target: "_blank", rel: "noopener noreferrer" } : {})} className={cn("block truncate text-sm font-medium", LINK)}>
            {paper.title}
          </a>
        </TooltipHint>
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {under ?? (
            <>
              <span className="min-w-0 truncate">{paper.authors || t("noAuthors")}</span>
              {paper.year ? <span className="shrink-0 tabular-nums">{paper.year}</span> : null}
            </>
          )}
        </div>
      </div>
      {trailing}
    </div>
  );
}

type Preview = FunctionReturnType<typeof api.evidenceLibraries.assistant.previewPapers>[number];
/** A pasted paper and what the community said of it; no answer while it's being looked up. */
type Found = PastedPaper & { answer?: Preview };

const addable = (answer: Preview | undefined) => answer?.outcome === "found" || answer?.outcome === "returned";

/**
 * Pasted DOIs, OpenAlex IDs and links, looked up by the community, then published or sent to its review queue. The
 * community looks each one up on OpenAlex by its ID, then by its DOI, then by the DOI alone.
 */
export function AddPapersDialog({
  open,
  onOpenChange,
  libraryId,
  communityName,
  canPublish,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraryId: Id<"evidenceLibraries">;
  communityName: string;
  canPublish: boolean;
  onAdded: () => void;
}) {
  const t = useTranslations("addedPapers");
  const preview = useAction(api.evidenceLibraries.assistant.previewPapers);
  const add = useAction(api.evidenceLibraries.assistant.addPapers);
  const workspaceId = useWorkspace();
  const [text, setText] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  // One ID per set of papers found, so a send tried again adds nothing twice.
  const [requestId, setRequestId] = useState("");
  const [sending, setSending] = useState<"publish" | "queue" | null>(null);
  const parsed = parsePaste(text);
  const tooMany = parsed.papers.length > ADDED_PAPERS_MAX;
  const looking = found?.some((row) => !row.answer) ?? false;
  const ready = (found ?? []).filter((row) => addable(row.answer));
  const doiOnly = ready.filter((row) => row.answer?.foundBy === "doi").length;

  const reset = () => {
    setText("");
    setFound(null);
    setSending(null);
  };

  const find = async () => {
    if (!workspaceId) return;
    const papers = parsed.papers;
    setFound(papers);
    setRequestId(crypto.randomUUID());
    try {
      const answers = await preview({ libraryId, workspaceId, papers: papers.map(({ openalexId, doi }) => ({ openalexId, doi })) });
      setFound(papers.map((paper, at) => ({ ...paper, answer: answers[at] })));
    } catch (error) {
      setFound(null);
      toast.error(refusalOr(error, t("lookupFailed")));
    }
  };

  const send = async (publish: boolean) => {
    if (!workspaceId) return;
    setSending(publish ? "publish" : "queue");
    try {
      const results = await add({ libraryId, workspaceId, publish, requestId, papers: ready.map(({ openalexId, doi }) => ({ openalexId, doi })) });
      const sent = results.filter((result) => result.outcome === "added" || result.outcome === "queued").length;
      const failed = results.filter((result) => result.outcome === "failed").length;
      if (sent) toast.success(publish ? t("published", { count: sent, community: communityName }) : t("queued", { count: sent }));
      if (failed) toast.error(t("someFailed", { count: failed }));
      onAdded();
      onOpenChange(false);
      reset();
    } catch (error) {
      setSending(null);
      toast.error(refusalOr(error, t("addFailed")));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { max: ADDED_PAPERS_MAX })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setFound(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && parsed.papers.length && !tooMany && !found) void find();
            }}
            rows={4}
            aria-label={t("inputLabel")}
            placeholder={"10.1016/j.tate.2015.06.010\nhttps://openalex.org/W2126314681"}
            className="font-mono text-xs"
          />
          <div className="flex min-h-8 items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {parsed.papers.length ? (
                <StatusChip tone={tooMany ? "warning" : "neutral"} icon={tooMany ? "tone" : undefined}>
                  {tooMany ? t("tooMany", { max: ADDED_PAPERS_MAX }) : t("papers", { count: parsed.papers.length })}
                </StatusChip>
              ) : null}
              {parsed.invalid.length ? (
                <TooltipHint label={parsed.invalid.join(" ")} onlyWhenClipped>
                  <StatusChip tone="warning" icon="tone" className="max-w-56 truncate">
                    <span className="truncate">{t("invalid", { values: parsed.invalid.join(" ") })}</span>
                  </StatusChip>
                </TooltipHint>
              ) : null}
            </div>
            <Button type="button" variant="outline" size="sm" disabled={!parsed.papers.length || tooMany || found !== null} onClick={() => void find()}>
              <Search />
              {t("find")}
            </Button>
          </div>
        </div>
        <AutoHeight>
          {found ? (
            <ul aria-label={t("found")} className="fade-enter divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle">
              {found.map((row) => (
                <li key={row.key}>
                  <FoundRow row={row} onLeaveOut={() => setFound((current) => current?.filter((other) => other.key !== row.key) ?? null)} />
                </li>
              ))}
            </ul>
          ) : null}
          {doiOnly ? <p className="pt-2 text-xs text-muted-foreground">{t("doiOnlyNote", { count: doiOnly })}</p> : null}
        </AutoHeight>
        <DialogFooter className="items-center sm:justify-between">
          <span className="text-sm text-muted-foreground tabular-nums">{found && !looking ? t("toAdd", { count: ready.length }) : null}</span>
          <PublishChoice canPublish={canPublish} disabled={!found || looking || ready.length === 0} sending={sending} onSend={(publish) => void send(publish)} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One pasted paper: being looked up, not found, already here, or ready to add and left out with its button. */
function FoundRow({ row, onLeaveOut }: { row: Found; onLeaveOut: () => void }) {
  const t = useTranslations("addedPapers");
  const { answer } = row;
  if (!answer) {
    return (
      <div className="flex h-14 items-center gap-3 px-3 text-sm text-muted-foreground">
        <span className="flex size-8 items-center justify-center"><Spinner /></span>
        <span className="truncate font-mono text-xs">{row.raw}</span>
      </div>
    );
  }
  if (answer.outcome === "not_found" || !answer.paper) {
    return (
      <div className="flex h-14 items-center gap-3 px-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted" aria-hidden><X className="size-4 text-destructive" /></span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{row.raw}</span>
        <StatusChip tone="danger">{t("notFound")}</StatusChip>
      </div>
    );
  }
  const paper = answer.paper;
  if (!addable(answer)) {
    return (
      <PaperLine
        newTab
        muted
        paper={paper}
        trailing={answer.outcome === "queued"
          ? <StatusChip tone="running" icon={ReviewQueueIcon}>{t("inQueue")}</StatusChip>
          : <StatusChip tone="neutral" icon={Check}>{t("alreadyAdded")}</StatusChip>}
      />
    );
  }
  return (
    <PaperLine
      newTab
      paper={paper}
      trailing={
        <div className="flex shrink-0 items-center gap-1">
          {answer.foundBy === "doi" ? <StatusChip tone="warning">{t("doiOnly")}</StatusChip> : null}
          <TooltipHint label={t("leaveOut")}>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("leaveOutLabel", { title: paper.title })} className="text-muted-foreground" onClick={onLeaveOut}>
              <X />
            </Button>
          </TooltipHint>
        </div>
      }
    />
  );
}
