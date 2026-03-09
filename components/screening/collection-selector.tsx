"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { Plus, Check } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

  const { data: collections } = useProtectedQuery(
    api.library.collections.getCollectionsWithCounts,
    {}
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

  function handleValueChange(value: string) {
    if (value === CREATE_NEW_VALUE) {
      setIsCreating(true);
      return;
    }
    onSelect(value as Id<"collections">);
  }

  if (isCreating) {
    return (
      <div className="rounded-md border border-border bg-muted/50 p-3 space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          {t("createCollectionLabel")}
        </label>
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t("newCollectionName")}
          className="h-8"
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
            className="h-7 px-3 text-xs"
          >
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="h-7 px-3 text-xs"
          >
            <Check className="h-3.5 w-3.5 mr-1.5" />
            {t("createNewCollection")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Select
      value={selectedId ?? ""}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder={t("selectCollection")} />
      </SelectTrigger>
      <SelectContent>
        {collections?.map((col) => (
          <SelectItem key={col._id} value={col._id}>
            {col.name} ({col.itemCount})
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value={CREATE_NEW_VALUE}>
          <span className="flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            {t("createNewCollection")}
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
