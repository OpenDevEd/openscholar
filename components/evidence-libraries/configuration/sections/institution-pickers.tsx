"use client";

/**
 * Institution pickers fed by the names on the library's own records. The
 * Institutions section mounts `InstitutionNamePicker`; Search & filters
 * mounts `FeaturedInstitutionPicker` (`filters.institution.featuredValue`).
 * Both search the library one page at a time.
 */

import { useAction } from "convex/react";
import { ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  type PickerSort,
  type PickerSource,
  RemotePickerDialog,
} from "./remote-picker-dialog";

type InstitutionPage = {
  reason?: "not-set-up";
  items: { name: string; count: number }[];
  nextCursor: string | null;
};

type ListAction = (args: {
  libraryId: Id<"evidenceLibraries">;
  query?: string;
  cursor?: string;
  sort?: "count" | "name";
  direction?: "asc" | "desc";
}) => Promise<InstitutionPage>;

// Most records first, the way an owner looks for the main institution.
// Either header can be turned around.
const SORTS: readonly PickerSort[] = [
  { value: "count", column: "count", direction: "desc" },
  { value: "name", column: "title", direction: "asc" },
];

type PickerProps = {
  libraryId: Id<"evidenceLibraries">;
  /** The current name, or empty when nothing is chosen. */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  /** Let the owner use a name that is not on any record yet. */
  allowNew: boolean;
  /** Offer a "None" row that clears the value. */
  allowNone: boolean;
};

function InstitutionPicker({ libraryId, value, onChange, id, allowNew, allowNone }: PickerProps) {
  const t = useTranslations("evidenceLibraryInstitutions.picker");
  const listInstitutions = useAction(
    api.zotero.runtimeReadActions.listRecordInstitutions,
  ) as ListAction;

  const readPage: PickerSource = async ({ query, cursor, sort, direction }) => {
    const page = await listInstitutions({
      libraryId,
      query: query || undefined,
      cursor: cursor ?? undefined,
      sort: sort === "name" ? "name" : "count",
      direction: direction ?? undefined,
    });
    return {
      reason: page.reason,
      items: page.items.map((item) => ({ id: item.name, title: item.name, count: item.count })),
      nextCursor: page.nextCursor,
    };
  };

  return (
    <RemotePickerDialog
      mode="single"
      value={value}
      onChoose={(row) => onChange(row?.title ?? "")}
      trigger={
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          className="w-full justify-between bg-background font-normal"
        >
          <span className={value ? "truncate" : "truncate text-muted-foreground"}>
            {value || t("placeholder")}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      }
      title={t("title")}
      description={t("description")}
      searchLabel={t("search")}
      columns={{ title: t("colName"), count: t("colRecords") }}
      sorts={SORTS}
      source={readPage}
      loadingLabel={t("loading")}
      failedLabel={t("failed")}
      emptyLabel={t("empty")}
      noMatchLabel={t("noMatch")}
      notSetUpLabel={t("notSetUp")}
      noneLabel={allowNone ? t("none") : undefined}
      newLabel={allowNew ? (typed) => t("useTyped", { name: typed }) : undefined}
    />
  );
}

/** Name of one institution row (`institutions[].name`). */
export function InstitutionNamePicker(props: Omit<PickerProps, "allowNew" | "allowNone">) {
  return <InstitutionPicker {...props} allowNew allowNone={false} />;
}

/** The institution shown first in the filter (`filters.institution.featuredValue`). */
export function FeaturedInstitutionPicker({
  value,
  onChange,
  ...props
}: Omit<PickerProps, "allowNew" | "allowNone" | "value" | "onChange"> & {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <InstitutionPicker
      {...props}
      value={value ?? ""}
      onChange={(next) => onChange(next || undefined)}
      allowNew={false}
      allowNone
    />
  );
}
