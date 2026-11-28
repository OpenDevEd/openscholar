"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AddedPapersIcon, CircleX, ExternalLink, Plus, ReviewQueueIcon, Trash2, Undo2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible";
import { TooltipHint } from "@/components/ui/tooltip";
import { PageStepper } from "@/components/shared/page-stepper";
import { AdminAreaLink } from "@/components/evidence-libraries/admin-area-link";
import { AddPapersDialog, PaperLine, refusalOr } from "@/components/evidence-libraries/added-papers/add-papers-dialog";
import { publishes } from "@/components/evidence-libraries/added-papers/publish-choice";
import { PAPERS_PER_PAGE, useAddedPapers, type AddedPaper } from "@/components/evidence-libraries/added-papers/use-added-papers";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useWithPage } from "../preloads";
import { recordHref } from "@/lib/evidence-libraries/added-papers";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspaces/url";
import { DisclosureButton, DisclosureContent } from "../disclosure-button";
import { SectionCard } from "../section-card";
import { StatusChip } from "../status-chip";
import { SourceCount, SourceRow, SourceSwitch } from "./source-row";
import { STALE_ROWS } from "@/components/evidence-libraries/list-controls";

/** The running community the Added papers row reads, and the person's role there; null until it runs. */
export function useAddedPapersCommunity(libraryId: Id<"evidenceLibraries">) {
  const draft = useWithPage<typeof api.evidenceLibraries.queries.getDraft>("draft", useProtectedQuery(api.evidenceLibraries.queries.getDraft, { libraryId }).data);
  if (!draft || draft.library.state !== "active" || !draft.liveAddress || draft.role === "viewer") return null;
  return { name: draft.library.name, address: draft.liveAddress, role: draft.role };
}

/**
 * The community's papers added one at a time, by DOI or OpenAlex ID, from here, Discover, the assistant or the
 * community's own site. It's always on the list of a running community: there's nothing to connect. Papers go live
 * without a settings publish, since each is a record in the community, kept in sync like any other source's, and its
 * pause and PDFs switches take effect at once too, for the owner alone.
 */
export function AddedPapersRow({ libraryId, adding, onAddingChange }: {
  libraryId: Id<"evidenceLibraries">;
  /** The Add papers dialog, which the Add source menu opens too. */
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
}) {
  const t = useTranslations("addedPapers");
  const ts = useTranslations("evidenceLibraryConfiguration.sources");
  const locale = useLocale();
  const community = useAddedPapersCommunity(libraryId);
  const { pages, counts, settings, refresh, setSettings } = useAddedPapers(libraryId, community !== null);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  if (!community) return null;
  const owner = community.role === "owner";
  const pageCount = Math.max(1, Math.ceil((counts?.total ?? 0) / PAPERS_PER_PAGE));
  const shown = Math.min(page, pageCount);
  // The page asked for, or the last one read while it's on its way, dimmed.
  const papers = pages.data?.[shown - 1] ?? pages.data?.at(-1);
  const stale = !pages.data?.[shown - 1];
  const turn = (to: number) => {
    setPage(to);
    void pages.setSize(Math.max(pages.size, to));
  };
  const toggle = (change: Partial<NonNullable<typeof settings>>) =>
    void setSettings(change).catch((error: unknown) => toast.error(refusalOr(error, t("settingsFailed"))));
  const loaded = settings !== undefined;
  const paused = settings?.enabled === false;

  return (
    <>
      <SourceRow
        name={t("name")}
        provider={t("provider")}
        icon={<AddedPapersIcon className="size-4 text-primary" />}
        status={
          pages.error ? { label: t("unavailable"), tone: "danger" }
          : paused ? { label: ts("health.paused"), tone: "neutral" }
          : { label: ts("health.connected"), tone: "success" }
        }
        paused={paused}
        onToggle={() => toggle({ enabled: paused })}
        toggleDisabled={!owner || !loaded}
        metadata={[
          { key: "records", label: ts("recordsLabel"), value: <SourceCount count={counts?.live} /> },
          ...(counts?.waiting
            ? [{
                key: "queue",
                label: t("inQueue"),
                value: (
                  <AdminAreaLink address={community.address} path="/admin?review=pending" className="fade-enter inline-flex items-center gap-1 text-primary hover:underline">
                    <ReviewQueueIcon className="size-3.5" />
                    {counts.waiting.toLocaleString(locale)}
                  </AdminAreaLink>
                ),
              }]
            : []),
        ]}
        details={
          <Collapsible open={open}>
            <DisclosureContent>
              <section aria-label={t("name")} className="border-b border-border-subtle bg-muted/40 px-4 pb-3 pt-3">
                {/* Every page holds five rows' height, so a short last page doesn't move the pager. */}
                <ul className={cn("min-h-[calc(5*3.5rem+4*1px)] divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-background", stale && STALE_ROWS)} inert={stale}>
                  {papers?.papers.map((paper) => (
                    <li key={paper.itemKey}>
                      <AddedLine paper={paper} libraryId={libraryId} community={community} onChanged={refresh} />
                    </li>
                  ))}
                </ul>
                {pageCount > 1 ? (
                  <PageStepper
                    className="mt-2"
                    page={shown}
                    pageCount={pageCount}
                    canPrevious={shown > 1}
                    canNext={shown < pageCount}
                    onPrevious={() => turn(shown - 1)}
                    onNext={() => turn(shown + 1)}
                  />
                ) : null}
              </section>
            </DisclosureContent>
          </Collapsible>
        }
        controls={
          <>
            <SourceSwitch
              label={ts("pdfs")}
              checked={settings?.downloadPdfs ?? true}
              disabledReason={owner ? undefined : t("ownerOnly")}
              onCheckedChange={(downloadPdfs) => loaded && toggle({ downloadPdfs })}
            />
            <DisclosureButton aria-expanded={open} disabled={!counts?.total} onClick={() => setOpen(!open)} className="ms-0">
              <span className={cn("tabular-nums", !loaded && "invisible")}>{t("papers", { count: counts?.total ?? 0 })}</span>
            </DisclosureButton>
            <Button type="button" variant="outline" size="sm" onClick={() => onAddingChange(true)}>
              <Plus />
              {t("add")}
            </Button>
          </>
        }
      />
      <AddPapersDialog
        open={adding}
        onOpenChange={onAddingChange}
        libraryId={libraryId}
        communityName={community.name}
        canPublish={publishes(community.role)}
        onAdded={() => void refresh()}
      />
    </>
  );
}

/** A paper and where it stands: open it on the community, take it off, or withdraw it while it waits. */
function AddedLine({ paper, libraryId, community, onChanged }: {
  paper: AddedPaper;
  libraryId: Id<"evidenceLibraries">;
  community: { name: string; address: string; role: string };
  onChanged: () => void;
}) {
  const t = useTranslations("addedPapers");
  const remove = useAction(api.evidenceLibraries.assistant.removeAddedPaper);
  const workspaceId = useWorkspace();
  const [busy, setBusy] = useState(false);
  const live = paper.status === "live" || paper.status === "doi_only";
  // A paper waiting is withdrawn by the person who sent it; one on the community is removed by an owner or editor.
  const removes = live ? publishes(community.role) : paper.status === "queued" && paper.mine;
  const take = async () => {
    if (!workspaceId) return;
    setBusy(true);
    try {
      const outcome = await remove({ libraryId, workspaceId, itemKey: paper.itemKey });
      toast.success(outcome === "removed" ? t("removed") : t("withdrawn"));
      onChanged();
    } catch (error) {
      toast.error(refusalOr(error, t("removeFailed")));
    } finally {
      setBusy(false);
    }
  };
  return (
    <PaperLine
      paper={paper}
      under={paper.status === "returned" && paper.note ? (
        <span className="flex min-w-0 items-center gap-1 ink-warning">
          <Undo2 className="size-3.5 shrink-0" />
          <span className="truncate">{paper.note}</span>
        </span>
      ) : undefined}
      trailing={
        <div className="flex shrink-0 items-center gap-1">
          {paper.status === "queued" ? (
            <StatusChip tone="running" icon={ReviewQueueIcon}>{paper.mine || !paper.addedByName ? t("inQueue") : t("from", { name: paper.addedByName })}</StatusChip>
          ) : paper.status === "doi_only" ? (
            <StatusChip tone="warning">{t("doiOnly")}</StatusChip>
          ) : paper.status === "returned" ? (
            <StatusChip tone="warning" icon={CircleX}>{t("returned")}</StatusChip>
          ) : null}
          {live ? (
            <TooltipHint label={t("openIn", { community: community.name })}>
              <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground">
                <a href={recordHref(community.address, paper.itemKey)} target="_blank" rel="noopener noreferrer" aria-label={t("openLabel", { title: paper.title, community: community.name })}>
                  <ExternalLink />
                </a>
              </Button>
            </TooltipHint>
          ) : null}
          {removes ? (
            <TooltipHint label={live ? t("remove") : t("withdraw")}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                aria-label={live ? t("removeLabel", { title: paper.title }) : t("withdrawLabel", { title: paper.title })}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => void take()}
              >
                {live ? <Trash2 /> : <Undo2 />}
              </Button>
            </TooltipHint>
          ) : null}
        </div>
      }
    />
  );
}

/**
 * Added papers for an editor or creator, whose settings are read-only: its own card outside them, so they add papers
 * and withdraw their own as they would on the community.
 */
export function AddedPapersCard({ libraryId }: { libraryId: Id<"evidenceLibraries"> }) {
  const t = useTranslations("addedPapers");
  const [adding, setAdding] = useState(false);
  if (!useAddedPapersCommunity(libraryId)) return null;
  return (
    <SectionCard icon={AddedPapersIcon} title={t("name")} description={t("cardDescription")} className="mt-4">
      <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-background">
        <AddedPapersRow libraryId={libraryId} adding={adding} onAddingChange={setAdding} />
      </ul>
    </SectionCard>
  );
}
