"use client";

import { Check, ChevronDown, ChevronRight, Database, KeyRound, RefreshCw, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import {
  newId,
  TAG_RULE_KEYS,
  type TagRuleKey,
  type ZoteroSource,
} from "@/lib/evidence-libraries/mock/config";
import { useEvidenceLibraryMockStore } from "@/lib/evidence-libraries/mock/store";
import { StatusChip } from "../library-status-badge";
import { Field, InlineNotice } from "../section-card";
import { AddButton, ChipInput, EmptyList, SubHeading, ToggleRow } from "./fields";
import { cn } from "@/lib/utils";
import { SectionShell, type SectionProps } from "./section-shell";

/** Stored in `apiKey` when the owner signed in with Zotero instead of pasting a key. */
const ZOTERO_OAUTH = "zotero-oauth";

const TAG_RULE_COPY: Record<TagRuleKey, { label: string; hint: string }> = {
  hidden: { label: "hiddenLabel", hint: "hiddenHint" },
  internal: { label: "internalLabel", hint: "internalHint" },
  comingSoon: { label: "comingSoonLabel", hint: "comingSoonHint" },
  description: { label: "descriptionLabel", hint: "descriptionHint" },
  redirects: { label: "redirectsLabel", hint: "redirectsHint" },
  publish: { label: "publishLabel", hint: "publishHint" },
};

export function SourcesSection({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.sources");
  const sources = library.draft.sources;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);

  function updateSource(id: string, update: (row: ZoteroSource) => void) {
    patch((d) => {
      const row = d.sources.zotero.find((s) => s.id === id);
      if (row) update(row);
      return d;
    });
  }

  return (
    <SectionShell sectionKey="sources" icon={Database} description={t("description")} library={library}>
      <div className="space-y-3">
        <SubHeading
          action={
            <AddButton
              onClick={() =>
                patch((d) => {
                  d.sources.zotero.push({
                    id: newId("src"),
                    label: "",
                    auth: "zotero",
                    groupId: "",
                    apiKey: "",
                    enabled: true,
                    writeback: false,
                    lastSync: null,
                    records: 0,
                  });
                  return d;
                })
              }
            >
              {t("addGroup")}
            </AddButton>
          }
        >
          {t("groupsHeading")}
        </SubHeading>
        {sources.zotero.length === 0 ? (
          <EmptyList>{t("noGroups")}</EmptyList>
        ) : (
          <div className="space-y-3">
            {sources.zotero.map((source) => (
              <SourceCard
                key={source.id}
                libraryId={library.id}
                source={source}
                onChange={(update) => updateSource(source.id, update)}
                onRemove={() => setRemoveId(source.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
          aria-expanded={advancedOpen}
          aria-controls={`${library.id}-sources-advanced`}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {advancedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {t("advanced")}
        </Button>
        {advancedOpen ? (
          <div
            id={`${library.id}-sources-advanced`}
            className="space-y-4 rounded-lg border border-border/50 bg-muted/30 p-3"
          >
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
          </div>
        ) : null}
      </div>

      <AlertDialog open={removeId !== null} onOpenChange={(open) => !open && setRemoveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("removeBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("removeCancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = removeId;
                setRemoveId(null);
                if (!id) return;
                patch((d) => {
                  d.sources.zotero = d.sources.zotero.filter((s) => s.id !== id);
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

function SourceCard({
  libraryId,
  source,
  onChange,
  onRemove,
}: {
  libraryId: string;
  source: ZoteroSource;
  onChange: (update: (row: ZoteroSource) => void) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("evidenceLibraryMock.config.sources");
  const syncSource = useEvidenceLibraryMockStore((s) => s.syncSource);
  const run = useEvidenceLibraryMockStore((s) => s.syncing[libraryId]);
  const thisSyncing = run?.sourceId === source.id;
  const anySyncing = run !== undefined;
  const connected =
    source.auth === "zotero" ? source.apiKey === ZOTERO_OAUTH : source.apiKey.trim().length > 0;
  const groupIdMissing = !source.groupId.trim();
  const keyMissing = source.auth === "apiKey" && !source.apiKey.trim();
  const ready = connected && !groupIdMissing;

  return (
    <div
      className="overflow-hidden rounded-xl border border-border/50 bg-background"
      data-source-id={source.id}
      data-sync-state={thisSyncing ? "syncing" : source.enabled ? "on" : "off"}
    >
      {/* Header: name, state, sync, remove */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border/50 bg-muted/30 px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[#cc2936] text-xs font-bold text-white">
          Z
        </span>
        <Input
          aria-label={t("labelLabel")}
          className="h-8 max-w-xs bg-background text-sm font-medium"
          value={source.label}
          placeholder={t("labelPlaceholder")}
          onChange={(e) =>
            onChange((row) => {
              row.label = e.target.value;
            })
          }
        />
        {thisSyncing ? (
          <StatusChip tone="running">
            <Spinner />
            {t("statusSyncing")}
          </StatusChip>
        ) : !ready ? (
          <StatusChip tone="warning">{t("statusIncomplete")}</StatusChip>
        ) : (
          <StatusChip tone={source.enabled ? "success" : "neutral"}>
            {source.enabled ? t("statusOn") : t("statusOff")}
          </StatusChip>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground" data-last-sync={source.lastSync ?? "never"}>
            {source.lastSync
              ? t("lastSync", { when: source.lastSync, records: source.records })
              : t("neverSynced")}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={anySyncing || !ready}
            onClick={() => syncSource(libraryId, source.id)}
          >
            {thisSyncing ? <Spinner /> : <RefreshCw />}
            {thisSyncing ? t("syncingPercent", { percent: run.percent }) : t("syncNow")}
          </Button>
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
        </div>
        {thisSyncing ? <Progress value={run.percent} className="basis-full" /> : null}
      </div>

      {/* Body: three numbered steps */}
      <div className="divide-y divide-border/50">
        <Step number={1} title={t("stepConnect")} done={connected}>
          <RadioGroup
            value={source.auth}
            onValueChange={(auth) =>
              onChange((row) => {
                row.auth = auth as ZoteroSource["auth"];
                row.apiKey = "";
              })
            }
            className="grid gap-2 sm:grid-cols-2"
          >
            <AuthOption
              value="zotero"
              selected={source.auth === "zotero"}
              title={t("authZotero")}
              hint={t("authZoteroHint")}
            >
              {source.apiKey === ZOTERO_OAUTH ? (
                <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400" data-zotero-connected>
                  <Check className="h-3.5 w-3.5" />
                  {t("connectedAs", { handle: "@aiined" })}
                </p>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={source.auth !== "zotero"}
                  onClick={() =>
                    onChange((row) => {
                      row.apiKey = ZOTERO_OAUTH;
                    })
                  }
                >
                  {t("connectZotero")}
                </Button>
              )}
            </AuthOption>
            <AuthOption
              value="apiKey"
              selected={source.auth === "apiKey"}
              title={t("authApiKey")}
              hint={t("apiKeyHint")}
            >
              <Field label={t("apiKeyLabel")} error={keyMissing ? t("apiKeyError") : null} className="space-y-1">
                {(id, invalid) => (
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id={id}
                      type="password"
                      autoComplete="off"
                      disabled={source.auth !== "apiKey"}
                      className="bg-background pl-8 font-mono text-sm"
                      value={source.auth === "apiKey" ? source.apiKey : ""}
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
            </AuthOption>
          </RadioGroup>
        </Step>

        <Step number={2} title={t("stepGroup")} done={!groupIdMissing}>
          <Field label={t("groupIdLabel")} hint={t("groupIdHint")} error={groupIdMissing ? t("groupIdError") : null} className="max-w-sm">
            {(id, invalid) => (
              <div className="flex items-center gap-2">
                <span className="shrink-0 font-mono text-xs text-muted-foreground">zotero.org/groups/</span>
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
              </div>
            )}
          </Field>
        </Step>

        <Step number={3} title={t("stepOptions")}>
          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow
              label={t("enabledLabel")}
              hint={t("enabledHint")}
              checked={source.enabled}
              onChange={(enabled) =>
                onChange((row) => {
                  row.enabled = enabled;
                })
              }
            />
            <ToggleRow
              label={t("writebackLabel")}
              hint={t("writebackHint")}
              checked={source.writeback}
              onChange={(writeback) =>
                onChange((row) => {
                  row.writeback = writeback;
                })
              }
            />
          </div>
        </Step>
      </div>
    </div>
  );
}

function Step({
  number,
  title,
  done,
  children,
}: {
  number: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 p-4 sm:grid-cols-[10rem_1fr]" data-step-done={done}>
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
            done
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "border-border/60 bg-muted/40 text-muted-foreground",
          )}
        >
          {done ? <Check className="h-3.5 w-3.5" /> : number}
        </span>
        <span className="pt-0.5 text-sm font-medium">{title}</span>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function AuthOption({
  value,
  selected,
  title,
  hint,
  children,
}: {
  value: string;
  selected: boolean;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border-2 p-3 transition-all",
        selected ? "border-primary/40 bg-primary/5" : "border-border/50 bg-muted/20 text-muted-foreground",
      )}
      data-selected={selected}
    >
      <Label className="flex cursor-pointer items-start gap-2.5 font-normal">
        <RadioGroupItem value={value} className="mt-0.5" />
        <span className="space-y-0.5">
          <span className={cn("block text-sm font-medium", selected ? "text-foreground" : "")}>{title}</span>
          <span className="block text-xs text-muted-foreground">{hint}</span>
        </span>
      </Label>
      <div className="pl-6">{children}</div>
    </div>
  );
}
