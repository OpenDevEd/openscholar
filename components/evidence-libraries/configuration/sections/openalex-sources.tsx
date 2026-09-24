"use client";

import dynamic from "next/dynamic";
import { Building2, KeyRound } from "lucide-react";
import { useAction, useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
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
  type EvidenceSourceEntry,
  type OpenAlexSourceEntry,
} from "@/lib/evidence-libraries/configuration/sources";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { Field } from "../section-card";
import { OpenAlexQuerySummary } from "./openalex-query-summary";
import { SourceRow } from "./source-row";

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
  const customCredential = (credentials.data ?? []).find(
    (credential) => credential.credentialKey === OPENALEX_API_CREDENTIAL_KEY,
  );
  const inferredMode = sources.some(
    (source) => source.settings.apiKeyMode === "custom",
  )
    ? "custom"
    : "openscholar";
  const mode = selectedMode ?? inferredMode;
  const editing =
    editingKey === "new"
      ? "new"
      : (sources.find((source) => source.key === editingKey) ?? null);

  function replaceSource(source: OpenAlexSourceEntry) {
    const nextSource: OpenAlexSourceEntry =
      editingKey === "new"
        ? {
            ...source,
            settings: {
              ...source.settings,
              apiKeyMode: mode === "custom" ? "custom" : "platform",
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
    toast.success("OpenAlex API key saved");
  }

  function changeMode(mode: "openscholar" | "custom") {
    setSelectedMode(mode);
    onChange(
      value.map((entry) =>
        entry.provider === "openalex"
          ? {
              ...entry,
              settings: {
                ...entry.settings,
                apiKeyMode: mode === "custom" ? "custom" : "platform",
              },
            }
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
    toast.success("OpenAlex API key removed");
  }

  return {
    sources,
    editing,
    setEditing: (source: "new" | OpenAlexSourceEntry | null) =>
      setEditingKey(
        source === null ? null : source === "new" ? "new" : source.key,
      ),
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
}: {
  source: OpenAlexSourceEntry;
  controller: ReturnType<typeof useOpenAlexSources>;
}) {
  return (
    <SourceRow
      name={source.settings.name}
      provider="OpenAlex search"
      icon={<OpenAlexIcon className="size-4" />}
      status={
        source.enabled
          ? { label: "Approved", tone: "success" }
          : { label: "Paused", tone: "neutral" }
      }
      paused={!source.enabled}
      description={
        <OpenAlexQuerySummary query={source.settings.approvedQuery.query} />
      }
      metadata={[
        {
          key: "pdfs",
          label: "PDF processing",
          value: source.settings.downloadPdfs ? "On" : "Off",
        },
      ]}
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
  return (
    <Tabs
      value={source.mode}
      onValueChange={(mode) => {
        source.selectMode(mode as "openscholar" | "custom");
      }}
    >
      <TabsList aria-label="OpenAlex access">
        <TabsTrigger value="openscholar">
          <Building2 />
          OpenScholar
        </TabsTrigger>
        <TabsTrigger value="custom">
          <KeyRound />
          Own API key
        </TabsTrigger>
      </TabsList>
      <TabsContent value="openscholar">
        <p className="text-xs text-muted-foreground">
          Included with OpenScholar. Updates fetch only changed records.
        </p>
      </TabsContent>
      <TabsContent value="custom" className="space-y-3">
        <Field
          label="OpenAlex API key"
          hint={
            source.customCredential?.maskedHint
              ? `Saved key ${source.customCredential.maskedHint}`
              : "Use your own OpenAlex API key for this library."
          }
        >
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              placeholder="Enter your OpenAlex API key"
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
          Save API key
        </Button>
        {source.customCredential ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" size="sm" variant="outline">
                Remove saved key
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Remove the saved OpenAlex key?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Searches will use OpenScholar access instead.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => void source.removeCustomCredential()}
                >
                  Remove key
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </TabsContent>
    </Tabs>
  );
}
