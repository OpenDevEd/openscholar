"use client";

import { ZoteroIcon } from "@/components/icons/zotero-icon";
import { useAction, useMutation } from "convex/react";
import {
  ChevronDown,
  Globe,
  Lock,
  Plus,
  RefreshCw,
  Settings2,
  AddedPapersIcon,
} from "@/components/icons";
import { useTranslations, useLocale } from "next-intl";
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
import {
  Tooltip,
  TooltipContent,
  TooltipHint,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  type ZoteroSourceEntry,
  zoteroSourceEntry,
} from "@/convex/zotero/sourceEntry";
import { useWorkspace } from "@/lib/workspaces/url";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useZoteroSignIn } from "@/lib/hooks/use-zotero-sign-in";
import type {
  EvidenceSourceEntry,
  OpenScholarCollectionSourceEntry,
} from "@/lib/evidence-libraries/configuration/sources";
import { ChipInput, EmptyList, MetaList, Panel } from "../fields";
import { FieldError } from "../section-card";
import { AddedPapersRow, useAddedPapersCommunity } from "./added-papers-row";
import { useReadOnly } from "../read-only";
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
import { errorMessage, SourceRow, SourceSwitch } from "./source-row";
import { SourceScreeningProvider, sourceScreening } from "./source-screening";
import { sourcePdfs } from "./source-pdfs";
import {
  CollectionSourceIcon,
  CollectionSourceRow,
  useCollectionSources,
} from "./collection-sources";
import { type SourceLive, useSourceActivity } from "./source-activity";
import { type StatusTone } from "../status-chip";
import {
  localPickerSource,
  type PickerSource,
  RemotePickerDialog,
} from "./remote-picker-dialog";
import { Disclosure } from "../disclosure-button";
import {
  DEFAULT_TAG_RULES,
  blockedPublishTags,
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

// Displayed in the mock's order, not the schema's. Publish tags belong to each Zotero group, under its PDFs switch.
const TAG_RULE_ORDER = [
  "hidden",
  "internal",
  "comingSoon",
  "description",
  "redirects",
] as const satisfies readonly TagRuleKey[];

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
  /** AI answers are on and an OpenRouter key is saved, which screening reads with. */
  aiReady: boolean;
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
  aiReady,
}: SourcesFieldProps) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  const tp = useTranslations("addedPapers");
  const account = useProtectedQuery(api.zotero.queries.getConnectionStatus, {});
  const groups = useProtectedQuery(
    api.zotero.libraryGroups.listZoteroGroups,
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
  const zoteroSignIn = useZoteroSignIn();
  // A Zotero sign-in that started in this dialog and didn't finish comes back to it open, with the reason.
  const [connectionsOpen, setConnectionsOpen] = useState(zoteroSignIn.failed);
  const [connectionTab, setConnectionTab] = useState("zotero");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addingPapers, setAddingPapers] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  // A running community always lists its added papers, so its list is never empty. Read-only, its team adds them
  // from their own card outside the settings (AddedPapersCard).
  const readOnly = useReadOnly();
  const running = useAddedPapersCommunity(libraryId) !== null && !readOnly;
  const openalex = useOpenAlexSources({ libraryId, value, onChange });
  const liveFor = useSourceActivity(libraryId);
  const workspaceId = useWorkspace();
  const [removeTarget, setRemoveTarget] = useState<
    | { kind: "zotero"; groupId: string }
    | { kind: "collection"; entry: OpenScholarCollectionSourceEntry }
    | null
  >(null);
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);
  // Convex calls finish after other rows may have changed; edits always start
  // from the newest draft, not the one captured when the call began.
  const latest = useRef(value);
  latest.current = value;
  function commit(next: EvidenceSourceEntry[]) {
    latest.current = next;
    onChange(next);
  }
  const collections = useCollectionSources({
    libraryId,
    value,
    latest,
    commit,
    apiKeyMode: openalex.mode === "custom" && openalex.customCredential ? "custom" : "platform",
  });

  const connected = account.data?.connected === true;
  const zoteroSources = value.filter(
    (source): source is ZoteroSourceEntry => source.provider === "zotero",
  );
  const byGroupId = new Map<string, ConnectedGroup>(
    (groups.data?.page ?? []).map((group) => [group.groupId, group]),
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

  // Width checks in the list answer to the settings box, 2rem + 4px wider than it: the card's padding and border.
  return (
    <SourceScreeningProvider value={{ libraryId, workspaceId, aiReady }}>
      <div className="space-y-4" data-library-sources>
        {value.length === 0 && !running ? (
          <EmptyList>{t("noSources")}</EmptyList>
        ) : (
          <ul
            aria-label={t("listLabel")}
            className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-background"
          >
            {zoteroSources.map((entry) => (
              <GroupRow
                key={entry.groupId}
                entry={entry}
                group={byGroupId.get(entry.groupId)}
                busy={busyGroupId === entry.groupId}
                canReconnect={connected}
                blockedPublishTags={blockedPublishTags(tags)}
                live={liveFor(entry.key, !entry.enabled, "Zotero")}
                onPatch={(patch) => patchEntry(entry.groupId, patch)}
                onReconnect={() => reconnect(entry.groupId)}
                onRemove={() => setRemoveTarget({ kind: "zotero", groupId: entry.groupId })}
              />
            ))}
            {openalex.sources.map((source) => (
              <OpenAlexSourceRow
                key={source.key}
                source={source}
                live={liveFor(source.key, !source.enabled, "OpenAlex")}
                controller={openalex}
              />
            ))}
            {collections.sources.map((entry) => (
              <CollectionSourceRow
                key={entry.key}
                entry={entry}
                controller={collections}
                live={liveFor(entry.key, !entry.enabled, "Openscholar")}
                onRemove={() => setRemoveTarget({ kind: "collection", entry })}
              />
            ))}
            {running ? <AddedPapersRow libraryId={libraryId} adding={addingPapers} onAddingChange={setAddingPapers} /> : null}
          </ul>
        )}

        <div className="flex items-center justify-end gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t("connections")}
                onClick={() => setConnectionsOpen(true)}
              >
                <Settings2 />
                <span className="hidden @min-[calc(24rem+2rem+4px)]/settings:inline">
                  {t("connections")}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("connections")}</TooltipContent>
          </Tooltip>
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
                  {t("addSource")}
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
                        {t("zoteroGroup")}
                        <span className="block text-xs text-muted-foreground">
                          {t("zoteroGroupHint")}
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
                      {t("zoteroGroup")}
                      <span className="block text-xs text-muted-foreground">
                        {t("zoteroConnectFirst")}
                      </span>
                    </span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => openalex.setEditing("new")}>
                  <OpenAlexIcon className="size-4" />
                  <span>
                    {t("openAlexSearch")}
                    <span className="block text-xs text-muted-foreground">
                      {t("openAlexSearchHint")}
                    </span>
                  </span>
                </DropdownMenuItem>
                {running ? (
                  <DropdownMenuItem onSelect={() => setAddingPapers(true)}>
                    <AddedPapersIcon className="size-4 text-primary" />
                    <span>
                      {tp("menu")}
                      <span className="block text-xs text-muted-foreground">{tp("menuHint")}</span>
                    </span>
                  </DropdownMenuItem>
                ) : (
                  // Papers are kept by the running community, so a draft has nowhere to put them yet. A disabled item
                  // fires no pointer events: the span takes the hover.
                  <TooltipHint label={tp("menuNotLive")}>
                    <span className="block">
                      <DropdownMenuItem disabled>
                        <AddedPapersIcon className="size-4 text-primary" />
                        <span>
                          {tp("menu")}
                          <span className="block text-xs text-muted-foreground">{tp("menuHint")}</span>
                        </span>
                      </DropdownMenuItem>
                    </span>
                  </TooltipHint>
                )}
                <DropdownMenuItem onSelect={() => collections.open()}>
                  <CollectionSourceIcon />
                  <span>
                    {t("openScholarCollection")}
                    <span className="block text-xs text-muted-foreground">
                      {t("openScholarCollectionHint")}
                    </span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </GroupPicker>
        </div>

        <Dialog
          open={connectionsOpen}
          onOpenChange={(open) => {
            setConnectionsOpen(open);
            if (!open && zoteroSignIn.failed) zoteroSignIn.dismiss();
          }}
        >
          <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{t("connectionsTitle")}</DialogTitle>
              <DialogDescription>{t("connectionsDescription")}</DialogDescription>
            </DialogHeader>
            <Tabs
              value={connectionTab}
              onValueChange={setConnectionTab}
              className="gap-5"
            >
              <TabsList aria-label={t("providerTabs")}>
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
                <AccountPanel account={account.data} signIn={zoteroSignIn} />
                <Disclosure
                  open={advancedOpen}
                  onOpenChange={setAdvancedOpen}
                  label={t("tagRulesHeading")}
                  className="border-t border-border-subtle pt-5"
                >
                  <div className="pt-3">
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
                  </div>
                </Disclosure>
              </TabsContent>
              <TabsContent value="openalex">
                <OpenAlexAccessSettings source={openalex} />
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
        {openalex.editing ? (
          <OpenAlexSearchDialog
            searchId={openalex.searchId}
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

        {collections.picker}

        <AlertDialog
          open={removeTarget !== null}
          onOpenChange={(open) => !open && setRemoveTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {removeTarget?.kind === "collection" ? t("removeCollectionTitle") : t("removeTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>{t("removeBody")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("picker.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const target = removeTarget;
                  setRemoveTarget(null);
                  if (target?.kind === "zotero") void remove(target.groupId);
                  if (target?.kind === "collection") collections.remove(target.entry);
                }}
              >
                {t("removeConfirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </SourceScreeningProvider>
  );
}

/* ------------------------------------------------------------------ */
/* Account                                                             */
/* ------------------------------------------------------------------ */

function AccountPanel({
  account,
  signIn,
}: {
  account:
    | { connected: true; zoteroUserId: string; username?: string }
    | { connected: false }
    | undefined;
  signIn: ReturnType<typeof useZoteroSignIn>;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  const tc = useTranslations("common");
  const disconnect = useMutation(api.zotero.mutations.disconnect);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const connected = account?.connected === true;

  async function connect() {
    try {
      await signIn.start();
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
        {!connected && signIn.failed ? (
          <p className="text-xs text-destructive">{tc("zoteroSignInFailed")}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {connected ? t("accountHeading") : t("notConnectedHint")}
          </p>
        )}
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
  blockedPublishTags,
  live,
  onPatch,
  onReconnect,
  onRemove,
}: {
  entry: ZoteroSourceEntry;
  group: ConnectedGroup | undefined;
  busy: boolean;
  canReconnect: boolean;
  blockedPublishTags: string[];
  live: SourceLive | null;
  onPatch: (patch: Partial<ZoteroSourceEntry>) => void;
  onReconnect: () => void;
  onRemove: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  const pdfs = sourcePdfs({
    downloadPdfs: entry.settings.downloadPdfs,
    onDownloadPdfsChange: (downloadPdfs) => onPatch({ settings: { ...entry.settings, downloadPdfs } }),
    publishing: entry.settings.pdfPublishing,
    blockedTags: blockedPublishTags,
    onPublishingChange: (pdfPublishing) => onPatch({ settings: { ...entry.settings, pdfPublishing } }),
  });
  const paused = !entry.enabled;
  const health: GroupHealth = paused ? "paused" : "connected";
  const canWrite = group?.scopes.write === true;
  const screening = sourceScreening({
    sourceKey: entry.key,
    screening: entry.screening,
    onChange: (next) => onPatch({ screening: next }),
    report: live?.screening ?? null,
  });
  const metaItems = group
    ? [
        {
          key: "visibility",
          icon: group.isPublic ? Globe : Lock,
          value: group.isPublic ? t("public") : t("private"),
        },
        {
          key: "records",
          label: t("zoteroItemsLabel"),
          value: group.itemCount.toLocaleString(locale),
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
      provider={t("zoteroGroup")}
      icon={<ZoteroIcon className="size-4 text-[#cc2936]" />}
      status={live?.status ?? { label: t(`health.${health}`), tone: HEALTH_TONE[health] }}
      activity={live?.activity}
      paused={paused}
      metadata={metaItems}
      data-group-id={entry.groupId}
      data-health={health}
      disabled={busy}
      onToggle={() => onPatch({ enabled: paused })}
      onRemove={onRemove}
      description={!canWrite && group ? t("writebackUnavailable") : undefined}
      details={<>{screening.band}{pdfs.band}</>}
      controls={
        <>
          {screening.control}
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
          <SourceSwitch
            label={t("writeback")}
            checked={entry.writebackEnabled}
            disabledReason={canWrite ? undefined : t("writebackUnavailable")}
            onCheckedChange={(writebackEnabled) => onPatch({ writebackEnabled })}
          />
          {pdfs.control}
        </>
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

