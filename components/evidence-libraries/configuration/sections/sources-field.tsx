"use client";

import { ZoteroIcon } from "@/components/icons/zotero-icon";
import { useAction, useMutation } from "convex/react";
import {
  ChevronDown,
  ChevronRight,
  Globe,
  Lock,
  Plus,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  type ZoteroSourceEntry,
  zoteroSourceEntry,
} from "@/convex/zotero/sourceEntry";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { getConvexSiteUrl } from "@/lib/convex-site";
import type { EvidenceSourceEntry } from "@/lib/evidence-libraries/configuration/sources";
import { ChipInput, EmptyList, MetaList, Panel } from "../fields";
import { FieldError } from "../section-card";
import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  OpenAlexAccessSettings,
  OpenAlexSearchDialog,
  OpenAlexSourceRow,
  useOpenAlexSources,
} from "./openalex-sources";
import { SourceRow } from "./source-row";
import { type StatusTone } from "../status-chip";
import {
  localPickerSource,
  type PickerSource,
  RemotePickerDialog,
} from "./remote-picker-dialog";
import {
  DEFAULT_TAG_RULES,
  type TagRuleKey,
  type TagRules,
  tagRuleIssue,
} from "./tag-rules";

type ConnectedGroup = {
  groupId: string;
  name: string;
  isPublic: boolean;
  itemCount: number;
  connectedByZoteroUsername?: string;
  scopes: { read: boolean; write: boolean };
};

type PickerGroup = {
  id: string;
  name: string;
  isPublic: boolean;
  itemCount: number;
};

type GroupHealth = "connected" | "paused";

const HEALTH_TONE: Record<GroupHealth, StatusTone> = {
  connected: "success",
  paused: "neutral",
};

// Displayed in the mock's order, not the schema's.
const TAG_RULE_ORDER: TagRuleKey[] = [
  "hidden",
  "internal",
  "comingSoon",
  "description",
  "redirects",
  "publish",
];

/** The group id from a zotero.org group link, or null for anything else. */
function groupIdFromLink(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !/^(www\.)?zotero\.org$/u.test(url.hostname))
    return null;
  const match = /^\/groups\/(\d+)(?:\/|$)/u.exec(url.pathname);
  return match ? match[1] : null;
}

export type SourcesFieldProps = {
  libraryId: Id<"evidenceLibraries">;
  /** The `sources` section of the draft. */
  value: EvidenceSourceEntry[];
  onChange: (value: EvidenceSourceEntry[]) => void;
  /** The `content.tags` rules of the draft. */
  tags: TagRules;
  onTagsChange: (tags: TagRules) => void;
};

/**
 * One list of library sources. Provider credentials and import rules are
 * managed separately from the groups and searches they connect.
 */
export function SourcesField({
  libraryId,
  value,
  onChange,
  tags,
  onTagsChange,
}: SourcesFieldProps) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  const account = useProtectedQuery(api.zotero.queries.getConnectionStatus, {});
  const groups = useProtectedQuery(
    api.zotero.libraryGroups.listLibraryZoteroGroups,
    { libraryId },
  );
  const listMyGroups = useAction(
    api.zotero.libraryGroupActions.listMyZoteroGroups,
  );
  const connectGroup = useAction(
    api.zotero.libraryGroupActions.connectZoteroGroup,
  );
  const removeGroup = useMutation(api.zotero.libraryGroups.removeZoteroGroup);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [connectionTab, setConnectionTab] = useState("zotero");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const openalex = useOpenAlexSources({ libraryId, value, onChange });
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);
  // Convex calls finish after other rows may have changed; edits always start
  // from the newest draft, not the one captured when the call began.
  const latest = useRef(value);
  latest.current = value;
  function commit(next: EvidenceSourceEntry[]) {
    latest.current = next;
    onChange(next);
  }

  const connected = account.data?.connected === true;
  const zoteroSources = value.filter(
    (source): source is ZoteroSourceEntry => source.provider === "zotero",
  );
  const byGroupId = new Map<string, ConnectedGroup>(
    (groups.data ?? []).map((group) => [group.groupId, group]),
  );

  /** Connects each group; returns the ids that could not be connected. */
  async function addGroups(groupIds: string[]): Promise<string[]> {
    const failed: string[] = [];
    for (const groupId of groupIds) {
      try {
        await connectGroup({ libraryId, groupId });
        if (
          !latest.current.some(
            (entry) => entry.provider === "zotero" && entry.groupId === groupId,
          )
        ) {
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
      commit(
        latest.current.filter(
          (entry) => entry.provider !== "zotero" || entry.groupId !== groupId,
        ),
      );
    } catch {
      toast.error(t("removeFailed"));
    } finally {
      setBusyGroupId(null);
    }
  }

  function patchEntry(groupId: string, patch: Partial<ZoteroSourceEntry>) {
    commit(
      latest.current.map((entry) =>
        entry.provider === "zotero" && entry.groupId === groupId
          ? { ...entry, ...patch }
          : entry,
      ),
    );
  }

  return (
    <div className="@container/sources space-y-4" data-library-sources>
      {value.length === 0 ? (
        <EmptyList>
          No sources yet. Add a Zotero group or an OpenAlex search.
        </EmptyList>
      ) : (
        <ul
          aria-label="Connected sources"
          className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/50 bg-background"
        >
          {zoteroSources.map((entry) => (
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
          {openalex.sources.map((source) => (
            <OpenAlexSourceRow
              key={source.key}
              source={source}
              controller={openalex}
            />
          ))}
        </ul>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Connections"
          title="Connections"
          onClick={() => setConnectionsOpen(true)}
        >
          <Settings2 />
          <span className="hidden @min-[24rem]/sources:inline">
            Connections
          </span>
        </Button>
        <GroupPicker
          addedIds={zoteroSources.map((entry) => entry.groupId)}
          load={() => listMyGroups({ libraryId })}
          onAdd={addGroups}
          onOpenChange={(open) => {
            if (open) setAddMenuOpen(false);
          }}
        >
          <DropdownMenu open={addMenuOpen} onOpenChange={setAddMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button ref={addButton} type="button" variant="outline" size="sm">
                <Plus />
                Add source
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-64"
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              {connected ? (
                <DialogTrigger asChild>
                  <DropdownMenuItem
                    onSelect={(event) => event.preventDefault()}
                  >
                    <ZoteroIcon className="size-4 text-[#cc2936]" />
                    <span>
                      Zotero group
                      <span className="block text-xs text-muted-foreground">
                        Sync a shared reference library
                      </span>
                    </span>
                  </DropdownMenuItem>
                </DialogTrigger>
              ) : (
                <DropdownMenuItem
                  onSelect={() => {
                    setConnectionTab("zotero");
                    setConnectionsOpen(true);
                  }}
                >
                  <ZoteroIcon className="size-4 text-[#cc2936]" />
                  <span>
                    Zotero group
                    <span className="block text-xs text-muted-foreground">
                      Connect a Zotero account first
                    </span>
                  </span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => openalex.setEditing("new")}>
                <OpenAlexIcon className="size-4" />
                <span>
                  OpenAlex search
                  <span className="block text-xs text-muted-foreground">
                    Import research matching a search
                  </span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </GroupPicker>
      </div>

      <Dialog open={connectionsOpen} onOpenChange={setConnectionsOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Source connections</DialogTitle>
            <DialogDescription>
              Manage account access and import settings for this library.
            </DialogDescription>
          </DialogHeader>
          <Tabs
            value={connectionTab}
            onValueChange={setConnectionTab}
            className="gap-5"
          >
            <TabsList aria-label="Source provider">
              <TabsTrigger value="zotero">
                <ZoteroIcon className="size-4" />
                Zotero
              </TabsTrigger>
              <TabsTrigger value="openalex">
                <OpenAlexIcon className="size-4" />
                OpenAlex
              </TabsTrigger>
            </TabsList>
            <TabsContent value="zotero" className="space-y-5">
              <AccountPanel account={account.data} />
              <div className="space-y-3 border-t border-border/50 pt-5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-ml-2 h-7 px-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  aria-expanded={advancedOpen}
                  onClick={() => setAdvancedOpen((open) => !open)}
                >
                  {advancedOpen ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  {t("tagRulesHeading")}
                </Button>
                {advancedOpen ? (
                  <Panel tone="muted" className="space-y-4">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">
                        {t("tagRulesHeading")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("tagRulesIntro")}
                      </p>
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
                            onChange={(values) =>
                              onTagsChange({ ...tags, [key]: values })
                            }
                          />
                        );
                      })}
                    </div>
                  </Panel>
                ) : null}
              </div>
            </TabsContent>
            <TabsContent value="openalex">
              <OpenAlexAccessSettings source={openalex} />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
      {openalex.editing ? (
        <OpenAlexSearchDialog
          initial={
            typeof openalex.editing === "string" ? null : openalex.editing
          }
          onClose={() => {
            openalex.setEditing(null);
            addButton.current?.focus();
          }}
          onApprove={openalex.replaceSource}
        />
      ) : null}

      <AlertDialog
        open={removeId !== null}
        onOpenChange={(open) => !open && setRemoveId(null)}
      >
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
        <ZoteroIcon className="size-5" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">
          {account?.connected
            ? t("connectedAs", {
                handle: account.username ?? account.zoteroUserId,
              })
            : t("notConnected")}
        </p>
        <p className="text-xs text-muted-foreground">
          {connected ? t("accountHeading") : t("notConnectedHint")}
        </p>
      </div>
      <div className="shrink-0">
        {connected ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfirmOpen(true)}
          >
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
            <AlertDialogDescription>
              {t("disconnectBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("picker.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                void disconnect({}).catch(() =>
                  toast.error(t("disconnectFailed")),
                );
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
        {
          key: "records",
          label: t("recordsLabel"),
          value: group.itemCount.toLocaleString(),
        },
        ...(group.connectedByZoteroUsername
          ? [
              {
                key: "by",
                label: t("connectedBy"),
                value: group.connectedByZoteroUsername,
              },
            ]
          : []),
      ]
    : [];

  return (
    <SourceRow
      name={group?.name ?? entry.key}
      provider="Zotero group"
      icon={<ZoteroIcon className="size-4 text-[#cc2936]" />}
      status={{ label: t(`health.${health}`), tone: HEALTH_TONE[health] }}
      paused={paused}
      metadata={metaItems}
      data-group-id={entry.groupId}
      data-health={health}
      disabled={busy}
      onToggle={() => onPatch({ enabled: paused })}
      onRemove={onRemove}
      description={!canWrite && group ? t("writebackUnavailable") : undefined}
      controls={
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={entry.writebackEnabled}
                  disabled={!canWrite}
                  aria-label={t("writeback")}
                  onCheckedChange={(checked) =>
                    onPatch({ writebackEnabled: checked })
                  }
                />
                {t("writeback")}
              </label>
            </TooltipTrigger>
            <TooltipContent>
              {canWrite ? t("writebackHint") : t("writebackUnavailable")}
            </TooltipContent>
          </Tooltip>
          {!canWrite ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy || !canReconnect}
              onClick={onReconnect}
            >
              <RefreshCw className="size-3.5" />
              {t("reconnect")}
            </Button>
          ) : null}
        </div>
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Add groups                                                          */
/* ------------------------------------------------------------------ */

function GroupPicker({
  children,
  onOpenChange,
  addedIds,
  load,
  onAdd,
}: {
  children: ReactNode;
  onOpenChange: (open: boolean) => void;
  addedIds: string[];
  load: () => Promise<
    | { connected: false }
    | { connected: true; groups: PickerGroup[]; capped: boolean }
  >;
  onAdd: (groupIds: string[]) => Promise<string[]>;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  // Zotero has no group search, so the account's groups are read once per
  // open and then paged in the browser.
  const mine = useRef<ReturnType<typeof load> | null>(null);
  const [capped, setCapped] = useState(false);

  const readPage: PickerSource = async (input) => {
    mine.current ??= load();
    let answer: Awaited<ReturnType<typeof load>>;
    try {
      answer = await mine.current;
    } catch (error) {
      // A failed read must not be remembered, or "Try again" would replay it.
      mine.current = null;
      throw error;
    }
    if (!answer.connected)
      return { items: [], nextCursor: null, reason: "not-set-up" };
    setCapped(answer.capped);
    const rows = answer.groups.map((group) => ({
      id: group.id,
      title: group.name,
      count: group.itemCount,
      detail: (
        <MetaList
          className="text-muted-foreground"
          items={[
            {
              key: "vis",
              icon: group.isPublic ? Globe : Lock,
              value: group.isPublic ? t("public") : t("private"),
            },
            {
              key: "id",
              label: t("groupIdLabel"),
              value: <span className="font-mono">{group.id}</span>,
            },
          ]}
        />
      ),
    }));
    return localPickerSource(rows)(input);
  };

  return (
    <RemotePickerDialog
      mode="multi"
      trigger={children}
      controls={() => (
        <PasteLink
          disabled={false}
          existing={addedIds}
          onAdd={(groupId) => onAdd([groupId])}
        />
      )}
      title={t("picker.title")}
      description={t("picker.description")}
      searchLabel={t("picker.search")}
      columns={{ title: t("picker.colGroup"), count: t("picker.colItems") }}
      source={readPage}
      usedIds={addedIds}
      usedLabel={t("picker.added")}
      loadingLabel={t("picker.loading")}
      failedLabel={t("picker.failed")}
      emptyLabel={t("picker.noGroups")}
      noMatchLabel={t("picker.noMatch")}
      notSetUpLabel={t("connectFirst")}
      note={capped ? t("picker.capped") : null}
      onOpenChange={(open) => {
        onOpenChange(open);
        mine.current = null;
        if (!open) setCapped(false);
      }}
      confirmLabel={(count) => t("picker.addPicked", { count })}
      onConfirm={(rows) => onAdd(rows.map((row) => row.id))}
    />
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
        <span className="shrink-0 text-xs text-muted-foreground">
          {t("pasteLink")}
        </span>
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
