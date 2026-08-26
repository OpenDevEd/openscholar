"use client";

/**
 * Five looks for one Zotero source card. Same data and actions in each;
 * only the arrangement changes. Pick one, delete the rest.
 */

import {
  Check,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ZoteroSource } from "@/lib/evidence-libraries/mock/config";
import { useEvidenceLibraryMockStore } from "@/lib/evidence-libraries/mock/store";
import { StatusChip } from "../library-status-badge";
import { Field } from "../section-card";
import { ToggleRow } from "./fields";

export const SOURCE_STYLES = ["ledger", "split", "timeline", "table", "stats"] as const;
export type SourceStyle = (typeof SOURCE_STYLES)[number];

/** Stored in `apiKey` when the owner signed in with Zotero instead of pasting a key. */
const ZOTERO_OAUTH = "zotero-oauth";

type CardProps = {
  libraryId: string;
  source: ZoteroSource;
  onChange: (update: (row: ZoteroSource) => void) => void;
  onRemove: () => void;
};

export function SourceCardByStyle({ style, ...props }: CardProps & { style: SourceStyle }) {
  switch (style) {
    case "split":
      return <SplitCard {...props} />;
    case "timeline":
      return <TimelineCard {...props} />;
    case "table":
      return <TableRowCard {...props} />;
    case "stats":
      return <StatsCard {...props} />;
    default:
      return <LedgerCard {...props} />;
  }
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

function useSource({ libraryId, source }: Pick<CardProps, "libraryId" | "source">) {
  const t = useTranslations("evidenceLibraryMock.config.sources");
  const syncSource = useEvidenceLibraryMockStore((s) => s.syncSource);
  const run = useEvidenceLibraryMockStore((s) => s.syncing[libraryId]);
  const thisSyncing = run?.sourceId === source.id;
  const connected =
    source.auth === "zotero" ? source.apiKey === ZOTERO_OAUTH : source.apiKey.trim().length > 0;
  const groupIdMissing = !source.groupId.trim();
  const ready = connected && !groupIdMissing;
  return {
    t,
    run,
    thisSyncing,
    anySyncing: run !== undefined,
    connected,
    groupIdMissing,
    keyMissing: source.auth === "apiKey" && !source.apiKey.trim(),
    ready,
    sync: () => syncSource(libraryId, source.id),
    percent: run?.percent ?? 0,
  };
}

function ZoteroMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md bg-[#cc2936] text-xs font-bold text-white",
        className,
      )}
    >
      Z
    </span>
  );
}

function StateChip({ source, libraryId }: Pick<CardProps, "source" | "libraryId">) {
  const { t, thisSyncing, ready } = useSource({ libraryId, source });
  if (thisSyncing) return <StatusChip tone="running">{t("statusSyncing")}</StatusChip>;
  if (!ready) return <StatusChip tone="warning">{t("statusIncomplete")}</StatusChip>;
  return (
    <StatusChip tone={source.enabled ? "success" : "neutral"}>
      {source.enabled ? t("statusOn") : t("statusOff")}
    </StatusChip>
  );
}

function SyncButton({ libraryId, source, size = "sm" }: Pick<CardProps, "source" | "libraryId"> & { size?: "sm" | "default" }) {
  const { t, thisSyncing, anySyncing, ready, sync, percent } = useSource({ libraryId, source });
  return (
    <Button type="button" variant="outline" size={size} disabled={anySyncing || !ready} onClick={sync}>
      {thisSyncing ? <Spinner /> : <RefreshCw />}
      {thisSyncing ? t("syncingPercent", { percent }) : t("syncNow")}
    </Button>
  );
}

function LastSync({ source, className }: { source: ZoteroSource; className?: string }) {
  const t = useTranslations("evidenceLibraryMock.config.sources");
  return (
    <span className={cn("text-xs text-muted-foreground", className)} data-last-sync={source.lastSync ?? "never"}>
      {source.lastSync ? t("lastSync", { when: source.lastSync, records: source.records }) : t("neverSynced")}
    </span>
  );
}

function NameInput({ source, onChange, className }: Pick<CardProps, "source" | "onChange"> & { className?: string }) {
  const t = useTranslations("evidenceLibraryMock.config.sources");
  return (
    <Input
      aria-label={t("labelLabel")}
      className={cn("bg-background font-medium", className)}
      value={source.label}
      placeholder={t("labelPlaceholder")}
      onChange={(e) =>
        onChange((row) => {
          row.label = e.target.value;
        })
      }
    />
  );
}

function RemoveButton({ onRemove }: Pick<CardProps, "onRemove">) {
  const t = useTranslations("evidenceLibraryMock.config.sources");
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="text-muted-foreground hover:text-destructive"
      aria-label={t("removeSource")}
      onClick={onRemove}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

/** Connection method + account/key + group ID. */
function ConnectionFields({ libraryId, source, onChange, columns = 2 }: CardProps & { columns?: 1 | 2 }) {
  const { t, keyMissing, groupIdMissing } = useSource({ libraryId, source });
  return (
    <div className={cn("grid gap-4", columns === 2 && "sm:grid-cols-2")}>
      <Field label={t("authLabel")}>
        {(id) => (
          <Select
            value={source.auth}
            onValueChange={(auth) =>
              onChange((row) => {
                row.auth = auth as ZoteroSource["auth"];
                row.apiKey = "";
              })
            }
          >
            <SelectTrigger id={id} className="w-full bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zotero">{t("authZotero")}</SelectItem>
              <SelectItem value="apiKey">{t("authApiKey")}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Field>
      {source.auth === "zotero" ? (
        <Field label={t("accountLabel")}>
          {() =>
            source.apiKey === ZOTERO_OAUTH ? (
              <p className="flex h-9 items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400" data-zotero-connected>
                <Check className="h-4 w-4" />
                {t("connectedAs", { handle: "@aiined" })}
              </p>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  onChange((row) => {
                    row.apiKey = ZOTERO_OAUTH;
                  })
                }
              >
                {t("connectZotero")}
              </Button>
            )
          }
        </Field>
      ) : (
        <Field label={t("apiKeyLabel")} hint={t("apiKeyHint")} error={keyMissing ? t("apiKeyError") : null}>
          {(id, invalid) => (
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id={id}
                type="password"
                autoComplete="off"
                className="bg-background pl-8 font-mono text-sm"
                value={source.apiKey}
                aria-invalid={invalid || undefined}
                onChange={(e) =>
                  onChange((row) => {
                    row.apiKey = e.target.value;
                  })
                }
              />
            </div>
          )}
        </Field>
      )}
      <Field label={t("groupIdLabel")} hint={t("groupIdHint")} error={groupIdMissing ? t("groupIdError") : null}>
        {(id, invalid) => (
          <Input
            id={id}
            inputMode="numeric"
            className="bg-background font-mono text-sm"
            value={source.groupId}
            placeholder="2405685"
            aria-invalid={invalid || undefined}
            onChange={(e) =>
              onChange((row) => {
                row.groupId = e.target.value.replace(/\D/g, "");
              })
            }
          />
        )}
      </Field>
    </div>
  );
}

function OptionToggles({ source, onChange, stacked }: Pick<CardProps, "source" | "onChange"> & { stacked?: boolean }) {
  const t = useTranslations("evidenceLibraryMock.config.sources");
  return (
    <div className={cn("grid gap-2", !stacked && "sm:grid-cols-2")}>
      <ToggleRow
        label={t("enabledLabel")}
        checked={source.enabled}
        onChange={(enabled) =>
          onChange((row) => {
            row.enabled = enabled;
          })
        }
      />
      <ToggleRow
        label={t("writebackLabel")}
        checked={source.writeback}
        onChange={(writeback) =>
          onChange((row) => {
            row.writeback = writeback;
          })
        }
      />
    </div>
  );
}

function SyncProgress({ libraryId, source, className }: Pick<CardProps, "source" | "libraryId"> & { className?: string }) {
  const { thisSyncing, percent } = useSource({ libraryId, source });
  return thisSyncing ? <Progress value={percent} className={className} /> : null;
}

/* ------------------------------------------------------------------ */
/* 1. Ledger: one summary line, expands to edit                         */
/* ------------------------------------------------------------------ */

function LedgerCard(props: CardProps) {
  const { source, libraryId, onChange, onRemove } = props;
  const { t, ready } = useSource(props);
  const [open, setOpen] = useState(!ready);
  return (
    <div className="overflow-hidden rounded-xl border border-border/50 bg-background" data-source-id={source.id}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? t("collapse") : t("expand")}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <ZoteroMark />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{source.label || t("labelPlaceholder")}</span>
            <span className="block truncate font-mono text-xs text-muted-foreground">
              {source.groupId ? `zotero.org/groups/${source.groupId}` : t("groupIdError")}
            </span>
          </span>
        </button>
        <StateChip source={source} libraryId={libraryId} />
        <LastSync source={source} className="hidden md:inline" />
        <SyncButton source={source} libraryId={libraryId} />
        <RemoveButton onRemove={onRemove} />
      </div>
      <SyncProgress source={source} libraryId={libraryId} className="rounded-none" />
      {open ? (
        <div className="space-y-4 border-t border-border/50 bg-muted/20 p-4">
          <div className="max-w-sm">
            <NameInput source={source} onChange={onChange} />
          </div>
          <ConnectionFields {...props} />
          <OptionToggles source={source} onChange={onChange} />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Split: tinted summary column on the left, form on the right       */
/* ------------------------------------------------------------------ */

function SplitCard(props: CardProps) {
  const { source, libraryId, onChange, onRemove } = props;
  return (
    <div className="grid overflow-hidden rounded-xl border border-border/50 bg-background md:grid-cols-[14rem_1fr]" data-source-id={source.id}>
      <div className="flex flex-col gap-3 border-b border-border/50 bg-muted/30 p-4 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2">
          <ZoteroMark />
          <StateChip source={source} libraryId={libraryId} />
        </div>
        <NameInput source={source} onChange={onChange} />
        <LastSync source={source} />
        <SyncProgress source={source} libraryId={libraryId} />
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <SyncButton source={source} libraryId={libraryId} />
          <RemoveButton onRemove={onRemove} />
        </div>
      </div>
      <div className="space-y-4 p-4">
        <ConnectionFields {...props} />
        <OptionToggles source={source} onChange={onChange} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Timeline: thin rail with three dots, no boxes                     */
/* ------------------------------------------------------------------ */

function TimelineCard(props: CardProps) {
  const { source, libraryId, onChange, onRemove } = props;
  const { t, connected, groupIdMissing } = useSource(props);
  const Dot = ({ done }: { done?: boolean }) => (
    <span
      className={cn(
        "absolute -left-[1.3rem] top-1 flex size-4 items-center justify-center rounded-full border-2 bg-background",
        done ? "border-emerald-500 text-emerald-500" : "border-border",
      )}
    >
      {done ? <Check className="h-2.5 w-2.5" /> : null}
    </span>
  );
  return (
    <div className="rounded-xl border border-border/50 bg-background p-4" data-source-id={source.id}>
      <div className="flex items-center gap-2">
        <ZoteroMark />
        <NameInput source={source} onChange={onChange} className="max-w-xs" />
        <StateChip source={source} libraryId={libraryId} />
        <span className="ml-auto flex items-center gap-2">
          <LastSync source={source} className="hidden md:inline" />
          <SyncButton source={source} libraryId={libraryId} />
          <RemoveButton onRemove={onRemove} />
        </span>
      </div>
      <SyncProgress source={source} libraryId={libraryId} className="mt-3" />
      <ol className="ml-6 mt-5 space-y-6 border-l border-border/60 pl-5">
        <li className="relative space-y-3">
          <Dot done={connected} />
          <p className="text-sm font-medium">{t("stepConnect")}</p>
          <ConnectionFieldsWithoutGroup {...props} />
        </li>
        <li className="relative space-y-3">
          <Dot done={!groupIdMissing} />
          <p className="text-sm font-medium">{t("stepGroup")}</p>
          <GroupField {...props} />
        </li>
        <li className="relative space-y-3">
          <Dot done />
          <p className="text-sm font-medium">{t("stepOptions")}</p>
          <OptionToggles source={source} onChange={onChange} />
        </li>
      </ol>
    </div>
  );
}

function ConnectionFieldsWithoutGroup(props: CardProps) {
  // Same as ConnectionFields, minus the group ID (rendered by GroupField).
  const { source, onChange } = props;
  const { t, keyMissing } = useSource(props);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("authLabel")}>
        {(id) => (
          <Select
            value={source.auth}
            onValueChange={(auth) =>
              onChange((row) => {
                row.auth = auth as ZoteroSource["auth"];
                row.apiKey = "";
              })
            }
          >
            <SelectTrigger id={id} className="w-full bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zotero">{t("authZotero")}</SelectItem>
              <SelectItem value="apiKey">{t("authApiKey")}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Field>
      {source.auth === "zotero" ? (
        <Field label={t("accountLabel")}>
          {() =>
            source.apiKey === ZOTERO_OAUTH ? (
              <p className="flex h-9 items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
                <Check className="h-4 w-4" />
                {t("connectedAs", { handle: "@aiined" })}
              </p>
            ) : (
              <Button type="button" variant="outline" onClick={() => onChange((row) => { row.apiKey = ZOTERO_OAUTH; })}>
                {t("connectZotero")}
              </Button>
            )
          }
        </Field>
      ) : (
        <Field label={t("apiKeyLabel")} hint={t("apiKeyHint")} error={keyMissing ? t("apiKeyError") : null}>
          {(id, invalid) => (
            <Input
              id={id}
              type="password"
              autoComplete="off"
              className="bg-background font-mono text-sm"
              value={source.apiKey}
              aria-invalid={invalid || undefined}
              onChange={(e) => onChange((row) => { row.apiKey = e.target.value; })}
            />
          )}
        </Field>
      )}
    </div>
  );
}

function GroupField(props: CardProps) {
  const { source, onChange } = props;
  const { t, groupIdMissing } = useSource(props);
  return (
    <Field label={t("groupIdLabel")} hint={t("groupIdHint")} error={groupIdMissing ? t("groupIdError") : null} className="max-w-sm">
      {(id, invalid) => (
        <Input
          id={id}
          inputMode="numeric"
          className="bg-background font-mono text-sm"
          value={source.groupId}
          placeholder="2405685"
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange((row) => { row.groupId = e.target.value.replace(/\D/g, ""); })}
        />
      )}
    </Field>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Table row: compact line, edit in a side drawer                     */
/* ------------------------------------------------------------------ */

function TableRowCard(props: CardProps) {
  const { source, libraryId, onChange, onRemove } = props;
  const { t } = useSource(props);
  const [open, setOpen] = useState(false);
  return (
    <div
      className="grid items-center gap-3 rounded-lg border border-border/50 bg-background px-3 py-2 md:grid-cols-[auto_1fr_auto_auto_auto_auto]"
      data-source-id={source.id}
    >
      <ZoteroMark className="size-7 text-[11px]" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{source.label || t("labelPlaceholder")}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {source.groupId || "—"} · {source.auth === "zotero" ? t("authZotero") : t("authApiKey")}
          {source.writeback ? ` · ${t("writebackShort")}` : ""}
        </p>
      </div>
      <StateChip source={source} libraryId={libraryId} />
      <LastSync source={source} className="hidden md:inline" />
      <SyncButton source={source} libraryId={libraryId} />
      <div className="flex items-center">
        <Button type="button" variant="ghost" size="icon" aria-label={t("edit")} onClick={() => setOpen(true)}>
          <Pencil className="h-4 w-4" />
        </Button>
        <RemoveButton onRemove={onRemove} />
      </div>
      <SyncProgress source={source} libraryId={libraryId} className="md:col-span-6" />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{source.label || t("labelPlaceholder")}</SheetTitle>
            <SheetDescription>{t("editDescription")}</SheetDescription>
          </SheetHeader>
          <div className="space-y-5 px-4 pb-6">
            <NameInput source={source} onChange={onChange} />
            <ConnectionFields {...props} columns={1} />
            <OptionToggles source={source} onChange={onChange} stacked />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 5. Stats: numbers first, then settings                                */
/* ------------------------------------------------------------------ */

function StatsCard(props: CardProps) {
  const { source, libraryId, onChange, onRemove } = props;
  const { t } = useSource(props);
  const Stat = ({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) => (
    <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-semibold", mono && "font-mono font-medium")}>{value}</p>
    </div>
  );
  return (
    <div className="space-y-4 rounded-xl border border-border/50 bg-background p-4" data-source-id={source.id}>
      <div className="flex items-center gap-2">
        <ZoteroMark />
        <NameInput source={source} onChange={onChange} className="max-w-xs" />
        <StateChip source={source} libraryId={libraryId} />
        <span className="ml-auto flex items-center gap-1">
          <SyncButton source={source} libraryId={libraryId} />
          <RemoveButton onRemove={onRemove} />
        </span>
      </div>
      <SyncProgress source={source} libraryId={libraryId} />
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label={t("statRecords")} value={source.records.toLocaleString()} />
        <Stat label={t("statLastSync")} value={source.lastSync ?? t("neverSyncedShort")} />
        <Stat label={t("statGroup")} value={source.groupId || "—"} mono />
      </div>
      <div className="border-t border-border/50 pt-4">
        <ConnectionFields {...props} />
      </div>
      <OptionToggles source={source} onChange={onChange} />
    </div>
  );
}
