"use client";

import { ChevronDown, ChevronRight, Database, RefreshCw, Trash2 } from "lucide-react";
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
  const connected = source.auth === "zotero" && source.apiKey === ZOTERO_OAUTH;
  const groupIdMissing = !source.groupId.trim();
  const keyMissing = source.auth === "apiKey" && !source.apiKey.trim();

  return (
    <div
      className="space-y-3 rounded-lg border border-border/50 bg-background p-3"
      data-source-id={source.id}
      data-sync-state={thisSyncing ? "syncing" : source.enabled ? "on" : "off"}
    >
      <div className="flex items-center gap-2">
        <Input
          aria-label={t("labelLabel")}
          className="bg-background"
          value={source.label}
          placeholder={t("labelPlaceholder")}
          onChange={(e) =>
            onChange((row) => {
              row.label = e.target.value;
            })
          }
        />
        {thisSyncing ? (
          <StatusChip tone="running">{t("statusSyncing")}</StatusChip>
        ) : (
          <StatusChip tone={source.enabled ? "success" : "neutral"}>
            {source.enabled ? t("statusOn") : t("statusOff")}
          </StatusChip>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={t("removeSource")}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t("authLabel")}</Label>
            <RadioGroup
              value={source.auth}
              onValueChange={(auth) =>
                onChange((row) => {
                  row.auth = auth as ZoteroSource["auth"];
                  row.apiKey = "";
                })
              }
              className="gap-2"
            >
              <Label className="flex items-center gap-2 font-normal">
                <RadioGroupItem value="zotero" />
                {t("authZotero")}
              </Label>
              <Label className="flex items-center gap-2 font-normal">
                <RadioGroupItem value="apiKey" />
                {t("authApiKey")}
              </Label>
            </RadioGroup>
          </div>
          {source.auth === "zotero" ? (
            connected ? (
              <InlineNotice tone="info" data-zotero-connected>
                {t("connectedAs", { handle: "@aiined" })}
              </InlineNotice>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onChange((row) => {
                    row.apiKey = ZOTERO_OAUTH;
                  })
                }
              >
                {t("connectZotero")}
              </Button>
            )
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
                  onChange={(e) =>
                    onChange((row) => {
                      row.apiKey = e.target.value;
                    })
                  }
                />
              )}
            </Field>
          )}
        </div>

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

      <div className="grid gap-2 sm:grid-cols-2">
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
          hint={t("writebackHint")}
          checked={source.writeback}
          onChange={(writeback) =>
            onChange((row) => {
              row.writeback = writeback;
            })
          }
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-xs text-muted-foreground" data-last-sync={source.lastSync ?? "never"}>
            {source.lastSync
              ? t("lastSync", { when: source.lastSync, records: source.records })
              : t("neverSynced")}
          </p>
          {thisSyncing ? <Progress value={run.percent} className="max-w-xs" /> : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={anySyncing}
          onClick={() => syncSource(libraryId, source.id)}
        >
          {thisSyncing ? <Spinner /> : <RefreshCw />}
          {thisSyncing ? t("syncingPercent", { percent: run.percent }) : t("syncNow")}
        </Button>
      </div>
    </div>
  );
}
