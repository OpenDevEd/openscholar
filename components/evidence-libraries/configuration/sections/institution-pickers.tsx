"use client";

/**
 * Institution pickers fed by the names on the library's own records. Lane C
 * mounts `InstitutionNamePicker` in the Institutions section and
 * `FeaturedInstitutionPicker` in Search & filters
 * (`filters.institution.featuredValue`).
 */

import { useAction } from "convex/react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type Institution = { name: string; count: number };

type ListState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "not-set-up" }
  | { status: "ready"; items: Institution[] };

type PickerProps = {
  libraryId: Id<"evidenceLibraries">;
  /** The current name, or empty when nothing is chosen. */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  /** Let the owner type a name that is not on any record yet. */
  allowNew: boolean;
  /** Offer a "None" row that clears the value. */
  allowNone: boolean;
};

function InstitutionCombobox({ libraryId, value, onChange, id, allowNew, allowNone }: PickerProps) {
  const t = useTranslations("evidenceLibraryInstitutions.picker");
  const listInstitutions = useAction(api.zotero.runtimeReadActions.listRecordInstitutions);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ListState>({ status: "idle" });
  const [typed, setTyped] = useState("");

  async function openList(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen || list.status === "ready") return;
    setList({ status: "loading" });
    try {
      const result = await listInstitutions({ libraryId });
      setList(result.reason === "not-set-up" ? { status: "not-set-up" } : { status: "ready", items: result.items });
    } catch {
      setList({ status: "failed" });
    }
  }

  function choose(name: string) {
    onChange(name);
    setOpen(false);
  }

  const names = list.status === "ready" ? list.items : [];
  const typedIsNew =
    allowNew && typed.trim().length > 0 && !names.some((item) => item.name.toLowerCase() === typed.trim().toLowerCase());

  return (
    <Popover open={open} onOpenChange={openList}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between bg-background font-normal"
        >
          <span className={value ? "truncate" : "truncate text-muted-foreground"}>{value || t("placeholder")}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={t("search")} value={typed} onValueChange={setTyped} />
          <CommandList>
            {list.status === "loading" ? (
              <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground" role="status">
                <Spinner className="h-4 w-4" />
                {t("loading")}
              </p>
            ) : list.status === "failed" ? (
              <p className="p-3 text-sm text-destructive" role="alert">{t("failed")}</p>
            ) : null}
            {list.status === "not-set-up" ? (
              <p className="p-3 text-sm text-muted-foreground" data-picker-state="not-set-up">{t("notSetUp")}</p>
            ) : null}
            {list.status === "ready" ? <CommandEmpty>{t("empty")}</CommandEmpty> : null}
            <CommandGroup>
              {allowNone ? (
                <CommandItem value="__none" onSelect={() => choose("")}>
                  <Check className={value === "" ? "h-4 w-4" : "h-4 w-4 opacity-0"} aria-hidden />
                  {t("none")}
                </CommandItem>
              ) : null}
              {typedIsNew ? (
                <CommandItem value={`__new:${typed}`} onSelect={() => choose(typed.trim())}>
                  {t("useTyped", { name: typed.trim() })}
                </CommandItem>
              ) : null}
              {names.map((item) => (
                <CommandItem key={item.name} value={item.name} onSelect={() => choose(item.name)}>
                  <Check className={value === item.name ? "h-4 w-4" : "h-4 w-4 opacity-0"} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="text-xs text-muted-foreground">{t("records", { count: item.count })}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Name of one institution row (`institutions[].name`). */
export function InstitutionNamePicker(props: Omit<PickerProps, "allowNew" | "allowNone">) {
  return <InstitutionCombobox {...props} allowNew allowNone={false} />;
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
    <InstitutionCombobox
      {...props}
      value={value ?? ""}
      onChange={(next) => onChange(next || undefined)}
      allowNew={false}
      allowNone
    />
  );
}
