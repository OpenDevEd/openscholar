"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AddedPapersIcon, Plus, ReviewQueueIcon, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible";
import { TooltipHint } from "@/components/ui/tooltip";
import { PageStepper } from "@/components/shared/page-stepper";
import { AdminAreaLink } from "@/components/evidence-libraries/admin-area-link";
import { AddPapersDialog, PaperLine } from "@/components/evidence-libraries/added-papers/add-papers-dialog";
import { communityPapers, useAddedPapers, type AddedPaper } from "@/lib/evidence-libraries/added-papers-mock";
import { DisclosureButton, DisclosureContent } from "../disclosure-button";
import { StatusChip } from "../status-chip";
import { SourceRow, SourceSwitch } from "./source-row";

/** Papers the band shows at a time. */
const PER_PAGE = 5;

/**
 * The community's papers added one at a time, by DOI or OpenAlex ID, from here, Discover, the assistant or the
 * community's own site. It's always on the list: there's nothing to connect. Papers go live without a settings
 * publish, since each is a record in the community, kept in sync like any other source's.
 */
export function AddedPapersRow({ libraryId, name, address, adding, onAddingChange }: {
  libraryId: string;
  name: string;
  address: string | null;
  /** The Add papers dialog, which the Add source menu opens too. */
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  const locale = useLocale();
  const papers = useAddedPapers((state) => communityPapers(state.byCommunity, libraryId));
  const [paused, setPaused] = useState(false);
  // MOCK: on for Added papers from the start; other sources start with it off.
  const [pdfs, setPdfs] = useState(true);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const live = papers.filter((paper) => paper.state !== "queued").length;
  const queued = papers.length - live;
  const pages = Math.max(1, Math.ceil(papers.length / PER_PAGE));
  const shown = Math.min(page, pages);

  return (
    <>
      <SourceRow
        name="Added papers"
        provider="DOIs and OpenAlex IDs"
        icon={<AddedPapersIcon className="size-4 text-primary" />}
        status={paused ? { label: t("health.paused"), tone: "neutral" } : { label: t("health.connected"), tone: "success" }}
        paused={paused}
        onToggle={() => setPaused(!paused)}
        metadata={[
          { key: "records", label: t("recordsLabel"), value: live.toLocaleString(locale) },
          ...(queued
            ? [{
                key: "queue",
                label: "In review queue",
                value: address ? (
                  <AdminAreaLink address={address} path="/admin?review=pending" className="inline-flex items-center gap-1 text-primary hover:underline">
                    <ReviewQueueIcon className="size-3.5" />
                    {queued.toLocaleString(locale)}
                  </AdminAreaLink>
                ) : queued.toLocaleString(locale),
              }]
            : []),
        ]}
        details={
          <Collapsible open={open}>
            <DisclosureContent>
              <section aria-label="Added papers" className="border-b border-border-subtle bg-muted/40 px-4 pb-3 pt-3">
                {/* Every page holds five rows' height, so a short last page doesn't move the pager. */}
                <ul className="min-h-[calc(5*3.5rem+4*1px)] divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-background">
                  {papers.slice((shown - 1) * PER_PAGE, shown * PER_PAGE).map((paper) => (
                    <li key={paper.key}>
                      <PaperLine paper={paper} trailing={<AddedTrailing paper={paper} libraryId={libraryId} />} />
                    </li>
                  ))}
                </ul>
                {pages > 1 ? (
                  <PageStepper
                    className="mt-2"
                    page={shown}
                    pageCount={pages}
                    canPrevious={shown > 1}
                    canNext={shown < pages}
                    onPrevious={() => setPage(shown - 1)}
                    onNext={() => setPage(shown + 1)}
                  />
                ) : null}
              </section>
            </DisclosureContent>
          </Collapsible>
        }
        controls={
          <>
            <SourceSwitch label={t("pdfs")} checked={pdfs} onCheckedChange={setPdfs} />
            <DisclosureButton aria-expanded={open} onClick={() => setOpen(!open)} className="ms-0">
              {papers.length === 1 ? "1 paper" : `${papers.length.toLocaleString(locale)} papers`}
            </DisclosureButton>
            <Button type="button" variant="outline" size="sm" onClick={() => onAddingChange(true)}>
              <Plus />
              Add papers
            </Button>
          </>
        }
      />
      <AddPapersDialog open={adding} onOpenChange={onAddingChange} communityId={libraryId} communityName={name} canPublish />
    </>
  );
}

/** A paper's state, when it has one to tell, and taking it off the community. */
function AddedTrailing({ paper, libraryId }: { paper: AddedPaper; libraryId: string }) {
  const remove = useAddedPapers((state) => state.remove);
  return (
    <div className="flex shrink-0 items-center gap-1">
      {paper.state === "queued" ? (
        <StatusChip tone="running" icon={ReviewQueueIcon}>{paper.by === "You" ? "In review queue" : `From ${paper.by}`}</StatusChip>
      ) : paper.state === "retrying" ? (
        <StatusChip tone="warning">DOI only</StatusChip>
      ) : null}
      {paper.state === "queued" && paper.by !== "You" ? null : (
      <TooltipHint label={paper.state === "queued" ? "Withdraw" : "Remove"}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`${paper.state === "queued" ? "Withdraw" : "Remove"} ${paper.title}`}
          className="text-muted-foreground hover:text-destructive"
          onClick={() => remove(libraryId, paper.key)}
        >
          <Trash2 />
        </Button>
      </TooltipHint>
      )}
    </div>
  );
}
