"use client";

import { LogoMark } from "@/components/logo";
import { useConvex, useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { type RefObject, useRef } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import {
  collectionSourceEntry,
  type EvidenceSourceEntry,
  type OpenScholarCollectionSourceEntry,
} from "@/lib/evidence-libraries/configuration/sources";
import {
  type PickerHandle,
  type PickerSource,
  RemotePickerDialog,
} from "./remote-picker-dialog";
import { SourceRow, SourceSwitch } from "./source-row";
import type { SourceLive } from "./source-activity";

/** Collections the picker reads at a time. */
const COLLECTION_PICKER_PAGE_SIZE = 50;

/** OpenScholar's own icon, as the logo shows it. */
export function CollectionSourceIcon() {
  return <LogoMark className="size-4" />;
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
  const picker = useRef<PickerHandle>(null);
  const sources = value.filter(
    (source): source is OpenScholarCollectionSourceEntry => source.provider === "openscholar",
  );
  const byId = new Map((connected.data ?? []).map((row) => [row.collectionId as string, row]));

  const readMine: PickerSource = async ({ query, cursor }) => {
    const page = await convex.query(api.library.collections.listCollections, {
      search: query || undefined,
      paginationOpts: { cursor, numItems: COLLECTION_PICKER_PAGE_SIZE },
    });
    return {
      items: page.page.map((collection) => ({ id: collection._id, title: collection.name, count: collection.itemCount })),
      nextCursor: page.isDone ? null : page.continueCursor,
    };
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

  // The connection stays on the server, so discarding the draft keeps the source working.
  function remove(entry: OpenScholarCollectionSourceEntry) {
    commit(latest.current.filter((source) => source.key !== entry.key));
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
      onToggle={() => controller.patch(entry.key, { enabled: paused })}
      onRemove={onRemove}
      data-collection-id={entry.collectionId}
      controls={
        <SourceSwitch
          label={t("pdfs")}
          checked={entry.settings.downloadPdfs}
          onCheckedChange={(downloadPdfs) =>
            controller.patch(entry.key, { settings: { ...entry.settings, downloadPdfs } })
          }
        />
      }
    />
  );
}
