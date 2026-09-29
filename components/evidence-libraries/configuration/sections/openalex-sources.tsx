"use client";

import dynamic from "next/dynamic";
import { Building2, KeyRound } from "lucide-react";
import { useAction, useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { OpenAlexIcon } from "@/components/icons/openalex-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  OPENALEX_API_CREDENTIAL_KEY,
  OPENALEX_API_KEY_INSTANCE,
  OPENALEX_API_KEY_PATH,
  readsOpenAlexWorks,
  withOpenAlexKeyMode,
  type EvidenceSourceEntry,
  type OpenAlexSourceEntry,
} from "@/lib/evidence-libraries/configuration/sources";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useSearchHistoryStore } from "@/lib/store";
import { paramsToSearchResult } from "@/lib/search-params";
import { readOpenAlexSourceSearch, sourceSearchHistoryId } from "@/lib/evidence-libraries/openalex-source-query";
import { Field } from "../section-card";
import { OpenAlexQuerySummary } from "./openalex-query-summary";
import { SourceCount, SourceRow, SourceSwitch } from "./source-row";
import { useOpenAlexQueryCounts } from "@/lib/hooks/use-history-count";
import type { SourceLive } from "./source-activity";

export const OpenAlexSearchDialog = dynamic(
  () =>
    import("./openalex-search-dialog").then(
      (module) => module.OpenAlexSearchDialog,
    ),
  { ssr: false },
);

export function useOpenAlexSources({
  libraryId,
  value,
  onChange,
}: {
  libraryId: Id<"evidenceLibraries">;
  value: EvidenceSourceEntry[];
  onChange: (value: EvidenceSourceEntry[]) => void;
}) {
  const [editingKey, setEditingKey] = useState<"new" | string | null>(null);
  const [editorSession, setEditorSession] = useState<{ id: string; created: boolean } | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [selectedMode, setSelectedMode] = useState<
    "openscholar" | "custom" | null
  >(null);
  const credentials = useProtectedQuery(
    api.evidenceLibraries.credentials.listCredentialMetadata,
    { libraryId },
  );
  const writeCredential = useAction(
    api.evidenceLibraries.credentialActions.writeCredential,
  );
  const removeCredential = useMutation(
    api.evidenceLibraries.openAlexSourceKey.removeOpenAlexKey,
  );
  const sources = value.filter(
    (source): source is OpenAlexSourceEntry => source.provider === "openalex",
  );
  // How many works each approved query finds now: what the library imports.
  const counts = useOpenAlexQueryCounts(sources.map((source) => source.settings.approvedQuery.query));
  const customCredential = (credentials.data ?? []).find(
    (credential) => credential.credentialKey === OPENALEX_API_CREDENTIAL_KEY,
  );
  // Collections read OpenAlex with the same key as searches.
  const inferredMode = value.filter(readsOpenAlexWorks).some(
    (source) => source.settings.apiKeyMode === "custom",
  )
    ? "custom"
    : "openscholar";
  const mode = selectedMode ?? inferredMode;
  const editing =
    editingKey === "new"
      ? "new"
      : (sources.find((source) => source.key === editingKey) ?? null);

  function setEditing(source: "new" | OpenAlexSourceEntry | null) {
    const history = useSearchHistoryStore.getState();
    if (source === null) {
      if (editorSession?.created) {
        const index = history.searchHistory.findIndex((entry) => entry.id === editorSession.id);
        if (index >= 0) history.removeSearchResult(index);
      }
      setEditingKey(null);
      setEditorSession(null);
      return;
    }
    const initial = source === "new" ? null : source;
    const savedId = sourceSearchHistoryId(initial);
    const existing = savedId && history.searchHistory.some((entry) => entry.id === savedId);
    const id = existing ? savedId : history.addSearchResult(paramsToSearchResult(readOpenAlexSourceSearch(initial)));
    setEditorSession({ id, created: !existing });
    setEditingKey(initial?.key ?? "new");
  }

  function replaceSource(source: OpenAlexSourceEntry) {
    const nextSource: OpenAlexSourceEntry =
      editingKey === "new"
        ? {
            ...source,
            settings: {
              ...source.settings,
              // Looking at "Own API key" without saving one is not a choice.
              apiKeyMode: mode === "custom" && customCredential ? "custom" : "platform",
            },
          }
        : source;
    onChange(
      value.some((entry) => entry.key === nextSource.key)
        ? value.map((entry) =>
            entry.key === nextSource.key ? nextSource : entry,
          )
        : [...value, nextSource],
    );
    setEditingKey(null);
    setEditorSession(null);
  }

  async function saveCustomCredential() {
    const key = apiKey.trim();
    if (!key) return;
    await writeCredential({
      libraryId,
      concretePath: OPENALEX_API_KEY_PATH,
      instanceKey: OPENALEX_API_KEY_INSTANCE,
      value: key,
    });
    setApiKey("");
    changeMode("custom");
  }

  function changeMode(mode: "openscholar" | "custom") {
    setSelectedMode(mode);
    onChange(
      value.map((entry) =>
        readsOpenAlexWorks(entry)
          ? withOpenAlexKeyMode(entry, mode === "custom" ? "custom" : "platform")
          : entry,
      ),
    );
  }

  function selectMode(mode: "openscholar" | "custom") {
    setSelectedMode(mode);
    if (mode === "openscholar") setApiKey("");
    if (mode === "openscholar" || customCredential) changeMode(mode);
  }

  async function removeCustomCredential() {
    await removeCredential({ libraryId });
    changeMode("openscholar");
    setApiKey("");
  }

  return {
    sources,
    countFor: (key: string) => counts[sources.findIndex((source) => source.key === key)] ?? undefined,
    editing,
    searchId: editorSession?.id ?? "",
    setEditing,
    replaceSource,
    patch: (key: string, change: Partial<OpenAlexSourceEntry>) =>
      onChange(
        value.map((source) =>
          source.key === key
            ? ({ ...source, ...change } as EvidenceSourceEntry)
            : source,
        ),
      ),
    remove: (key: string) =>
      onChange(value.filter((source) => source.key !== key)),
    mode,
    selectMode,
    customCredential,
    apiKey,
    setApiKey,
    saveCustomCredential,
    removeCustomCredential,
  };
}

export function OpenAlexSourceRow({
  source,
  controller,
  live,
}: {
  source: OpenAlexSourceEntry;
  controller: ReturnType<typeof useOpenAlexSources>;
  live: SourceLive | null;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  return (
    <SourceRow
      name={source.settings.name}
      provider={t("openAlexSearch")}
      icon={<OpenAlexIcon className="size-4" />}
      status={
        live?.status ??
        (source.enabled
          ? { label: t("approved"), tone: "success" }
          : { label: t("health.paused"), tone: "neutral" })
      }
      activity={live?.activity}
      paused={!source.enabled}
      description={
        <OpenAlexQuerySummary source={source} />
      }
      metadata={[
        {
          key: "records",
          label: t("recordsLabel"),
          value: <SourceCount count={controller.countFor(source.key)} />,
        },
      ]}
      controls={
        <SourceSwitch
          label={t("pdfs")}
          checked={source.settings.downloadPdfs}
          onCheckedChange={(downloadPdfs) =>
            controller.patch(source.key, { settings: { ...source.settings, downloadPdfs } })
          }
        />
      }
      onEdit={() => controller.setEditing(source)}
      onToggle={() =>
        controller.patch(source.key, { enabled: !source.enabled })
      }
      onRemove={() => controller.remove(source.key)}
      data-openalex-search={source.enabled ? "approved" : "paused"}
    />
  );
}

export function OpenAlexAccessSettings({
  source,
}: {
  source: ReturnType<typeof useOpenAlexSources>;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  return (
    <Tabs
      value={source.mode}
      onValueChange={(mode) => {
        source.selectMode(mode as "openscholar" | "custom");
      }}
    >
      <TabsList aria-label={t("openAlex.access")}>
        <TabsTrigger value="openscholar">
          <Building2 />
          OpenScholar
        </TabsTrigger>
        <TabsTrigger value="custom">
          <KeyRound />
          {t("openAlex.ownKey")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="openscholar">
        <p className="text-xs text-muted-foreground">
          {t("openAlex.platformHint")}
        </p>
      </TabsContent>
      <TabsContent value="custom" className="space-y-3">
        <Field
          label={t("openAlex.keyLabel")}
          hint={
            source.customCredential?.maskedHint
              ? t("openAlex.savedKey", { hint: source.customCredential.maskedHint })
              : t("openAlex.keyHint")
          }
        >
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              placeholder={t("openAlex.keyPlaceholder")}
              value={source.apiKey}
              onChange={(event) => source.setApiKey(event.target.value)}
            />
          )}
        </Field>
        <Button
          type="button"
          size="sm"
          disabled={!source.apiKey.trim()}
          onClick={() => void source.saveCustomCredential()}
        >
          {t("openAlex.saveKey")}
        </Button>
        {source.customCredential ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" size="sm" variant="outline">
                {t("openAlex.removeKey")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("openAlex.removeKeyTitle")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("openAlex.removeKeyBody")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("picker.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => void source.removeCustomCredential()}
                >
                  {t("openAlex.removeKeyConfirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </TabsContent>
    </Tabs>
  );
}
