"use client";

import { useAction, useMutation } from "convex/react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { type ZoteroSourceEntry, zoteroSourceEntry } from "@/convex/zotero/sourceEntry";
import { getConvexSiteUrl } from "@/lib/convex-site";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import {
  DEFAULT_TAG_RULES,
  TAG_RULE_KEYS,
  type TagRuleKey,
  type TagRules,
  parseTagList,
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

type PickerGroup = { id: string; name: string; isPublic: boolean; itemCount: number; alreadyAdded: boolean };

type PickerState =
  | { status: "closed" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "not-connected" }
  | { status: "ready"; groups: PickerGroup[]; connecting: string | null };

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
 * Field body for the Sources section: the owner's Zotero account, the
 * connected groups with their switches, and the advanced tag rules.
 */
export function SourcesField({ libraryId, value, onChange, tags, onTagsChange }: SourcesFieldProps) {
  const t = useTranslations("evidenceLibrarySources");
  const account = useProtectedQuery(api.zotero.queries.getConnectionStatus, {});
  const groups = useProtectedQuery(api.zotero.libraryGroups.listLibraryZoteroGroups, { libraryId });
  const listMyGroups = useAction(api.zotero.libraryGroupActions.listMyZoteroGroups);
  const connectGroup = useAction(api.zotero.libraryGroupActions.connectZoteroGroup);
  const removeGroup = useMutation(api.zotero.libraryGroups.removeZoteroGroup);
  const startOAuth = useAction(api.zotero.actions.startOAuth);
  const [picker, setPicker] = useState<PickerState>({ status: "closed" });
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);

  const byGroupId = new Map<string, ConnectedGroup>(
    (groups.data ?? []).map((group) => [group.groupId, group]),
  );

  async function connectAccount() {
    const convexSite = getConvexSiteUrl();
    if (!convexSite) {
      toast.error(t("account.connectFailed"));
      return;
    }
    try {
      const result = await startOAuth({
        callbackUrl: `${convexSite}/api/zotero/callback`,
        returnTo: `${window.location.pathname}${window.location.search}`,
      });
      window.location.href = result.authorizeUrl;
    } catch {
      toast.error(t("account.connectFailed"));
    }
  }

  async function openPicker() {
    setPicker({ status: "loading" });
    try {
      const mine = await listMyGroups({ libraryId });
      setPicker(
        mine.connected
          ? { status: "ready", groups: mine.groups, connecting: null }
          : { status: "not-connected" },
      );
    } catch {
      setPicker({ status: "failed" });
    }
  }

  async function addGroup(group: PickerGroup) {
    setPicker((state) => (state.status === "ready" ? { ...state, connecting: group.id } : state));
    try {
      await connectGroup({ libraryId, groupId: group.id });
      if (!value.some((entry) => entry.groupId === group.id)) {
        onChange([...value, zoteroSourceEntry(group.id)]);
      }
      setPicker({ status: "closed" });
    } catch (error) {
      toast.error(t("connectFailed"), { description: errorMessage(error) });
      setPicker((state) => (state.status === "ready" ? { ...state, connecting: null } : state));
    }
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
      onChange(value.filter((entry) => entry.groupId !== groupId));
    } catch {
      toast.error(t("removeFailed"));
    } finally {
      setBusyGroupId(null);
    }
  }

  function patchEntry(groupId: string, patch: Partial<ZoteroSourceEntry>) {
    onChange(value.map((entry) => (entry.groupId === groupId ? { ...entry, ...patch } : entry)));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3" data-account-state={account.data?.connected ? "connected" : "not-connected"}>
        {account.data?.connected ? (
          <p className="text-sm text-muted-foreground">
            {t("account.connectedAs", { handle: account.data.username ?? account.data.zoteroUserId })}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("account.notConnected")}</p>
        )}
        {account.data?.connected ? (
          <Button type="button" variant="outline" size="sm" onClick={openPicker}>
            <Plus className="h-3.5 w-3.5" />
            {t("addGroup")}
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={connectAccount}>
            {t("account.connect")}
          </Button>
        )}
      </div>

      {value.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-3" aria-label={t("listLabel")}>
          {value.map((entry) => {
            const group = byGroupId.get(entry.groupId);
            const health = !entry.enabled ? "paused" : group?.scopes.write ? "ready" : "readOnly";
            const busy = busyGroupId === entry.groupId;
            return (
              <li
                key={entry.groupId}
                className="space-y-3 rounded-lg border border-border/50 p-4"
                data-group-id={entry.groupId}
                data-health={health}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium">{group?.name ?? entry.key}</p>
                    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <div className="inline-flex gap-1.5">
                        <dt className="text-muted-foreground">{t("health.label")}</dt>
                        <dd>{t(`health.${health}`)}</dd>
                      </div>
                      {group ? (
                        <>
                          <div className="inline-flex gap-1.5">
                            <dd>{group.isPublic ? t("public") : t("private")}</dd>
                          </div>
                          <div className="inline-flex gap-1.5">
                            <dt className="text-muted-foreground">{t("records")}</dt>
                            <dd>{group.itemCount.toLocaleString()}</dd>
                          </div>
                          {group.connectedByZoteroUsername ? (
                            <div className="inline-flex gap-1.5">
                              <dt className="text-muted-foreground">{t("connectedBy")}</dt>
                              <dd>{group.connectedByZoteroUsername}</dd>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </dl>
                    <p className="text-xs text-muted-foreground">{t("syncUnknown")}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy || !account.data?.connected}
                      onClick={() => reconnect(entry.groupId)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      {t("reconnect")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => remove(entry.groupId)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t("remove")}
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <SwitchRow
                    label={t("writeBack")}
                    hint={group && !group.scopes.write ? t("writeBackUnavailable") : t("writeBackHint")}
                    checked={entry.writebackEnabled}
                    disabled={!group?.scopes.write}
                    onCheckedChange={(checked) => patchEntry(entry.groupId, { writebackEnabled: checked })}
                  />
                  <SwitchRow
                    label={t("pause")}
                    hint={t("pauseHint")}
                    checked={!entry.enabled}
                    onCheckedChange={(checked) => patchEntry(entry.groupId, { enabled: !checked })}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <TagRulesEditor tags={tags} onChange={onTagsChange} />

      <Dialog open={picker.status !== "closed"} onOpenChange={(open) => !open && setPicker({ status: "closed" })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("pickerTitle")}</DialogTitle>
            <DialogDescription>{t("pickerDescription")}</DialogDescription>
          </DialogHeader>
          {picker.status === "loading" ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Spinner className="h-4 w-4" />
              {t("pickerLoading")}
            </p>
          ) : picker.status === "failed" ? (
            <p className="text-sm text-destructive" role="alert">{t("pickerFailed")}</p>
          ) : picker.status === "not-connected" ? (
            <p className="text-sm text-muted-foreground">{t("account.notConnected")}</p>
          ) : picker.status === "ready" ? (
            <GroupPickerList picker={picker} onPick={addGroup} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GroupPickerList({
  picker,
  onPick,
}: {
  picker: Extract<PickerState, { status: "ready" }>;
  onPick: (group: PickerGroup) => void;
}) {
  const t = useTranslations("evidenceLibrarySources");
  const available = picker.groups.filter((group) => !group.alreadyAdded);
  if (available.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {picker.groups.length === 0 ? t("pickerNoGroups") : t("pickerAllAdded")}
      </p>
    );
  }
  return (
    <ul className="max-h-80 space-y-2 overflow-y-auto" aria-label={t("pickerTitle")}>
      {available.map((group) => (
        <li key={group.id}>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2 text-left text-sm hover:bg-muted/30 disabled:opacity-60"
            disabled={picker.connecting !== null}
            onClick={() => onPick(group)}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{group.name}</span>
              <span className="block text-xs text-muted-foreground">
                {group.isPublic ? t("public") : t("private")} · {t("recordsCount", { count: group.itemCount })}
              </span>
            </span>
            {picker.connecting === group.id ? <Spinner className="h-4 w-4" /> : <Badge variant="outline">{t("add")}</Badge>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg bg-muted/30 p-3">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm">{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  );
}

// Controlled: the text follows `tags`, so a draft reset updates the inputs.
// Text that is not yet a clean list ("a, ") is kept per field while typing.
function TagRulesEditor({ tags, onChange }: { tags: TagRules; onChange: (tags: TagRules) => void }) {
  const t = useTranslations("evidenceLibrarySources.tagRules");
  const id = useId();
  const [typing, setTyping] = useState<Partial<Record<TagRuleKey, { text: string; tags: string[] }>>>({});
  return (
    <details className="rounded-lg border border-border/50 p-4">
      <summary className="cursor-pointer text-sm font-medium">{t("title")}</summary>
      <p className="mt-1 text-xs text-muted-foreground">{t("hint")}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {TAG_RULE_KEYS.map((key) => {
          const current = tags[key] ?? DEFAULT_TAG_RULES[key];
          const issue = tagRuleIssue(key, current);
          const inputId = `${id}-${key}`;
          const draft = typing[key];
          const text =
            draft && draft.tags.join("\u0000") === current.join("\u0000")
              ? draft.text
              : current.join(", ");
          return (
            <div key={key} className="space-y-1">
              <Label htmlFor={inputId} className="text-xs">{t(key)}</Label>
              <Input
                id={inputId}
                className="bg-background"
                value={text}
                aria-invalid={issue ? true : undefined}
                aria-describedby={issue ? `${inputId}-issue` : undefined}
                onChange={(event) => {
                  const next = parseTagList(event.target.value);
                  setTyping({ ...typing, [key]: { text: event.target.value, tags: next } });
                  onChange({ ...tags, [key]: next });
                }}
              />
              {issue ? (
                <p id={`${inputId}-issue`} className="text-xs text-destructive">{t(issue)}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </details>
  );
}

function errorMessage(error: unknown): string | undefined {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { message?: string } }).data;
    if (data?.message) return data.message;
  }
  return error instanceof Error ? error.message : undefined;
}
