"use client";

import Image from "next/image";
import { useConvex, useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { type RefObject, useRef, useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import {
  collectionSourceEntry,
  type EvidenceSourceEntry,
  type OpenScholarCollectionSourceEntry,
} from "@/lib/evidence-libraries/configuration/sources";
import {
  localPickerSource,
  type PickerHandle,
  type PickerSource,
  RemotePickerDialog,
} from "./remote-picker-dialog";
import { SourceRow } from "./source-row";
import type { SourceLive } from "./source-activity";

export function CollectionSourceIcon() {
  return <Image src="/icon.svg" alt="" width={16} height={16} className="size-4" />;
}

/**
 * The owner's OpenScholar collections the library follows. Each one is
 * connected on the server first, so the library can later prove who added it.
 */
export function useCollectionSources({
  libraryId,
  value,
  latest,
  commit,
  apiKeyMode,
}: {
  libraryId: Id<"evidenceLibraries">;
  value: EvidenceSourceEntry[];
  /** The newest draft, since Convex calls finish after other rows may have changed. */
  latest: RefObject<EvidenceSourceEntry[]>;
  commit: (next: EvidenceSourceEntry[]) => void;
  apiKeyMode: "platform" | "custom";
}) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  const convex = useConvex();
  const connected = useProtectedQuery(
    api.evidenceLibraries.collectionSources.listLibraryCollectionSources,
    { libraryId },
  );
  const connect = useMutation(api.evidenceLibraries.collectionSources.connectCollectionSource);
  const disconnect = useMutation(api.evidenceLibraries.collectionSources.removeCollectionSource);
  const picker = useRef<PickerHandle>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const sources = value.filter(
    (source): source is OpenScholarCollectionSourceEntry => source.provider === "openscholar",
  );
  const byId = new Map((connected.data ?? []).map((row) => [row.collectionId as string, row]));

  // Read once per open; a person keeps a few dozen collections at most.
  const readMine: PickerSource = async (input) => {
    const mine = await convex.query(api.library.collections.getCollectionsWithCounts, {});
    return localPickerSource(
      mine.map((collection) => ({ id: collection._id, title: collection.name, count: collection.itemCount })),
    )(input);
  };

  /** Connects each collection; returns the ids that could not be added. */
  async function add(rows: { id: string; title: string }[]) {
    const failed: string[] = [];
    for (const row of rows) {
      try {
        const collection = await connect({ libraryId, collectionId: row.id as Id<"collections"> });
        if (!latest.current.some((entry) => entry.provider === "openscholar" && entry.collectionId === row.id)) {
          commit([...latest.current, collectionSourceEntry({ collectionId: row.id, name: collection.name }, apiKeyMode)]);
        }
      } catch {
        failed.push(row.id);
        toast.error(t("collectionConnectFailed"));
      }
    }
    return failed;
  }

  async function remove(entry: OpenScholarCollectionSourceEntry) {
    setBusyKey(entry.key);
    try {
      await disconnect({ libraryId, collectionId: entry.collectionId as Id<"collections"> });
      commit(latest.current.filter((source) => source.key !== entry.key));
    } catch {
      toast.error(t("removeFailed"));
    } finally {
      setBusyKey(null);
    }
  }

  function patch(key: string, change: Partial<OpenScholarCollectionSourceEntry>) {
    commit(
      latest.current.map((source) =>
        source.key === key && source.provider === "openscholar" ? { ...source, ...change } : source,
      ),
    );
  }

  return {
    sources,
    byId,
    busyKey,
    open: () => picker.current?.open(),
    remove,
    patch,
    picker: (
      <RemotePickerDialog
        ref={picker}
        mode="multi"
        title={t("collectionPicker.title")}
        description={t("collectionPicker.description")}
        searchLabel={t("collectionPicker.search")}
        columns={{ title: t("collectionPicker.colCollection"), count: t("picker.colItems") }}
        source={readMine}
        usedIds={sources.map((source) => source.collectionId)}
        usedLabel={t("picker.added")}
        loadingLabel={t("collectionPicker.loading")}
        failedLabel={t("collectionPicker.failed")}
        emptyLabel={t("collectionPicker.noCollections")}
        noMatchLabel={t("collectionPicker.noMatch")}
        notSetUpLabel={t("collectionPicker.noCollections")}
        confirmLabel={(count) => t("collectionPicker.addPicked", { count })}
        onConfirm={add}
      />
    ),
  };
}

export function CollectionSourceRow({
  entry,
  controller,
  live,
  onRemove,
}: {
  entry: OpenScholarCollectionSourceEntry;
  controller: ReturnType<typeof useCollectionSources>;
  live: SourceLive | null;
  onRemove: () => void;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.sources");
  const connected = controller.byId.get(entry.collectionId);
  const paused = !entry.enabled;
  const deleted = connected !== undefined && connected.name === null;
  return (
    <SourceRow
      name={connected?.name ?? entry.settings.name}
      provider={t("openScholarCollection")}
      icon={<CollectionSourceIcon />}
      status={
        live?.status ??
        (paused ? { label: t("health.paused"), tone: "neutral" } : { label: t("health.connected"), tone: "success" })
      }
      activity={live?.activity}
      paused={paused}
      metadata={
        connected && !deleted
          ? [{ key: "records", label: t("recordsLabel"), value: connected.itemCount.toLocaleString() }]
          : []
      }
      description={deleted ? t("collectionDeleted") : undefined}
      disabled={controller.busyKey === entry.key}
      onToggle={() => controller.patch(entry.key, { enabled: paused })}
      onRemove={onRemove}
      data-collection-id={entry.collectionId}
      controls={
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={entry.settings.downloadPdfs}
            aria-label={t("pdfs")}
            onCheckedChange={(downloadPdfs) =>
              controller.patch(entry.key, { settings: { ...entry.settings, downloadPdfs } })
            }
          />
          {t("pdfs")}
        </label>
      }
    />
  );
}
