"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { create } from "zustand";
import { BookCheck, BookPlus, Folder, FolderCheck, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useRatingsStore } from "@/lib/store";
import { useEffectiveRating } from "@/components/results-contexts";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TooltipHint } from "@/components/ui/tooltip";
import { CollectionChecklist } from "@/components/library/collection-picker";
import { cn } from "@/lib/utils";

// ponytail: mock state for the design review. The real version saves through
// Convex (rating optional on libraryItems) and reads membership from there.
const SAMPLE_COLLECTIONS = [
  { _id: "sample-teacher-training", name: "Teacher training", itemCount: 14 },
  { _id: "sample-early-literacy", name: "Early literacy", itemCount: 31 },
  { _id: "sample-edtech-low-income", name: "EdTech in low-income countries", itemCount: 8 },
];

interface SaveMockState {
  saved: Record<string, boolean>;
  memberships: Record<string, string[]>;
  created: Array<{ _id: string; name: string; itemCount: number }>;
  setSaved: (paperId: string, saved: boolean) => void;
  toggleCollection: (paperId: string, collectionId: string) => void;
  createCollection: (name: string) => string;
}

const useSaveMock = create<SaveMockState>((set) => ({
  saved: {},
  memberships: {},
  created: [],
  setSaved: (paperId, saved) =>
    set((state) => ({
      saved: { ...state.saved, [paperId]: saved },
      memberships: saved
        ? state.memberships
        : { ...state.memberships, [paperId]: [] },
    })),
  toggleCollection: (paperId, collectionId) =>
    set((state) => {
      const current = state.memberships[paperId] ?? [];
      return {
        saved: { ...state.saved, [paperId]: true },
        memberships: {
          ...state.memberships,
          [paperId]: current.includes(collectionId)
            ? current.filter((id) => id !== collectionId)
            : [...current, collectionId],
        },
      };
    }),
  createCollection: (name) => {
    const id = `mock-${Date.now()}`;
    set((state) => ({ created: [...state.created, { _id: id, name, itemCount: 0 }] }));
    return id;
  },
}));

/** Flips the saved state; un-saving also clears the rating. */
export function toggleSaved(paperId: string, rating: number | undefined) {
  const isSaved = useSaveMock.getState().saved[paperId] === true || rating !== undefined;
  if (isSaved) useRatingsStore.getState().setRating(paperId, null);
  useSaveMock.getState().setSaved(paperId, !isSaved);
}

/** Save to library and collections, beside the rating. Icon-only when `compact`. */
export function SaveControl({
  paperId,
  compact = false,
  className,
}: {
  paperId: string;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("saveToLibrary");
  const rating = useEffectiveRating(paperId);
  const mock = useSaveMock();
  const { data: realCollections } = useProtectedQuery(
    api.library.collections.getCollectionsWithCounts,
    {},
  );
  const [newName, setNewName] = useState("");

  const isSaved = mock.saved[paperId] === true || rating !== undefined;
  const memberIds = new Set(mock.memberships[paperId] ?? []);
  const allMemberships = Object.values(mock.memberships).flat();
  const collections = [
    ...(realCollections && realCollections.length > 0
      ? realCollections
      : SAMPLE_COLLECTIONS),
    ...mock.created,
  ].map((collection) => ({
    _id: collection._id as string,
    name: collection.name,
    itemCount:
      collection.itemCount +
      allMemberships.filter((id) => id === collection._id).length,
  }));

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    mock.toggleCollection(paperId, mock.createCollection(name));
    setNewName("");
  };

  const variant = isSaved ? "outline-primary" : "outline";
  const label = isSaved ? t("removeFromLibrary") : t("saveToLibrary");

  return (
    <ButtonGroup
      className={className}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <TooltipHint label={compact ? label : undefined}>
        <Button
          variant={variant}
          size="sm"
          aria-pressed={isSaved}
          aria-label={label}
          onClick={() => toggleSaved(paperId, rating)}
          className={cn(compact && "px-2 has-[>svg]:px-2")}
        >
          {isSaved ? <BookCheck /> : <BookPlus />}
          {!compact && (
            <span className="inline-grid [&>*]:col-start-1 [&>*]:row-start-1">
              <span className={cn(isSaved && "invisible")}>{t("save")}</span>
              <span className={cn(!isSaved && "invisible")} aria-hidden>
                {t("saved")}
              </span>
            </span>
          )}
        </Button>
      </TooltipHint>
      <Popover>
        <TooltipHint label={t("addToCollection")}>
          <PopoverTrigger asChild>
            <Button
              variant={variant}
              size="sm"
              aria-label={t("addToCollection")}
              className="px-2 has-[>svg]:px-2"
            >
              {memberIds.size > 0 ? <FolderCheck /> : <Folder />}
            </Button>
          </PopoverTrigger>
        </TooltipHint>
        <PopoverContent align="start" className="w-72 p-2">
          <p className="px-3 pt-1 pb-2 text-sm font-medium">
            {t("addToCollection")}
          </p>
          <CollectionChecklist
            collections={collections}
            checkedIds={memberIds}
            onToggle={(collectionId) =>
              mock.toggleCollection(paperId, collectionId)
            }
          />
          <form
            className="mt-2 flex items-center gap-2 border-t pt-2"
            onSubmit={(event) => {
              event.preventDefault();
              create();
            }}
          >
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={t("newCollection")}
              aria-label={t("newCollection")}
              className="h-8"
            />
            <TooltipHint label={t("createAndAdd")}>
              <span tabIndex={newName.trim() ? undefined : 0}>
                <Button
                  type="submit"
                  size="icon-sm"
                  variant="outline"
                  aria-label={t("createAndAdd")}
                  disabled={!newName.trim()}
                >
                  <Plus />
                </Button>
              </span>
            </TooltipHint>
          </form>
        </PopoverContent>
      </Popover>
    </ButtonGroup>
  );
}
