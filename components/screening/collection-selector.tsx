"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { Plus, Check, ChevronDown, FolderPlus, X } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCollectionPicker } from "@/components/library/use-collection-picker";
import { cn } from "@/lib/utils";

interface CollectionSelectorProps {
  selectedId: Id<"collections"> | undefined;
  onSelect: (id: Id<"collections">) => void;
  disabled?: boolean;
}

const CREATE_NEW_VALUE = "__create_new__";

export function CollectionSelector({
  selectedId,
  onSelect,
  disabled,
}: CollectionSelectorProps) {
  const t = useTranslations("screeningDialog");
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const tl = useTranslations("libraryPage");
  const [open, setOpen] = useState(false);
  const picker = useCollectionPicker({ enabled: open });
  const { data: selected } = useProtectedQuery(
    api.library.collections.getCollection,
    selectedId ? { collectionId: selectedId } : "skip",
  );

  const createCollection = useMutation(
    api.library.collections.createCollection
  );

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const id = await createCollection({ name: trimmed });
    onSelect(id);
    setNewName("");
    setIsCreating(false);
  }

  if (isCreating) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
            <FolderPlus className="h-4 w-4 text-primary" />
          </div>
          <span className="text-sm font-medium">
            {t("createNewCollection")}
          </span>
        </div>
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t("newCollectionName")}
          className="h-9"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleCreate();
            }
            if (e.key === "Escape") {
              setIsCreating(false);
              setNewName("");
            }
          }}
        />
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setIsCreating(false);
              setNewName("");
            }}
            className="h-8 px-3 gap-1.5"
          >
            <X className="h-3.5 w-3.5" />
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="h-8 px-4 gap-1.5"
          >
            <Check className="h-3.5 w-3.5" />
            {t("createCollectionConfirm")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-9 w-full justify-between font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? `${selected.name} (${selected.itemCount})` : t("selectCollection")}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      {/* Its full height, so it opens above the trigger when the dialog leaves no room below. */}
      <PopoverContent className="max-h-none w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={tl("searchCollections")} value={picker.query} onValueChange={picker.setQuery} />
          <CommandList onScroll={picker.onScroll}>
            {!picker.isLoading && <CommandEmpty>{picker.search ? tl("noCollectionsMatchSearch") : tl("noCollections")}</CommandEmpty>}
            <CommandGroup>
              {picker.collections.map((col) => (
                <CommandItem
                  key={col._id}
                  value={col._id}
                  onSelect={() => {
                    onSelect(col._id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-4", col._id === selectedId ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1 truncate">{col.name}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{col.itemCount}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          <CommandSeparator />
          <CommandGroup>
            <CommandItem
              value={CREATE_NEW_VALUE}
              onSelect={() => {
                setOpen(false);
                setIsCreating(true);
              }}
            >
              <Plus className="size-4" />
              {t("createNewCollection")}
            </CommandItem>
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
