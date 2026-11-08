"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Check, Link2, Search, X } from "@/components/icons";
import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { StatusChip } from "../configuration/status-chip";
import { communityPapers, distinctPapers, lookUp, parsePaste, useAddedPapers, type FoundPaper } from "@/lib/evidence-libraries/added-papers-mock";
import { PublishChoice } from "./publish-choice";

/** A paper on one line and its authors under it, with where it was found as its icon. Every list of added papers uses it. */
export function PaperLine({ paper, trailing, muted }: { paper: Pick<FoundPaper, "title" | "authors" | "year" | "foundBy">; trailing?: ReactNode; muted?: boolean }) {
  return (
    <div className={cn("flex h-14 items-center gap-3 px-3", muted && "opacity-60")}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted" aria-hidden>
        {paper.foundBy === "openalex" ? <OpenAlexIcon className="size-4" /> : <Link2 className="size-4 text-muted-foreground" />}
      </span>
      <div className="min-w-0 flex-1">
        <TooltipHint label={paper.title} onlyWhenClipped>
          <p className="truncate text-sm font-medium">{paper.title}</p>
        </TooltipHint>
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{paper.authors || "No authors listed"}</span>
          {paper.year ? <span className="shrink-0 tabular-nums">{paper.year}</span> : null}
        </div>
      </div>
      {trailing}
    </div>
  );
}

type Found = { raw: string; key: string; paper: FoundPaper | null | undefined };

/**
 * Pasted DOIs, OpenAlex IDs and links, looked up, then published or sent to the review queue. Each paper is
 * looked for on OpenAlex by its ID, then by its DOI, then by the DOI alone.
 */
export function AddPapersDialog({
  open,
  onOpenChange,
  communityId,
  communityName,
  canPublish,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  communityId: string;
  communityName: string;
  canPublish: boolean;
}) {
  const [text, setText] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [sending, setSending] = useState<"publish" | "queue" | null>(null);
  const existing = useAddedPapers((state) => communityPapers(state.byCommunity, communityId));
  const add = useAddedPapers((state) => state.add);
  const parsed = parsePaste(text);
  const looking = found?.some((row) => row.paper === undefined) ?? false;
  const added = new Set(existing.map((paper) => paper.key));
  const isAdded = (paper: FoundPaper) => added.has(paper.key) || existing.some((row) => paper.doi !== null && row.doi === paper.doi);
  const ready = distinctPapers((found ?? []).flatMap((row) => (row.paper && !isAdded(row.paper) ? [row.paper] : [])));
  const doiOnly = ready.filter((paper) => paper.foundBy === "doi").length;

  const reset = () => {
    setText("");
    setFound(null);
    setSending(null);
  };

  const find = () => {
    const rows: Found[] = parsed.refs.map((ref) => ({ raw: ref.raw, key: ref.key, paper: undefined }));
    setFound(rows);
    for (const ref of parsed.refs) {
      void lookUp(ref).then((paper) =>
        setFound((current) => current?.map((row) => (row.key === ref.key ? { ...row, paper } : row)) ?? current),
      );
    }
  };

  const send = (publish: boolean) => {
    setSending(publish ? "publish" : "queue");
    // MOCK: the real call goes to new-el, which drafts the records and publishes or queues them.
    window.setTimeout(() => {
      add(communityId, ready, publish);
      toast.success(
        publish
          ? `${ready.length === 1 ? "1 paper" : `${ready.length} papers`} published to ${communityName}`
          : `${ready.length === 1 ? "1 paper" : `${ready.length} papers`} sent to the review queue`,
      );
      onOpenChange(false);
      reset();
    }, 700);
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
          <DialogTitle>Add papers</DialogTitle>
          <DialogDescription>Paste DOIs, OpenAlex IDs or links to them, as many as you like.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setFound(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && parsed.refs.length) find();
            }}
            rows={4}
            aria-label="DOIs, OpenAlex IDs or links"
            placeholder={"10.1016/j.tate.2015.06.010\nhttps://openalex.org/W2126314681"}
            className="font-mono text-xs"
          />
          <div className="flex min-h-8 items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {parsed.refs.length ? <StatusChip tone="neutral">{parsed.refs.length === 1 ? "1 paper" : `${parsed.refs.length} papers`}</StatusChip> : null}
              {parsed.invalid.length ? (
                <TooltipHint label={parsed.invalid.join(" ")} onlyWhenClipped>
                  <StatusChip tone="warning" icon="tone" className="max-w-56 truncate">
                    <span className="truncate">Not a DOI or ID: {parsed.invalid.join(" ")}</span>
                  </StatusChip>
                </TooltipHint>
              ) : null}
            </div>
            <Button type="button" variant="outline" size="sm" disabled={!parsed.refs.length || found !== null} onClick={find}>
              <Search />
              Find papers
            </Button>
          </div>
        </div>
        <AutoHeight>
          {found ? (
            <ul aria-label="Papers found" className="fade-enter divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle">
              {found.map((row) => (
                <li key={row.key}>
                  {row.paper === undefined ? (
                    <div className="flex h-14 items-center gap-3 px-3 text-sm text-muted-foreground">
                      <span className="flex size-8 items-center justify-center"><Spinner /></span>
                      <span className="truncate font-mono text-xs">{row.raw}</span>
                    </div>
                  ) : row.paper === null ? (
                    <div className="flex h-14 items-center gap-3 px-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted" aria-hidden><X className="size-4 text-destructive" /></span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{row.raw}</span>
                      <StatusChip tone="danger">Not found</StatusChip>
                    </div>
                  ) : (
                    <PaperLine
                      paper={row.paper}
                      muted={isAdded(row.paper)}
                      trailing={
                        isAdded(row.paper) ? (
                          <StatusChip tone="neutral" icon={Check}>Already added</StatusChip>
                        ) : (
                          <div className="flex shrink-0 items-center gap-1">
                            {row.paper.foundBy === "doi" ? <StatusChip tone="warning">DOI only</StatusChip> : null}
                            <TooltipHint label="Leave out">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Leave out ${row.paper.title}`}
                                className="text-muted-foreground"
                                onClick={() => setFound((current) => current?.filter((other) => other.key !== row.key) ?? null)}
                              >
                                <X />
                              </Button>
                            </TooltipHint>
                          </div>
                        )
                      }
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {doiOnly ? (
            <p className="pt-2 text-xs text-muted-foreground">
              OpenAlex doesn&apos;t have {doiOnly === 1 ? "one of these" : `${doiOnly} of these`} yet. It comes in from its DOI, and each sync checks OpenAlex again.
            </p>
          ) : null}
        </AutoHeight>
        <DialogFooter className="items-center sm:justify-between">
          <span className="text-sm text-muted-foreground tabular-nums">
            {found && !looking ? (ready.length === 1 ? "1 paper to add" : `${ready.length} papers to add`) : null}
          </span>
          <PublishChoice canPublish={canPublish} disabled={!found || looking || ready.length === 0} sending={sending} onSend={send} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
