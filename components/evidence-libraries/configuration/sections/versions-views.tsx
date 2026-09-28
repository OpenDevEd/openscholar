"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  canRestore,
  changedCards,
  shortCommit,
  splitNoteArea,
  type ReleaseNoteArea,
  type VersionStatus,
} from "@/lib/evidence-libraries/configuration/versions";
import { cn } from "@/lib/utils";
import { EmptyList } from "../fields";
import { DisclosureButton } from "../disclosure-button";
import { StatusChip, type StatusTone } from "../status-chip";

/*
 * The two views on the Versions card: the notes of the releases an owner has
 * not applied yet, and the list of versions this library has published. Both
 * take plain data so the mock page and the live section share them.
 */

export type ReleaseNotesEntry = {
  commit: string;
  summary: string;
  notes: string[];
};

export type ReleaseChange = { sha: string; message: string };

export type VersionHistoryRow = {
  operationId: string;
  revisionKey: string;
  createdAt: number;
  by: string;
  changedSections: readonly string[];
  status: VersionStatus;
  kind: "runtime" | "config";
  runtimeCommit?: string;
};

const PAGE_SIZE = 10;

export const VERSION_TONE: Record<VersionStatus, StatusTone> = {
  live: "success",
  previous: "neutral",
  failed: "danger",
  deploying: "running",
};

// Same recipe as the status chip: tinted background, dark text, faint border.
// The 800 shade keeps the text above 7:1 on the tint in light mode.
const AREA_TONE: Record<ReleaseNoteArea, string> = {
  search: "bg-sky-500/10 text-sky-800 dark:text-sky-300 border-sky-500/20",
  records:
    "bg-violet-500/10 text-violet-800 dark:text-violet-300 border-violet-500/20",
  collections:
    "bg-indigo-500/10 text-indigo-800 dark:text-indigo-300 border-indigo-500/20",
  sources: "bg-teal-500/10 text-teal-800 dark:text-teal-300 border-teal-500/20",
  exports:
    "bg-fuchsia-500/10 text-fuchsia-800 dark:text-fuchsia-300 border-fuchsia-500/20",
  appearance:
    "bg-pink-500/10 text-pink-800 dark:text-pink-300 border-pink-500/20",
  administration:
    "bg-slate-500/10 text-slate-800 dark:text-slate-300 border-slate-500/20",
  speed: "bg-lime-500/10 text-lime-800 dark:text-lime-300 border-lime-500/20",
  reliability:
    "bg-rose-500/10 text-rose-800 dark:text-rose-300 border-rose-500/20",
};

function AreaChip({ area }: { area: ReleaseNoteArea }) {
  const t = useTranslations("evidenceLibraryConfiguration");
  return (
    <span
      className={cn(
        "inline-flex w-24 shrink-0 items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        AREA_TONE[area],
      )}
      data-area={area}
    >
      {t(`versions.areas.${area}`)}
    </span>
  );
}

/** The commit subjects behind an update, for owners who want the detail. */
function CommitList({ changes }: { changes: readonly ReleaseChange[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {changes.map((change) => (
        <li key={change.sha} className="flex gap-2">
          <span className="shrink-0 font-mono text-xs leading-5 text-muted-foreground">
            {shortCommit(change.sha)}
          </span>
          <span className="min-w-0">{change.message}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * What changed in every release newer than the one the library runs. Each
 * release keeps its summary and its notes, newest first. The commit subjects
 * stay one click away for owners who want them.
 */
export function ReleaseNotes({
  releases,
  changes,
}: {
  releases: readonly ReleaseNotesEntry[];
  changes: readonly ReleaseChange[];
}) {
  const t = useTranslations("evidenceLibraryConfiguration");
  const [changesOpen, setChangesOpen] = useState(false);
  const changesId = useId();
  if (releases.length === 0) return <CommitList changes={changes} />;
  return (
    <div className="space-y-4" data-release-notes={releases.length}>
      {releases.map((release) => (
        <article
          key={release.commit}
          className="space-y-2"
          data-release={release.commit}
        >
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h5 className="text-sm font-medium">{release.summary}</h5>
            <span className="font-mono text-[11px] text-muted-foreground">
              {shortCommit(release.commit)}
            </span>
          </div>
          {release.notes.length > 0 ? (
            <ul className="space-y-1.5">
              {release.notes.map((note, index) => {
                const { area, text } = splitNoteArea(note);
                return (
                  <li
                    key={`${release.commit}-${index}`}
                    className="flex items-start gap-2.5 text-sm"
                  >
                    {area ? <AreaChip area={area} /> : null}
                    <span className="min-w-0 flex-1 leading-5">{text}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </article>
      ))}
      {changes.length > 0 ? (
        <div className="border-t border-border/50 pt-3">
          <DisclosureButton open={changesOpen} controls={changesId} onToggle={() => setChangesOpen((open) => !open)}>
            {t("versions.technicalChanges")}
          </DisclosureButton>
          {changesOpen ? (
            <div id={changesId} className="pt-2">
              <CommitList changes={changes} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Every published version, newest first, ten at a time. A software update
 * names its commit; a settings change names the cards it touched.
 */
export function VersionHistory<Row extends VersionHistoryRow>({
  rows,
  blocked,
  onRestore,
}: {
  rows: readonly Row[];
  blocked: boolean;
  onRestore: (row: Row) => void;
}) {
  const t = useTranslations("evidenceLibraryConfiguration");
  const format = useFormatter();
  const [shown, setShown] = useState(PAGE_SIZE);
  if (rows.length === 0) return <EmptyList>{t("versions.empty")}</EmptyList>;
  const visible = rows.slice(0, shown);
  const remaining = rows.length - visible.length;

  return (
    <div className="space-y-2">
      <ol className="divide-y divide-border/50 rounded-lg border border-border/50 bg-background">
        {visible.map((row) => {
          const cards = row.kind === "config" ? changedCards(row.changedSections) : [];
          return (
            <li
              key={row.operationId}
              className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto_5rem] items-center gap-x-3 px-3 py-2.5"
              data-version-status={row.status}
              data-revision={row.revisionKey}
            >
              <span className="font-mono text-xs text-muted-foreground">
                {row.revisionKey}
              </span>
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  {row.kind === "runtime" ? (
                    <>
                      <span className="font-medium">{t("versions.softwareUpdate")}</span>
                      {row.runtimeCommit ? (
                        <span className="font-mono text-xs text-muted-foreground">
                          {shortCommit(row.runtimeCommit)}
                        </span>
                      ) : null}
                    </>
                  ) : cards.length === 0 ? (
                    <span className="font-medium">{t("versions.everything")}</span>
                  ) : (
                    cards.map((card) => (
                      <span
                        key={card}
                        className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium"
                      >
                        {t(`sections.${card}`)}
                      </span>
                    ))
                  )}
                </div>
                <p className="flex gap-3 truncate text-xs text-muted-foreground">
                  <span className="truncate">{row.by}</span>
                  <time dateTime={new Date(row.createdAt).toISOString()}>
                    {format.dateTime(new Date(row.createdAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                </p>
              </div>
              <StatusChip tone={VERSION_TONE[row.status]}>
                {t(`versions.status.${row.status}`)}
              </StatusChip>
              <div className="text-right">
                {canRestore(row.status) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={blocked}
                    onClick={() => onRestore(row)}
                  >
                    {t("versions.restore")}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        <span>
          {t("versions.showing", { shown: visible.length, total: rows.length })}
        </span>
        {remaining > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShown((count) => count + PAGE_SIZE)}
          >
            {t("versions.showMore", { count: Math.min(remaining, PAGE_SIZE) })}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
