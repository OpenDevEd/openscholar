"use client";

import { FolderOpen, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { CollectionSetting, DatabaseCollection } from "@/lib/evidence-libraries/mock/config";
import { EmptyList, ListRow, move, SubHeading } from "./fields";
import { SectionShell, type SectionProps } from "./section-shell";

export function CollectionsSection({ library, patch }: SectionProps) {
  const t = useTranslations("evidenceLibraryMock.config.collections");
  const shown = library.draft.collections;
  const database = library.databaseCollections;
  const available = database.filter((c) => !shown.some((s) => s.id === c.id));

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
        featured: false,
        count: collection.count,
      });
      return d;
    });
  }

  return (
    <SectionShell sectionKey="collections" icon={FolderOpen} description={t("description")} library={library}>
      <p className="text-xs text-muted-foreground">{t("introHint")}</p>
      <SubHeading
        action={
          <AddCollection
            available={available}
            databaseEmpty={database.length === 0}
            onAdd={add}
          />
        }
      >
        {t("shownCount", { shown: shown.length, total: database.length })}
      </SubHeading>
      {database.length === 0 ? (
        <EmptyList>{t("noneInDatabase")}</EmptyList>
      ) : shown.length === 0 ? (
        <EmptyList>{t("empty")}</EmptyList>
      ) : (
        <div className="space-y-2">
          {shown.map((collection, index) => (
            <ListRow
              key={collection.id}
              index={index}
              count={shown.length}
              removeLabel={t("remove")}
              onRemove={() =>
                patch((d) => {
                  d.collections = d.collections.filter((c) => c.id !== collection.id);
                  return d;
                })
              }
              onMove={(from, to) =>
                patch((d) => {
                  d.collections = move(d.collections, from, to);
                  return d;
                })
              }
              data-collection-id={collection.id}
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

function AddCollection({
  available,
  databaseEmpty,
  onAdd,
}: {
  available: DatabaseCollection[];
  databaseEmpty: boolean;
  onAdd: (collection: DatabaseCollection) => void;
}) {
  const t = useTranslations("evidenceLibraryMock.config.collections");
  const [open, setOpen] = useState(false);
  const sources = [...new Set(available.map((c) => c.source))];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={databaseEmpty}>
          <Plus />
          {t("add")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <Command>
          <CommandInput placeholder={t("searchPlaceholder")} autoFocus />
          <CommandList>
            <CommandEmpty>{available.length === 0 ? t("allAdded") : t("noMatch")}</CommandEmpty>
            {sources.map((source) => (
              <CommandGroup key={source} heading={source}>
                {available
                  .filter((c) => c.source === source)
                  .map((collection) => (
                    <CommandItem
                      key={collection.id}
                      value={`${collection.title} ${collection.source}`}
                      onSelect={() => {
                        onAdd(collection);
                        setOpen(false);
                      }}
                    >
                      <span className="flex-1 truncate">{collection.title}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {t("records", { count: collection.count })}
                      </span>
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
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
        <div className="flex items-center gap-2 pb-6">
          <Switch
            id={`${id}-featured`}
            checked={collection.featured}
            onCheckedChange={(checked) =>
              onUpdate((row) => {
                row.featured = checked;
              })
            }
          />
          <Label htmlFor={`${id}-featured`} className="text-sm font-normal">
            {t("featured")}
          </Label>
        </div>
      </div>
    </>
  );
}
