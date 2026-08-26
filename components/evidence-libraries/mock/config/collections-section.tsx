"use client";

import { FolderOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CollectionPicker } from "./collection-picker";
import type {
  CollectionSetting,
  DatabaseCollection,
} from "@/lib/evidence-libraries/mock/config";
import { EmptyList, ListRow, move, FieldGroup, SortableList } from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

export function CollectionsSection({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.collections");
  const shown = library.draft.collections;
  const database = library.databaseCollections;

  function update(id: string, fn: (row: CollectionSetting) => void) {
    patch((d) => {
      const row = d.collections.find((c) => c.id === id);
      if (row) fn(row);
      return d;
    });
  }

  function add(collection: DatabaseCollection) {
    patch((d) => {
      d.collections.push({
        id: collection.id,
        sourceTitle: collection.title,
        title: "",
        enabled: true,
        count: collection.count,
      });
      return d;
    });
  }

  return (
    <SectionShell
      sectionKey="collections"
      icon={FolderOpen}
      description={t("description")}
      library={library}
    >
      <FieldGroup
        title={t("shownHeading")}
        hint={t("introHint")}
        action={
          <CollectionPicker
            database={database}
            shownIds={shown.map((c) => c.id)}
            onAdd={(items) => items.forEach(add)}
          />
        }
      >
        {database.length === 0 ? (
          <EmptyList>{t("noneInDatabase")}</EmptyList>
        ) : shown.length === 0 ? (
          <EmptyList>{t("empty")}</EmptyList>
        ) : (
          <SortableList
            ids={shown.map((c) => c.id)}
            onMove={(from, to) =>
              patch((d) => {
                d.collections = move(d.collections, from, to);
                return d;
              })
            }
          >
            {shown.map((collection) => (
              <ListRow
                key={collection.id}
                id={collection.id}
                removeLabel={t("remove")}
                onRemove={() =>
                  patch((d) => {
                    d.collections = d.collections.filter(
                      (c) => c.id !== collection.id,
                    );
                    return d;
                  })
                }
                data-collection-id={collection.id}
                >
                <CollectionRow
                  collection={collection}
                  onUpdate={(fn) => update(collection.id, fn)}
                />
              </ListRow>
            ))}
          </SortableList>
        )}
      </FieldGroup>
    </SectionShell>
  );
}

function CollectionRow({
  collection,
  onUpdate,
}: {
  collection: CollectionSetting;
  onUpdate: (fn: (row: CollectionSetting) => void) => void;
}) {
  const t = useTranslations("evidenceLibraryMock.config.collections");
  const id = useId();
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{collection.sourceTitle}</span>
        <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
          {t("records", { count: collection.count })}
        </span>
      </div>
      <div className="space-y-1.5">
          <div className="flex min-h-5 items-center"><Label htmlFor={`${id}-title`} className="font-normal">{t("titleLabel")}</Label></div>
          <Input
            id={`${id}-title`}
            className="bg-background"
            value={collection.title}
            placeholder={collection.sourceTitle}
            onChange={(e) =>
              onUpdate((row) => {
                row.title = e.target.value;
              })
            }
          />
          <p className="text-xs text-muted-foreground">{t("titleHint")}</p>
      </div>
    </>
  );
}
