"use client";

import { ArrowUpDownIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  hugeiconSpriteUrl,
  iconDisplayName,
  isNavbarIconId,
} from "@/lib/evidence-libraries/configuration/icons";
import type { NavIcon } from "@/lib/evidence-libraries/configuration/links";
import {
  localPickerSource,
  type PickerRow,
  type PickerSource,
  RemotePickerDialog,
} from "./remote-picker-dialog";

const PAGE_SIZE = 50;
let rowsPromise: Promise<PickerRow[]> | undefined;

function iconRows(): Promise<PickerRow[]> {
  rowsPromise ??= fetch("/library-icons/catalog.json")
    .then(async (response) => {
      if (!response.ok)
        throw new Error(`Icon catalog returned ${response.status}`);
      const catalog: unknown = await response.json();
      if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
        throw new Error("Icon catalog is not an object");
      }
      const ids = Object.keys(catalog).filter(isNavbarIconId);
      if (ids.length !== Object.keys(catalog).length) {
        throw new Error("Icon catalog contains an invalid id");
      }
      return ids.map((id) => ({ id, title: iconDisplayName(id) }));
    })
    .catch((error) => {
      rowsPromise = undefined;
      throw error;
    });
  return rowsPromise;
}

const iconSource: PickerSource = async (input) =>
  localPickerSource(await iconRows(), PAGE_SIZE)(input);

export function IconPreview({
  iconId,
  className,
}: {
  iconId: string;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <use href={hugeiconSpriteUrl(iconId)} />
    </svg>
  );
}

export function NavbarIconPicker({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: NavIcon | "";
  onChange: (icon: NavIcon | "") => void;
  /** What the trigger and the clearing row say while no icon is chosen. */
  placeholder?: string;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.links");
  return (
    <RemotePickerDialog
      mode="single"
      value={value}
      onChoose={(row) => onChange(row?.id ?? "")}
      trigger={
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          className="w-full justify-between bg-background font-normal"
        >
          <span
            className={
              value
                ? "flex min-w-0 items-center gap-2"
                : "text-muted-foreground"
            }
          >
            {value ? (
              <IconPreview iconId={value} className="size-4 shrink-0" />
            ) : null}
            <span className="truncate">
              {value ? iconDisplayName(value) : (placeholder ?? t("noIcon"))}
            </span>
          </span>
          <HugeiconsIcon
            icon={ArrowUpDownIcon}
            size={16}
            className="shrink-0 opacity-50"
          />
        </Button>
      }
      title={t("iconPicker.title")}
      description={t("iconPicker.description")}
      searchLabel={t("iconPicker.search")}
      columns={{ title: t("iconPicker.colTitle") }}
      source={iconSource}
      renderLeading={(row) => (
        <IconPreview iconId={row.id} className="size-5" />
      )}
      loadingLabel={t("iconPicker.loading")}
      failedLabel={t("iconPicker.failed")}
      emptyLabel={t("iconPicker.empty")}
      noMatchLabel={t("iconPicker.noMatch")}
      notSetUpLabel={t("iconPicker.empty")}
      noneLabel={placeholder ?? t("noIcon")}
    />
  );
}
