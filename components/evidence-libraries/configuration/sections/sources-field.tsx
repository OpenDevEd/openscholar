"use client";

import { useAction, useMutation } from "convex/react";
import {
  ChevronDown,
  ChevronRight,
  Globe,
  Lock,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
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
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { type ZoteroSourceEntry, zoteroSourceEntry } from "@/convex/zotero/sourceEntry";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { getConvexSiteUrl } from "@/lib/convex-site";
import { cn } from "@/lib/utils";
import { ChipInput, EmptyList, FieldGroup, MetaList, Panel } from "../fields";
import { FieldError } from "../section-card";
import { StatusChip, type StatusTone } from "../status-chip";
import { DEFAULT_TAG_RULES, type TagRuleKey, type TagRules, tagRuleIssue } from "./tag-rules";

type ConnectedGroup = {
  groupId: string;
  name: string;
  isPublic: boolean;
  itemCount: number;
  connectedByZoteroUsername?: string;
  scopes: { read: boolean; write: boolean };
};

type PickerGroup = { id: string; name: string; isPublic: boolean; itemCount: number; alreadyAdded: boolean };

type PickerState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "not-connected" }
  | { status: "ready"; groups: PickerGroup[] };

type GroupHealth = "connected" | "paused";

const HEALTH_TONE: Record<GroupHealth, StatusTone> = { connected: "success", paused: "neutral" };

// Displayed in the mock's order, not the schema's.
const TAG_RULE_ORDER: TagRuleKey[] = ["hidden", "internal", "comingSoon", "description", "redirects", "publish"];

/** The group id from a zotero.org group link, or null for anything else. */
function groupIdFromLink(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !/^(www\.)?zotero\.org$/u.test(url.hostname)) return null;
  const match = /^\/groups\/(\d+)(?:\/|$)/u.exec(url.pathname);
  return match ? match[1] : null;
}

export type SourcesFieldProps = {
  libraryId: Id<"evidenceLibraries">;
  /** The `sources` section of the draft. */
  value: ZoteroSourceEntry[];
  onChange: (value: ZoteroSourceEntry[]) => void;
  /** The `content.tags` rules of the draft. */
  tags: TagRules;
  onTagsChange: (tags: TagRules) => void;
};

/**
 * Field body for the Sources section: the signed-in admin's Zotero account,
 * the connected groups, and the tag rules behind "Advanced".
 */
export function SourcesField({ libraryId, value, onChange, tags, onTagsChange }: SourcesFieldProps) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  const account = useProtectedQuery(api.zotero.queries.getConnectionStatus, {});
  const groups = useProtectedQuery(api.zotero.libraryGroups.listLibraryZoteroGroups, { libraryId });
  const listMyGroups = useAction(api.zotero.libraryGroupActions.listMyZoteroGroups);
  const connectGroup = useAction(api.zotero.libraryGroupActions.connectZoteroGroup);
  const removeGroup = useMutation(api.zotero.libraryGroups.removeZoteroGroup);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);
  // Convex calls finish after other rows may have changed; edits always start
  // from the newest draft, not the one captured when the call began.
  const latest = useRef(value);
  latest.current = value;
  function commit(next: ZoteroSourceEntry[]) {
    latest.current = next;
    onChange(next);
  }

  const connected = account.data?.connected === true;
  const byGroupId = new Map<string, ConnectedGroup>((groups.data ?? []).map((group) => [group.groupId, group]));

  /** Connects each group; returns the ids that could not be connected. */
  async function addGroups(groupIds: string[]): Promise<string[]> {
    const failed: string[] = [];
    for (const groupId of groupIds) {
      try {
        await connectGroup({ libraryId, groupId });
        if (!latest.current.some((entry) => entry.groupId === groupId)) {
          commit([...latest.current, zoteroSourceEntry(groupId)]);
        }
      } catch (error) {
        failed.push(groupId);
        toast.error(t("connectFailed"), { description: errorMessage(error) });
      }
    }
    return failed;
  }

  async function reconnect(groupId: string) {
    setBusyGroupId(groupId);
    try {
      const result = await connectGroup({ libraryId, groupId });
      toast.success(t("reconnected", { name: result.name }));
    } catch (error) {
      toast.error(t("connectFailed"), { description: errorMessage(error) });
    } finally {
      setBusyGroupId(null);
    }
  }

  async function remove(groupId: string) {
    setBusyGroupId(groupId);
    try {
      await removeGroup({ libraryId, groupId });
      commit(latest.current.filter((entry) => entry.groupId !== groupId));
    } catch {
      toast.error(t("removeFailed"));
    } finally {
      setBusyGroupId(null);
    }
  }

  function patchEntry(groupId: string, patch: Partial<ZoteroSourceEntry>) {
    commit(latest.current.map((entry) => (entry.groupId === groupId ? { ...entry, ...patch } : entry)));
  }

  return (
    <div className="space-y-6">
      <AccountPanel account={account.data} />

      <FieldGroup
        title={t("groupsHeading")}
        action={
          <GroupPicker
            disabled={!connected}
            addedIds={value.map((entry) => entry.groupId)}
            load={() => listMyGroups({ libraryId })}
            onAdd={addGroups}
          />
        }
      >
        {value.length === 0 ? (
          <EmptyList>{connected ? t("noGroups") : t("connectFirst")}</EmptyList>
        ) : (
          <div className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/50 bg-background">
            {value.map((entry) => (
              <GroupRow
                key={entry.groupId}
                entry={entry}
                group={byGroupId.get(entry.groupId)}
                busy={busyGroupId === entry.groupId}
                canReconnect={connected}
                onPatch={(patch) => patchEntry(entry.groupId, patch)}
                onReconnect={() => reconnect(entry.groupId)}
                onRemove={() => setRemoveId(entry.groupId)}
              />
            ))}
          </div>
        )}

        <PasteLink
          disabled={!connected}
          existing={value.map((entry) => entry.groupId)}
          onAdd={(groupId) => addGroups([groupId])}
        />
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
              {TAG_RULE_ORDER.map((key) => {
                const current = tags[key] ?? DEFAULT_TAG_RULES[key];
                const issue = tagRuleIssue(key, current);
                return (
                  <ChipInput
                    key={key}
                    label={t(`tagRules.${key}.label`)}
                    hint={t(`tagRules.${key}.hint`)}
                    values={current}
                    placeholder={t("tagPlaceholder")}
                    error={issue ? t(`tagRules.issues.${issue}`) : null}
                    onChange={(values) => onTagsChange({ ...tags, [key]: values })}
                  />
                );
              })}
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
                if (id) void remove(id);
              }}
            >
              {t("removeConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Account                                                             */
/* ------------------------------------------------------------------ */

function AccountPanel({
  account,
}: {
  account:
    | { connected: true; zoteroUserId: string; username?: string }
    | { connected: false }
    | undefined;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  const startOAuth = useAction(api.zotero.actions.startOAuth);
  const disconnect = useMutation(api.zotero.mutations.disconnect);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const connected = account?.connected === true;

  async function connect() {
    const convexSite = getConvexSiteUrl();
    if (!convexSite) {
      toast.error(t("connectAccountFailed"));
      return;
    }
    try {
      const result = await startOAuth({
        callbackUrl: `${convexSite}/api/zotero/callback`,
        returnTo: `${window.location.pathname}${window.location.search}`,
      });
      window.location.href = result.authorizeUrl;
    } catch {
      toast.error(t("connectAccountFailed"));
    }
  }

  return (
    <Panel
      tone="muted"
      className="flex flex-wrap items-center gap-3"
      data-account-state={connected ? "connected" : "not-connected"}
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#cc2936] text-sm font-bold text-white"
        aria-hidden
      >
        Z
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">
          {account?.connected
            ? t("connectedAs", { handle: account.username ?? account.zoteroUserId })
            : t("notConnected")}
        </p>
        <p className="text-xs text-muted-foreground">{connected ? t("accountHeading") : t("notConnectedHint")}</p>
      </div>
      <div className="shrink-0">
        {connected ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
            {t("disconnect")}
          </Button>
        ) : (
          <Button type="button" onClick={connect}>
            {t("connect")}
          </Button>
        )}
      </div>

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
                void disconnect({}).catch(() => toast.error(t("disconnectFailed")));
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
  entry,
  group,
  busy,
  canReconnect,
  onPatch,
  onReconnect,
  onRemove,
}: {
  entry: ZoteroSourceEntry;
  group: ConnectedGroup | undefined;
  busy: boolean;
  canReconnect: boolean;
  onPatch: (patch: Partial<ZoteroSourceEntry>) => void;
  onReconnect: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  const paused = !entry.enabled;
  const health: GroupHealth = paused ? "paused" : "connected";
  const canWrite = group?.scopes.write === true;
  const metaItems = group
    ? [
        {
          key: "visibility",
          icon: group.isPublic ? Globe : Lock,
          value: group.isPublic ? t("public") : t("private"),
        },
        { key: "records", label: t("recordsLabel"), value: group.itemCount.toLocaleString() },
        ...(group.connectedByZoteroUsername
          ? [{ key: "by", label: t("connectedBy"), value: group.connectedByZoteroUsername }]
          : []),
      ]
    : [];

  return (
    <div
      className={cn("space-y-2 p-4", paused && "bg-muted/30")}
      data-group-id={entry.groupId}
      data-health={health}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("text-sm font-medium", paused && "text-muted-foreground")}>
              {group?.name ?? entry.key}
            </span>
            <StatusChip tone={HEALTH_TONE[health]}>{t(`health.${health}`)}</StatusChip>
          </div>
          {metaItems.length > 0 ? <MetaList items={metaItems} /> : null}
        </div>

        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="flex h-8 items-center gap-2 rounded-md border border-border/50 bg-background px-2.5 text-xs">
                <Switch
                  checked={entry.writebackEnabled}
                  disabled={!canWrite}
                  aria-label={t("writeback")}
                  onCheckedChange={(checked) => onPatch({ writebackEnabled: checked })}
                />
                {t("writeback")}
              </label>
            </TooltipTrigger>
            <TooltipContent>{canWrite ? t("writebackHint") : t("writebackUnavailable")}</TooltipContent>
          </Tooltip>
          {!canWrite ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy || !canReconnect}
              onClick={onReconnect}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("reconnect")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPatch({ enabled: paused })}
          >
            {paused ? <Play /> : <Pause />}
            {paused ? t("resume") : t("pause")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            aria-label={t("remove")}
            disabled={busy}
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {!canWrite && group ? (
        <p className="text-xs text-muted-foreground" data-writeback="unavailable">
          {t("writebackUnavailable")}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add groups                                                          */
/* ------------------------------------------------------------------ */

function GroupPicker({
  disabled,
  addedIds,
  load,
  onAdd,
}: {
  disabled: boolean;
  addedIds: string[];
  load: () => Promise<{ connected: false } | { connected: true; groups: PickerGroup[] }>;
  onAdd: (groupIds: string[]) => Promise<string[]>;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PickerState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const requestCount = useRef(0);
  const q = query.trim().toLowerCase();
  const rows =
    state.status === "ready"
      ? state.groups.filter((o) => !q || o.name.toLowerCase().includes(q) || o.id.includes(q))
      : [];

  async function reset(next: boolean) {
    setOpen(next);
    setPicked(new Set());
    setQuery("");
    if (!next) return;
    const request = ++requestCount.current;
    setState({ status: "loading" });
    try {
      const mine = await load();
      if (request !== requestCount.current) return;
      setState(mine.connected ? { status: "ready", groups: mine.groups } : { status: "not-connected" });
    } catch {
      if (request === requestCount.current) setState({ status: "failed" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => void reset(next)}>
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
            <Input
              autoFocus
              value={query}
              aria-label={t("picker.search")}
              placeholder={t("picker.search")}
              className="bg-background pl-8"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {state.status === "loading" ? (
            <p className="flex items-center gap-2 px-5 py-10 text-sm text-muted-foreground" role="status">
              <Spinner className="h-4 w-4" />
              {t("picker.loading")}
            </p>
          ) : state.status === "failed" ? (
            <p className="px-5 py-10 text-sm text-destructive" role="alert">
              {t("picker.failed")}
            </p>
          ) : state.status === "not-connected" ? (
            <p className="px-5 py-10 text-sm text-muted-foreground">{t("connectFirst")}</p>
          ) : (
            <Table aria-label={t("picker.title")}>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>{t("picker.colGroup")}</TableHead>
                  <TableHead className="text-right">{t("picker.colItems")}</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                      {state.groups.length === 0 ? t("picker.noGroups") : t("picker.noMatch")}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((o) => {
                    const added = o.alreadyAdded || addedIds.includes(o.id);
                    const checked = picked.has(o.id);
                    const toggle = () =>
                      setPicked((p) => {
                        const next = new Set(p);
                        if (next.has(o.id)) next.delete(o.id);
                        else next.add(o.id);
                        return next;
                      });
                    return (
                      <TableRow
                        key={o.id}
                        data-group-id={o.id}
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
                              { key: "id", label: t("groupIdLabel"), value: <span className="font-mono">{o.id}</span> },
                            ]}
                          />
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {o.itemCount.toLocaleString()}
                        </TableCell>
                        <TableCell>{added ? <StatusChip tone="neutral">{t("picker.added")}</StatusChip> : null}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </div>
        <DialogFooter className="items-center border-t border-border/50 px-5 py-3 sm:justify-between">
          <span className="text-sm text-muted-foreground" data-picked-count={picked.size}>
            {t("picker.pickedCount", { count: picked.size })}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => void reset(false)}>
              {t("picker.cancel")}
            </Button>
            <Button
              type="button"
              disabled={picked.size === 0 || adding}
              onClick={async () => {
                setAdding(true);
                let failed: string[] = [];
                try {
                  failed = await onAdd([...picked]);
                } finally {
                  setAdding(false);
                }
                if (failed.length > 0) {
                  setPicked(new Set(failed));
                  return;
                }
                void reset(false);
              }}
            >
              {adding ? <Spinner className="h-4 w-4" /> : <Plus />}
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
  onAdd,
}: {
  disabled: boolean;
  existing: string[];
  onAdd: (groupId: string) => Promise<string[]>;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const groupId = groupIdFromLink(value);
    if (!groupId) {
      setError(t("pasteInvalid"));
      return;
    }
    if (existing.includes(groupId)) {
      setError(t("pasteDuplicate"));
      return;
    }
    setBusy(true);
    try {
      const failed = await onAdd(groupId);
      if (failed.length === 0) {
        setValue("");
        setError(null);
      }
    } finally {
      setBusy(false);
    }
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
              void submit();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || busy || !value.trim()}
          onClick={() => void submit()}
        >
          {t("pasteAdd")}
        </Button>
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  );
}

function errorMessage(error: unknown): string | undefined {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { message?: string } }).data;
    if (data?.message) return data.message;
  }
  return error instanceof Error ? error.message : undefined;
}
