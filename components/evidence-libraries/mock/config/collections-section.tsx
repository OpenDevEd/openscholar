"use client";

import { FolderOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { CollectionSetting } from "@/lib/evidence-libraries/mock/config";
import { EmptyList, ListRow, move } from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

export function CollectionsSection({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.collections");
  const collections = library.draft.collections;

  function update(id: string, fn: (row: CollectionSetting) => void) {
    patch((d) => {
      const row = d.collections.find((c) => c.id === id);
      if (row) fn(row);
      return d;
    });
  }

  return (
    <SectionShell sectionKey="collections" icon={FolderOpen} description={t("description")} library={library}>
      <p className="text-xs text-muted-foreground">{t("introHint")}</p>
      {collections.length === 0 ? (
        <EmptyList>{t("empty")}</EmptyList>
      ) : (
        <div className="space-y-2">
          {collections.map((collection, index) => (
            <ListRow
              key={collection.id}
              index={index}
              count={collections.length}
              hideRemove
              removeLabel=""
              onRemove={() => {}}
              onMove={(from, to) =>
                patch((d) => {
                  d.collections = move(d.collections, from, to);
                  return d;
                })
              }
              data-collection-id={collection.id}
              data-enabled={collection.enabled}
              data-featured={collection.featured}
            >
              <CollectionRow collection={collection} onUpdate={(fn) => update(collection.id, fn)} />
            </ListRow>
          ))}
        </div>
      )}
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
        <span className="text-sm text-muted-foreground">{collection.sourceTitle}</span>
        <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
          {t("records", { count: collection.count })}
        </span>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-title`}>{t("titleLabel")}</Label>
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
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <Switch
            id={`${id}-show`}
            checked={collection.enabled}
            onCheckedChange={(checked) =>
              onUpdate((row) => {
                row.enabled = checked;
                if (!checked) row.featured = false;
              })
            }
          />
          <Label htmlFor={`${id}-show`} className="text-sm font-normal">
            {t("show")}
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id={`${id}-featured`}
            checked={collection.featured}
            disabled={!collection.enabled}
            onCheckedChange={(checked) =>
              onUpdate((row) => {
                row.featured = checked;
              })
            }
          />
          <Label
            htmlFor={`${id}-featured`}
            className={collection.enabled ? "text-sm font-normal" : "text-sm font-normal text-muted-foreground"}
          >
            {t("featured")}
          </Label>
        </div>
      </div>
    </>
  );
}
