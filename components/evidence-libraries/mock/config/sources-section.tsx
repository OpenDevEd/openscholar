"use client";

import {
  ChevronDown,
  ChevronRight,
  Database,
  Globe,
  Lock,
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  type GroupHealth,
  newId,
  TAG_RULE_KEYS,
  type TagRuleKey,
  type ZoteroGroupOption,
  type ZoteroGroupSource,
} from "@/lib/evidence-libraries/mock/config";
import { StatusChip, type StatusTone } from "../library-status-badge";
import { Field, FieldError } from "../section-card";
import { ChipInput, EmptyList, FieldGroup, MetaList, Panel } from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

const TAG_RULE_COPY: Record<TagRuleKey, { label: string; hint: string }> = {
  hidden: { label: "hiddenLabel", hint: "hiddenHint" },
  internal: { label: "internalLabel", hint: "internalHint" },
  comingSoon: { label: "comingSoonLabel", hint: "comingSoonHint" },
  description: { label: "descriptionLabel", hint: "descriptionHint" },
  redirects: { label: "redirectsLabel", hint: "redirectsHint" },
  publish: { label: "publishLabel", hint: "publishHint" },
};

const HEALTH_TONE: Record<GroupHealth, StatusTone> = {
  healthy: "success",
  paused: "neutral",
  error: "danger",
  new: "warning",
};

const GROUP_LINK = /zotero\.org\/groups\/(\d+)/;

export function SourcesSection({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.sources");
  const sources = library.draft.sources;
  const connected = sources.account.method !== "none";
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);

  function addGroups(options: ZoteroGroupOption[]) {
    patch((d) => {
      for (const o of options) {
        if (d.sources.groups.some((g) => g.groupId === o.groupId)) continue;
        d.sources.groups.push({
          id: newId("src"),
          groupId: o.groupId,
          name: o.name,
          isPublic: o.isPublic,
          items: 0,
          writeback: false,
          paused: false,
          lastSync: null,
          lastError: null,
        });
      }
      return d;
    });
  }

  return (
    <SectionShell sectionKey="sources" icon={Database} description={t("description")} library={library}>
      <AccountPanel library={library} patch={patch} />

      <FieldGroup
        title={t("groupsHeading")}
        action={
          <GroupPicker
            options={library.zoteroGroups}
            addedIds={sources.groups.map((g) => g.groupId)}
            disabled={!connected}
            onAdd={addGroups}
          />
        }
      >
        {sources.groups.length === 0 ? (
          <EmptyList>{connected ? t("noGroups") : t("connectFirst")}</EmptyList>
        ) : (
          <div className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/50 bg-background">
            {sources.groups.map((group) => (
              <GroupRow
                key={group.id}
                group={group}
                onChange={(fn) =>
                  patch((d) => {
                    const row = d.sources.groups.find((g) => g.id === group.id);
                    if (row) fn(row);
                    return d;
                  })
                }
                onRemove={() => setRemoveId(group.id)}
              />
            ))}
          </div>
        )}

        <PasteLink
          disabled={!connected}
          existing={sources.groups.map((g) => g.groupId)}
          options={library.zoteroGroups}
          onAdd={(o) => addGroups([o])}
        />
      </FieldGroup>

      <FieldGroup title={t("activityHeading")}>
        {library.syncLog.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("noActivity")}</p>
        ) : (
          <ol className="space-y-1.5" data-sync-log>
            {library.syncLog.slice(0, 5).map((ev) => (
              <li key={ev.id} className="flex items-baseline gap-3 text-xs">
                <span className="w-32 shrink-0 font-mono text-muted-foreground">{ev.at}</span>
                <span className={cn("font-medium", ev.tone === "error" && "text-destructive")}>{ev.groupName}</span>
                <span className="text-muted-foreground">{ev.message}</span>
              </li>
            ))}
          </ol>
        )}
      </FieldGroup>

      <div className="space-y-3 border-t border-border/50 pt-5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 h-7 px-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {advancedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {t("advanced")}
        </Button>
        {advancedOpen ? (
          <Panel tone="muted" className="space-y-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{t("tagRulesHeading")}</p>
              <p className="text-xs text-muted-foreground">{t("tagRulesIntro")}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {TAG_RULE_KEYS.map((key) => (
                <ChipInput
                  key={key}
                  label={t(TAG_RULE_COPY[key].label as "hiddenLabel")}
                  hint={t(TAG_RULE_COPY[key].hint as "hiddenHint")}
                  values={sources.tagRules[key]}
                  placeholder={t("tagPlaceholder")}
                  error={key === "publish" && sources.tagRules.publish.length === 0 ? t("publishError") : null}
                  onChange={(values) =>
                    patch((d) => {
                      d.sources.tagRules[key] = values;
                      return d;
                    })
                  }
                />
              ))}
            </div>
          </Panel>
        ) : null}
      </div>

      <AlertDialog open={removeId !== null} onOpenChange={(open) => !open && setRemoveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("removeBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("picker.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = removeId;
                setRemoveId(null);
                if (!id) return;
                patch((d) => {
                  d.sources.groups = d.sources.groups.filter((g) => g.id !== id);
                  return d;
                });
              }}
            >
              {t("removeConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionShell>
  );
}

/* ------------------------------------------------------------------ */
/* Account                                                             */
/* ------------------------------------------------------------------ */

function AccountPanel({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.sources");
  const account = library.draft.sources.account;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const set = (next: typeof account) =>
    patch((d) => {
      d.sources.account = next;
      return d;
    });

  return (
    <Panel tone="muted" className="flex flex-wrap items-center gap-3" data-account={account.method}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#cc2936] text-sm font-bold text-white" aria-hidden>
        Z
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">
          {account.method === "zotero"
            ? t("connectedAs", { handle: account.handle })
            : account.method === "apiKey"
              ? t("keyConnected")
              : t("notConnected")}
        </p>
        <p className="text-xs text-muted-foreground">
          {account.method === "none" ? t("notConnectedHint") : t("accountHeading")}
        </p>
      </div>
      <div className="shrink-0">
        {account.method === "none" ? (
          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => set({ method: "zotero", handle: "@aiined" })}>
              {t("connect")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => set({ method: "apiKey", apiKey: "" })}>
              {t("useKeyInstead")}
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
            {t("disconnect")}
          </Button>
        )}
      </div>

      {account.method === "apiKey" ? (
        <div className="flex w-full flex-wrap items-end gap-3 border-t border-border/50 pt-3">
          <Field
            label={t("keyLabel")}
            hint={t("keyHint")}
            error={!account.apiKey.trim() ? t("keyLabel") : null}
            className="min-w-64 flex-1"
          >
            {(id, invalid) => (
              <Input
                id={id}
                type="password"
                autoComplete="off"
                className="bg-background font-mono text-sm"
                value={account.apiKey}
                aria-invalid={invalid || undefined}
                onChange={(e) => set({ method: "apiKey", apiKey: e.target.value })}
              />
            )}
          </Field>
          <Button type="button" variant="ghost" size="sm" className="mb-6" onClick={() => set({ method: "zotero", handle: "@aiined" })}>
            {t("useSignInInstead")}
          </Button>
        </div>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("disconnectTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("disconnectBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("picker.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                set({ method: "none" });
              }}
            >
              {t("disconnect")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Group row                                                           */
/* ------------------------------------------------------------------ */

function GroupRow({
  group,
  onChange,
  onRemove,
}: {
  group: ZoteroGroupSource;
  onChange: (fn: (row: ZoteroGroupSource) => void) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("evidenceLibraryMock.config.sources");
  const health: GroupHealth = group.paused
    ? "paused"
    : group.lastError
      ? "error"
      : group.lastSync
        ? "healthy"
        : "new";

  return (
    <div className={cn("space-y-2 p-4", group.paused && "bg-muted/30")} data-group-id={group.groupId} data-health={health}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("text-sm font-medium", group.paused && "text-muted-foreground")}>{group.name}</span>
            <StatusChip tone={HEALTH_TONE[health]}>{t(`health.${health}`)}</StatusChip>
          </div>
          <MetaList
            items={[
              {
                key: "visibility",
                icon: group.isPublic ? Globe : Lock,
                value: group.isPublic ? t("public") : t("private"),
              },
              { key: "records", label: t("recordsLabel"), value: group.items.toLocaleString() },
              { key: "sync", label: t("lastSyncLabel"), value: group.lastSync ?? t("neverSynced") },
            ]}
          />
        </div>

        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="flex h-8 items-center gap-2 rounded-md border border-border/50 bg-background px-2.5 text-xs">
                <Switch
                  checked={group.writeback}
                  aria-label={t("writeback")}
                  onCheckedChange={(v) =>
                    onChange((row) => {
                      row.writeback = v;
                    })
                  }
                />
                {t("writeback")}
              </label>
            </TooltipTrigger>
            <TooltipContent>{t("writebackHint")}</TooltipContent>
          </Tooltip>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange((row) => {
                row.paused = !row.paused;
              })
            }
          >
            {group.paused ? <Play /> : <Pause />}
            {group.paused ? t("resume") : t("pause")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            aria-label={t("remove")}
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {group.lastError ? <FieldError>{group.lastError}</FieldError> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add groups                                                          */
/* ------------------------------------------------------------------ */

function GroupPicker({
  options,
  addedIds,
  disabled,
  onAdd,
}: {
  options: ZoteroGroupOption[];
  addedIds: string[];
  disabled: boolean;
  onAdd: (groups: ZoteroGroupOption[]) => void;
}) {
  const t = useTranslations("evidenceLibraryMock.config.sources");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const q = query.trim().toLowerCase();
  const rows = options.filter((o) => !q || o.name.toLowerCase().includes(q) || o.groupId.includes(q));

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setPicked(new Set());
      setQuery("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <Plus />
          {t("addGroups")}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border/50 px-5 py-4">
          <DialogTitle>{t("picker.title")}</DialogTitle>
          <DialogDescription>{t("picker.description")}</DialogDescription>
        </DialogHeader>
        <div className="border-b border-border/50 bg-muted/30 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={query} placeholder={t("picker.search")} className="bg-background pl-8" onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>{t("picker.colGroup")}</TableHead>
                <TableHead className="text-right">{t("picker.colItems")}</TableHead>
                <TableHead className="text-right">{t("picker.colMembers")}</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    {t("picker.noMatch")}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((o) => {
                  const added = addedIds.includes(o.groupId);
                  const checked = picked.has(o.groupId);
                  const toggle = () =>
                    setPicked((p) => {
                      const next = new Set(p);
                      if (next.has(o.groupId)) next.delete(o.groupId);
                      else next.add(o.groupId);
                      return next;
                    });
                  return (
                    <TableRow
                      key={o.groupId}
                      data-group-id={o.groupId}
                      className={cn("cursor-pointer", added && "cursor-default opacity-60", checked && "bg-primary/5")}
                      onClick={() => !added && toggle()}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox aria-label={o.name} checked={checked} disabled={added} onCheckedChange={toggle} />
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{o.name}</p>
                        <MetaList
                          className="text-muted-foreground"
                          items={[
                            { key: "vis", icon: o.isPublic ? Globe : Lock, value: o.isPublic ? t("public") : t("private") },
                            { key: "id", label: t("groupIdLabel"), value: <span className="font-mono">{o.groupId}</span> },
                          ]}
                        />
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{o.items.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{o.members}</TableCell>
                      <TableCell>{added ? <StatusChip tone="neutral">{t("picker.added")}</StatusChip> : null}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        <DialogFooter className="items-center border-t border-border/50 px-5 py-3 sm:justify-between">
          <span className="text-sm text-muted-foreground">{t("picker.pickedCount", { count: picked.size })}</span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => reset(false)}>
              {t("picker.cancel")}
            </Button>
            <Button
              type="button"
              disabled={picked.size === 0}
              onClick={() => {
                onAdd(options.filter((o) => picked.has(o.groupId)));
                reset(false);
              }}
            >
              <Plus />
              {t("picker.addPicked", { count: picked.size })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasteLink({
  disabled,
  existing,
  options,
  onAdd,
}: {
  disabled: boolean;
  existing: string[];
  options: ZoteroGroupOption[];
  onAdd: (group: ZoteroGroupOption) => void;
}) {
  const t = useTranslations("evidenceLibraryMock.config.sources");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const match = GROUP_LINK.exec(value);
    if (!match) {
      setError(t("pasteInvalid"));
      return;
    }
    const groupId = match[1];
    if (existing.includes(groupId)) {
      setError(t("pasteDuplicate"));
      return;
    }
    const known = options.find((o) => o.groupId === groupId);
    onAdd(known ?? { groupId, name: `Zotero group ${groupId}`, isPublic: true, items: 0, members: 0 });
    setValue("");
    setError(null);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs text-muted-foreground">{t("pasteLink")}</span>
        <Input
          aria-label={t("pasteLink")}
          className="h-8 bg-background font-mono text-xs"
          placeholder={t("pastePlaceholder")}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" disabled={disabled || !value.trim()} onClick={submit}>
          {t("pasteAdd")}
        </Button>
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  );
}
