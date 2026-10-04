"use client";

import { ConvexError } from "convex/values";
import { cloneElement, useState, type UIEvent } from "react";
import { useTranslations } from "next-intl";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { create } from "zustand";
import { BookCheck, BookPlus, Folder, FolderCheck, Plus, Search } from "@/components/icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { trimPaperData, type WorkInput } from "@/lib/library/trim-paper-data";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useCollectionPicker } from "./use-collection-picker";

/** A removal's ID: the server keeps what was removed for a day, for Undo. */
type Removal = NonNullable<FunctionReturnType<typeof api.library.mutations.removeFromLibrary>>;
type Pending = { value: boolean; token: number };

let lastToken = 0;

/**
 * Changes on their way to the server, keyed by paper, so every control showing the
 * same paper (its card and focus mode) flips at once. Each change carries a token and
 * only the request that made it clears it, so a slower earlier request can't undo a
 * newer click.
 */
const usePending = create<{
  saved: Record<string, Pending>;
  collections: Record<string, Record<string, Pending>>;
  setSaved: (paperId: string, value: boolean) => number;
  settleSaved: (paperId: string, token: number) => void;
  setCollection: (paperId: string, collectionId: string, value: boolean) => number;
  settleCollection: (paperId: string, collectionId: string, token: number) => void;
}>((set) => ({
  saved: {},
  collections: {},
  setSaved: (paperId, value) => {
    const token = ++lastToken;
    set((state) => ({ saved: { ...state.saved, [paperId]: { value, token } } }));
    return token;
  },
  settleSaved: (paperId, token) =>
    set((state) => {
      if (state.saved[paperId]?.token !== token) return state;
      const { [paperId]: _settled, ...rest } = state.saved;
      return { saved: rest };
    }),
  setCollection: (paperId, collectionId, value) => {
    const token = ++lastToken;
    set((state) => ({
      collections: { ...state.collections, [paperId]: { ...state.collections[paperId], [collectionId]: { value, token } } },
    }));
    return token;
  },
  settleCollection: (paperId, collectionId, token) =>
    set((state) => {
      if (state.collections[paperId]?.[collectionId]?.token !== token) return state;
      const { [collectionId]: _settled, ...rest } = state.collections[paperId];
      return { collections: { ...state.collections, [paperId]: rest } };
    }),
}));

/**
 * Each paper's latest removal, keyed by account and paper, as the request itself.
 * Saving the paper again waits for it and puts back what it took (rating, saved date,
 * collections), so a quick second press works and keyboard users, whose focus the
 * focus mode sheet keeps from the toast, can undo with `B`.
 */
const removals = new Map<string, Promise<Removal | null>>();

/** Forgets the removals a collection change makes stale: the paper is saved on its own terms. */
function forgetRemoval(userId: string | null | undefined, paperId: string) {
  removals.delete(`${userId}:${paperId}`);
}

const NO_PENDING_COLLECTIONS: Record<string, Pending> = {};

/** A paper as the library mutations take it: its metadata plus the full result for rich cards. */
export function paperArgs(paper: WorkInput) {
  return { ...trimPaperData(paper), paperData: JSON.stringify(paper) };
}

/**
 * One paper's place in the library and the actions that change it. The Save button
 * and focus mode's B key share it.
 */
export function useSavePaper(paper: WorkInput | undefined) {
  const t = useTranslations("saveToLibrary");
  const { phase } = useAuthReadiness();
  const { isSignedIn, userId } = useAuth();
  const { openSignIn } = useClerk();
  const ready = phase === "authenticated";
  const { data: saved } = useProtectedQuery(
    api.library.queries.savedPaper,
    ready && paper ? { openalexId: paper.id } : "skip",
  );
  const pendingSaved = usePending((state) => (paper ? state.saved[paper.id]?.value : undefined));
  const save = useMutation(api.library.mutations.saveToLibrary);
  const remove = useMutation(api.library.mutations.removeFromLibrary);
  const restore = useMutation(api.library.mutations.restoreLibraryItem);

  const isSaved = pendingSaved ?? Boolean(saved);

  /** Saves the paper, putting it back whole when `removal` took it away. */
  const saveBack = (paper: WorkInput, removal: Promise<Removal | null> | undefined) => {
    const { setSaved, settleSaved } = usePending.getState();
    const key = `${userId}:${paper.id}`;
    const token = setSaved(paper.id, true);
    removals.delete(key);
    (async () => {
      const removed = removal ? await removal : null;
      const saveAfresh = () =>
        save(paperArgs(paper)).catch((error) => {
          console.error("[Library] Failed to save:", error);
          toast.error(t("saveError"));
        });
      if (!removed) {
        await saveAfresh();
        return;
      }
      // The server restores the research rating with the paper.
      await restore({ removalId: removed }).catch(async (error) => {
        // The removal is past its day, or was already used: the paper is saved afresh.
        if (error instanceof ConvexError && (error.data as { code?: string } | undefined)?.code === "NOT_FOUND") return await saveAfresh();
        console.error("[Library] Failed to restore:", error);
        toast.error(t("restoreError"));
        // Keep the removal so the next Save can try again.
        if (!removals.has(key)) removals.set(key, Promise.resolve(removed));
      });
    })().finally(() => settleSaved(paper.id, token));
  };

  const toggle = () => {
    if (!isSignedIn) {
      openSignIn();
      return;
    }
    if (!ready || !paper) return;
    const key = `${userId}:${paper.id}`;
    if (!isSaved) {
      saveBack(paper, removals.get(key));
      return;
    }
    const { setSaved, settleSaved } = usePending.getState();
    const token = setSaved(paper.id, false);
    // The server clears the research rating with the paper.
    const request = remove({ openalexId: paper.id });
    const removal = request.catch(() => null);
    removals.set(key, removal);
    request
      .then((removed) => {
        if (!removed) return;
        toast(t("removed"), {
          description: paper.title,
          duration: 5000,
          action: {
            label: t("undo"),
            // Only while this removal is still the latest and nothing saved the paper since.
            onClick: () => {
              if (removals.get(key) === removal) saveBack(paper, removal);
            },
          },
        });
      })
      .catch((error) => {
        console.error("[Library] Failed to remove:", error);
        toast.error(t("removeError"));
      })
      .finally(() => settleSaved(paper.id, token));
  };

  return { ready, isSignedIn, openSignIn, saved, isSaved, toggle };
}

/** Save to library and collections, beside the rating. Icon-only when `compact`. */
export function SaveControl({
  paper,
  compact = false,
  className,
}: {
  paper: WorkInput;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("saveToLibrary");
  const { ready, isSignedIn, openSignIn, saved, isSaved, toggle } = useSavePaper(paper);
  const pendingCollections =
    usePending((state) => state.collections[paper.id]) ?? NO_PENDING_COLLECTIONS;
  const inCollection =
    Object.values(pendingCollections).some((pending) => pending.value) || Boolean(saved?.inCollection);
  const label = isSaved ? t("removeFromLibrary") : t("saveToLibrary");
  const folderButton = (
    <Button
      variant="outline"
      size="sm"
      aria-label={t("addToCollection")}
      className="bg-transparent px-2 has-[>svg]:px-2"
    >
      {inCollection ? (
        <FolderCheck className="text-primary" />
      ) : (
        <Folder className="text-muted-foreground" />
      )}
    </Button>
  );

  return (
    <ButtonGroup
      className={className}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <TooltipHint label={compact ? label : undefined}>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={isSaved}
          aria-label={label}
          onClick={toggle}
          className={cn(
            "bg-transparent",
            compact && "px-2 has-[>svg]:px-2",
            isSaved &&
              "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary dark:bg-primary/15 dark:hover:bg-primary/20",
          )}
        >
          {isSaved ? (
            <BookCheck />
          ) : (
            <BookPlus className="text-muted-foreground" />
          )}
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
      {ready ? (
        <Popover>
          <TooltipHint label={t("addToCollection")}>
            <PopoverTrigger asChild>{folderButton}</PopoverTrigger>
          </TooltipHint>
          <PopoverContent align="start" className="w-72 p-2">
            <CollectionsPanel
              paper={paper}
              pending={pendingCollections}
            />
          </PopoverContent>
        </Popover>
      ) : (
        // Signed out, the folder asks the person to sign in instead of opening.
        <TooltipHint label={t("addToCollection")}>
          {cloneElement(folderButton, { onClick: isSignedIn ? undefined : () => openSignIn() })}
        </TooltipHint>
      )}
    </ButtonGroup>
  );
}

/** The popover's checklist of collections, with a field to make a new one. */
function CollectionsPanel({
  paper,
  pending,
}: {
  paper: WorkInput;
  pending: Record<string, Pending>;
}) {
  const t = useTranslations("saveToLibrary");
  const tl = useTranslations("libraryPage");
  const { userId } = useAuth();
  const [newName, setNewName] = useState("");
  const picker = useCollectionPicker({ openalexId: paper.id });
  const setInCollection = useMutation(api.library.mutations.setPaperInCollection);
  const createCollection = useMutation(api.library.collections.createCollection);

  const loadingMembers = picker.isLoading;
  const checkedIds = new Set<string>(picker.collections.filter((collection) => collection.containsItem).map((collection) => collection._id));
  for (const [collectionId, { value: checked }] of Object.entries(pending)) {
    if (checked) checkedIds.add(collectionId);
    else checkedIds.delete(collectionId);
  }

  const toggle = (collectionId: Id<"collections">, add: boolean) => {
    const { setCollection, settleCollection, setSaved, settleSaved } = usePending.getState();
    const token = setCollection(paper.id, collectionId, add);
    const savedToken = add ? setSaved(paper.id, true) : undefined;
    // A paper added to a collection is saved again on its own terms, not restored.
    if (add) forgetRemoval(userId, paper.id);
    setInCollection({ paper: paperArgs(paper), collectionId, inCollection: add })
      .catch((error) => {
        console.error("[Library] Failed to change collection:", error);
        toast.error(t("collectionError"));
      })
      .finally(() => {
        settleCollection(paper.id, collectionId, token);
        if (savedToken !== undefined) settleSaved(paper.id, savedToken);
      });
  };

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    createCollection({ name })
      .then((collectionId) => toggle(collectionId, true))
      .catch((error) => {
        console.error("[Library] Failed to create collection:", error);
        toast.error(t("collectionError"));
      });
  };

  return (
    <>
      <p className="px-3 pt-1 pb-2 text-sm font-medium">{t("addToCollection")}</p>
      <div className="relative mb-1">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={picker.query}
          onChange={(event) => picker.setQuery(event.target.value)}
          placeholder={tl("searchCollections")}
          aria-label={tl("searchCollections")}
          className="h-8 pl-8 text-sm"
        />
      </div>
      <CollectionChecklist
        collections={picker.isLoading ? undefined : picker.collections}
        searching={picker.search.length > 0}
        onScroll={picker.onScroll}
        checkedIds={checkedIds}
        onToggle={(collectionId, checked) => toggle(collectionId, !checked)}
        // Kept still until the paper's collections arrive, so a tick can't land on stale state.
        className={cn(loadingMembers && "pointer-events-none opacity-50")}
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
    </>
  );
}

function CollectionChecklist({
  collections,
  searching,
  checkedIds,
  onToggle,
  onScroll,
  className,
}: {
  collections: Array<{ _id: Id<"collections">; name: string; itemCount: number }> | undefined;
  searching: boolean;
  checkedIds: ReadonlySet<string>;
  onToggle: (collectionId: Id<"collections">, isCurrentlyChecked: boolean) => void;
  onScroll: (event: UIEvent<HTMLElement>) => void;
  className?: string;
}) {
  const t = useTranslations("libraryPage");

  if (!collections || collections.length === 0) {
    return (
      // Held at its size, unseen, until the first page arrives.
      <p className={cn("text-sm text-muted-foreground text-center py-4", !collections && "invisible")}>
        {collections && searching ? t("noCollectionsMatchSearch") : t("noCollections")}
      </p>
    );
  }

  return (
    <div className={cn("max-h-[280px] overflow-y-auto space-y-1", className)} onScroll={onScroll}>
      {collections.map((collection) => {
        const isChecked = checkedIds.has(collection._id);
        return (
          <label
            key={collection._id}
            className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted transition-colors cursor-pointer"
          >
            <Checkbox
              checked={isChecked}
              onCheckedChange={() => onToggle(collection._id, isChecked)}
            />
            <TooltipHint label={collection.name} onlyWhenClipped>
              <span className="text-sm font-medium truncate flex-1">
                {collection.name}
              </span>
            </TooltipHint>
            <Badge
              variant="secondary"
              className="text-3xs h-4 px-1 shrink-0"
            >
              {collection.itemCount}
            </Badge>
          </label>
        );
      })}
    </div>
  );
}
