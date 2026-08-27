"use client";

import { ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BUILT_IN_PAGES,
  type BuiltInPageKey,
  HTTPS_URL,
  type LinkDraft,
  type LinkTarget,
  NAV_ICONS,
  type NavIcon,
} from "@/lib/evidence-libraries/configuration/links";
import { SCHEMA_LIMITS } from "@/lib/evidence-libraries/configuration/rules";
import { InlineSwitch } from "../fields";
import { NAV_ICON_GLYPHS } from "../nav-icons";
import { Field } from "../section-card";
import { localPickerSource, RemotePickerDialog } from "./remote-picker-dialog";

const NO_ICON = "__none";

type CollectionOption = { id: string; title: string };

/** Switching the kind clears the other target's value. */
function retarget(kind: LinkTarget["kind"], collections: CollectionOption[]): LinkTarget {
  if (kind === "page") return { kind: "page", page: "home" };
  if (kind === "collection") {
    return { kind: "collection", collectionId: collections[0]?.id ?? "" };
  }
  return { kind: "url", url: "" };
}

/** The title of the chosen collection, or empty when none is chosen. */
function chosenTitle(collectionId: string, collections: CollectionOption[]): string {
  return collections.find((collection) => collection.id === collectionId)?.title ?? "";
}

/**
 * Editor for one navigation or footer link. The footer hides the icon
 * picker; dropdown links are handled by the caller.
 */
export function LinkEditor({
  link,
  collections,
  onChange,
  showIcon = true,
}: {
  link: LinkDraft;
  /** Collections the owner shows on the site, for collection targets. */
  collections: CollectionOption[];
  onChange: (link: LinkDraft) => void;
  showIcon?: boolean;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.links");
  const target = link.target;
  const urlError = target.kind === "url" && !HTTPS_URL.test(target.url) ? t("urlError") : null;
  const collectionError =
    target.kind === "collection" && collections.length === 0 ? t("noCollections") : null;

  return (
    <div className="space-y-3" data-link-kind={target.kind}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("labelLabel")} error={!link.label.trim() ? t("labelError") : null}>
          {(id, invalid) => (
            <Input
              id={id}
              className="bg-background"
              maxLength={SCHEMA_LIMITS.navigation.label}
              value={link.label}
              aria-invalid={invalid || undefined}
              placeholder={t("labelPlaceholder")}
              onChange={(e) => onChange({ ...link, label: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("kindLabel")}>
          {(id) => (
            <Select
              value={target.kind}
              onValueChange={(kind) =>
                onChange({
                  ...link,
                  target: retarget(kind as LinkTarget["kind"], collections),
                  newTab: kind === "url" ? link.newTab : false,
                })
              }
            >
              <SelectTrigger id={id} className="w-full bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="page">{t("kinds.page")}</SelectItem>
                <SelectItem value="collection">{t("kinds.collection")}</SelectItem>
                <SelectItem value="url">{t("kinds.url")}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Field>
      </div>

      {target.kind === "page" ? (
        <Field label={t("pageLabel")}>
          {(id) => (
            <Select
              value={target.page}
              onValueChange={(page) =>
                onChange({ ...link, target: { kind: "page", page: page as BuiltInPageKey } })
              }
            >
              <SelectTrigger id={id} className="w-full bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUILT_IN_PAGES.map((page) => (
                  <SelectItem key={page.key} value={page.key}>
                    {t(`pages.${page.key}`)}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{page.path}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      ) : null}

      {target.kind === "collection" ? (
        <Field label={t("collectionLabel")} error={collectionError}>
          {(id, invalid) => (
            <RemotePickerDialog
              mode="single"
              value={target.collectionId}
              onChoose={(row) =>
                onChange({ ...link, target: { kind: "collection", collectionId: row?.id ?? "" } })
              }
              trigger={
                <Button
                  id={id}
                  type="button"
                  variant="outline"
                  role="combobox"
                  disabled={collections.length === 0}
                  aria-invalid={invalid || undefined}
                  className="w-full justify-between bg-background font-normal"
                >
                  <span
                    className={
                      chosenTitle(target.collectionId, collections)
                        ? "truncate"
                        : "truncate text-muted-foreground"
                    }
                  >
                    {chosenTitle(target.collectionId, collections) || t("collectionPlaceholder")}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
                </Button>
              }
              title={t("collectionPicker.title")}
              description={t("collectionPicker.description")}
              searchLabel={t("collectionPicker.search")}
              columns={{ title: t("collectionPicker.colTitle") }}
              source={localPickerSource(
                collections.map((collection) => ({ id: collection.id, title: collection.title })),
              )}
              emptyLabel={t("collectionPicker.empty")}
              noMatchLabel={t("collectionPicker.noMatch")}
              notSetUpLabel={t("collectionPicker.empty")}
            />
          )}
        </Field>
      ) : null}

      {target.kind === "url" ? (
        <Field label={t("urlLabel")} error={urlError}>
          {(id, invalid) => (
            <Input
              id={id}
              className="bg-background font-mono text-sm"
              value={target.url}
              inputMode="url"
              placeholder="https://"
              aria-invalid={invalid || undefined}
              onChange={(e) => onChange({ ...link, target: { kind: "url", url: e.target.value } })}
            />
          )}
        </Field>
      ) : null}

      <div className="flex flex-wrap items-end gap-4">
        {showIcon ? (
          <Field label={t("iconLabel")} className="min-w-44 flex-1">
            {(id) => (
              <Select
                value={link.icon || NO_ICON}
                onValueChange={(icon) =>
                  onChange({ ...link, icon: icon === NO_ICON ? "" : (icon as NavIcon) })
                }
              >
                <SelectTrigger id={id} className="w-full bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ICON}>{t("noIcon")}</SelectItem>
                  {NAV_ICONS.map((icon) => {
                    const Glyph = NAV_ICON_GLYPHS[icon];
                    return (
                      <SelectItem key={icon} value={icon}>
                        <Glyph className="h-4 w-4 text-muted-foreground" aria-hidden />
                        {t(`icons.${icon}`)}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            )}
          </Field>
        ) : null}
        {target.kind === "url" ? (
          <InlineSwitch
            label={t("newTab")}
            checked={link.newTab}
            onChange={(newTab) => onChange({ ...link, newTab })}
          />
        ) : null}
        <InlineSwitch
          label={t("visible")}
          checked={link.visible}
          onChange={(visible) => onChange({ ...link, visible })}
        />
      </div>
    </div>
  );
}
