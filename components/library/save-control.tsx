"use client";

import { ConvexError } from "convex/values";
import { cloneElement, useRef, useState, type UIEvent } from "react";
import { useTranslations } from "next-intl";
import { useAuth, useClerk } from "@clerk/nextjs";
import { toast } from "sonner";
import { create } from "zustand";
import { BookCheck, BookPlus, Building2, Folder, FolderCheck, Plus, Search, UserRound } from "@/components/icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { trimPaperData, type WorkInput } from "@/lib/library/trim-paper-data";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { AutoHeight } from "@/components/ui/auto-height";
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
import { NewCollectionDialog, useCollectionDialogsReady } from "./collection-dialogs";
import { useCurrentWorkspace, WorkspaceTile } from "@/components/workspaces/parts";
import { inWorkspace, useWorkspace, useWorkspaceMutation } from "@/lib/workspaces/url";
import { CommunityControl } from "@/components/evidence-libraries/added-papers/community-control";

/** A removal's ID: the server keeps what was removed for a day, for Undo. */
type Removal = Id<"libraryRemovals">;
/** `elsewhere`: a change to a collection of another workspace's, shared with the person to edit (#653), which leaves their own library as it is. */
type Pending = { value: boolean; token: number; elsewhere?: true };

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
  setCollection: (paperId: string, collectionId: string, value: boolean, elsewhere?: boolean) => number;
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
  setCollection: (paperId, collectionId, value, elsewhere) => {
    const token = ++lastToken;
    set((state) => ({
      collections: { ...state.collections, [paperId]: { ...state.collections[paperId], [collectionId]: { value, token, ...(elsewhere ? { elsewhere: true as const } : {}) } } },
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
  const workspaceId = useWorkspace();
  const t = useTranslations("saveToLibrary");
  const { phase } = useAuthReadiness();
  const { isSignedIn, userId } = useAuth();
  const { openSignIn } = useClerk();
  const ready = phase === "authenticated";
  const { data: saved } = useProtectedQuery(
    api.library.queries.savedPaper,
    inWorkspace(workspaceId, ready && paper ? { paper: paper.id } : "skip"),
  );
  const pendingSaved = usePending((state) => (paper ? state.saved[paper.id]?.value : undefined));
  const save = useWorkspaceMutation(api.library.mutations.saveToLibrary);
  const remove = useWorkspaceMutation(api.library.mutations.removeFromLibrary);
  const restore = useWorkspaceMutation(api.library.mutations.restoreLibraryItem);

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
    const request = remove({ paper: paper.id }).then(({ undo }) => undo?.args.removalId ?? null);
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
  const setIn = useSetInCollection(paper);
  const [picking, setPicking] = useState(false);
  const [making, setMaking] = useState(false);
  // Focus goes back to the folder once the new collection's dialog closes: the menu item that opened it is gone.
  const folderRef = useRef<HTMLButtonElement>(null);
  const pendingCollections =
    usePending((state) => state.collections[paper.id]) ?? NO_PENDING_COLLECTIONS;
  const inCollection =
    Object.values(pendingCollections).some((pending) => pending.value && !pending.elsewhere) || Boolean(saved?.inCollection);
  const label = isSaved ? t("removeFromLibrary") : t("saveToLibrary");
  const folderButton = (
    <Button
      ref={folderRef}
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
        <Popover open={picking} onOpenChange={setPicking}>
          <TooltipHint label={t("addToCollection")}>
            <PopoverTrigger asChild>{folderButton}</PopoverTrigger>
          </TooltipHint>
          {/* Focus goes to the new collection's name, not back to the folder, when the list makes way for it. */}
          <PopoverContent align="start" className="w-72 p-2" onCloseAutoFocus={(event) => making && event.preventDefault()}>
            <CollectionsPanel
              paperId={paper.id}
              pending={pendingCollections}
              onToggle={setIn}
              onNew={() => {
                setPicking(false);
                setMaking(true);
              }}
            />
          </PopoverContent>
        </Popover>
      ) : (
        // Signed out, the folder asks the person to sign in instead of opening.
        <TooltipHint label={t("addToCollection")}>
          {cloneElement(folderButton, { onClick: isSignedIn ? undefined : () => openSignIn() })}
        </TooltipHint>
      )}
      {/* MOCK (mock/added-papers): the paper onto a community. */}
      <CommunityControl paper={paper} />
      {/* In the group, whose handlers keep the dialog's clicks and keys from reaching the card. */}
      <NewCollectionDialog open={making} onOpenChange={setMaking} paper={{ title: paper.title || paper.display_name || "", add: (id) => setIn(id, true) }} returnFocus={() => folderRef.current} />
    </ButtonGroup>
  );
}

/** Adds a paper to a collection or takes it out, showing the change at once wherever the paper is. */
function useSetInCollection(paper: WorkInput) {
  const t = useTranslations("saveToLibrary");
  const { userId } = useAuth();
  const setInCollection = useWorkspaceMutation(api.library.mutations.setPaperInCollection);
  // `elsewhere`: the collection is another workspace's, so the paper is saved to that one's library, not the person's.
  return (collectionId: Id<"collections">, add: boolean, elsewhere = false) => {
    const { setCollection, settleCollection, setSaved, settleSaved } = usePending.getState();
    const token = setCollection(paper.id, collectionId, add, elsewhere);
    const savedToken = add && !elsewhere ? setSaved(paper.id, true) : undefined;
    // A paper added to a collection is saved again on its own terms, not restored.
    if (add && !elsewhere) forgetRemoval(userId, paper.id);
    return setInCollection({ paper: paperArgs(paper), collectionId, inCollection: add })
      .then(() => undefined)
      .catch((error) => {
        console.error("[Library] Failed to change collection:", error);
        toast.error(t("collectionError"));
      })
      .finally(() => {
        settleCollection(paper.id, collectionId, token);
        if (savedToken !== undefined) settleSaved(paper.id, savedToken);
      });
  };
}

/** The popover's checklist of the workspace's collections, and a new one made with the paper. */
function CollectionsPanel({
  paperId,
  pending,
  onToggle,
  onNew,
}: {
  paperId: string;
  pending: Record<string, Pending>;
  onToggle: (collectionId: Id<"collections">, add: boolean, elsewhere: boolean) => void;
  onNew: () => void;
}) {
  const t = useTranslations("saveToLibrary");
  const tl = useTranslations("libraryPage");
  const workspace = useCurrentWorkspace();
  const picker = useCollectionPicker({ paper: paperId });
  // New collection opens from here: what it shows is read while this is open.
  useCollectionDialogsReady();

  const loadingMembers = picker.isLoading;
  const checkedIds = new Set<string>([...(picker.collections ?? []), ...picker.shared].filter((collection) => collection.containsItem).map((collection) => collection._id));
  for (const [collectionId, { value: checked }] of Object.entries(pending)) {
    if (checked) checkedIds.add(collectionId);
    else checkedIds.delete(collectionId);
  }

  return (
    <>
      <div className="flex items-center gap-2 px-2 pt-1 pb-2">
        <p className="flex-1 shrink-0 text-sm font-medium">{t("addToCollection")}</p>
        {workspace ? (
          <span role="img" aria-label={workspace.name} className="flex">
            <WorkspaceTile workspace={workspace} size="sm" />
          </span>
        ) : null}
      </div>
      <div className="relative mb-1">
        <Search className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={picker.query}
          onChange={(event) => picker.setQuery(event.target.value)}
          placeholder={tl("searchCollections")}
          aria-label={tl("searchCollections")}
          className="h-8 ps-8 text-sm"
        />
      </div>
      {/* The list is read once the popover opens: the frame slides to its height and the rows fade in, in place of a jump. */}
      <AutoHeight>
        <CollectionChecklist
          collections={picker.collections}
          shared={picker.shared}
          searching={picker.search.length > 0}
          onScroll={picker.onScroll}
          checkedIds={checkedIds}
          onToggle={(collectionId, checked, elsewhere) => onToggle(collectionId, !checked, elsewhere)}
          // Kept still until the paper's collections arrive, so a tick can't land on stale state.
          busy={loadingMembers}
        />
      </AutoHeight>
      <button
        type="button"
        onClick={onNew}
        className="mt-1 flex h-10 w-full items-center gap-2.5 rounded-lg border-t border-border/60 px-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/5"
      >
        <Plus className="size-4" /> {t("newCollectionWithPaper")}
      </button>
    </>
  );
}

type Listed = { _id: Id<"collections">; name: string; itemCount: number; from?: { name: string; organization: boolean } };

function CollectionChecklist({
  collections,
  shared,
  searching,
  checkedIds,
  onToggle,
  onScroll,
  busy,
}: {
  collections: Listed[] | undefined;
  /** The ones other workspaces shared with the person to edit (#653), under their own. */
  shared: Listed[];
  searching: boolean;
  checkedIds: ReadonlySet<string>;
  onToggle: (collectionId: Id<"collections">, isCurrentlyChecked: boolean, elsewhere: boolean) => void;
  onScroll: (event: UIEvent<HTMLElement>) => void;
  /** The next answer is being read: the last one stays, dimmed and out of reach of the pointer and the keyboard. */
  busy: boolean;
}) {
  const t = useTranslations("libraryPage");
  const ts = useTranslations("workspaces.shared");

  if (!collections || collections.length + shared.length === 0) {
    return (
      // Held at its size, unseen, until the first page arrives.
      <p className={cn("text-sm text-muted-foreground text-center py-4", !collections && "invisible")}>
        {collections && searching ? t("noCollectionsMatchSearch") : t("noCollections")}
      </p>
    );
  }

  const row = (collection: Listed) => {
    const isChecked = checkedIds.has(collection._id);
    const From = collection.from?.organization ? Building2 : UserRound;
    return (
      <label
        key={collection._id}
        className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted transition-colors cursor-pointer"
      >
        <Checkbox
          checked={isChecked}
          onCheckedChange={() => onToggle(collection._id, isChecked, collection.from !== undefined)}
        />
        {collection.from ? (
          // Whose it is, under its name: the paper goes into that workspace's library.
          <span className="min-w-0 flex-1">
            <TooltipHint label={collection.name} onlyWhenClipped>
              <span className="block truncate text-sm font-medium">{collection.name}</span>
            </TooltipHint>
            <TooltipHint label={collection.from.name} onlyWhenClipped>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <From className="size-3 shrink-0" />
                <span className="min-w-0 truncate">{collection.from.name}</span>
              </span>
            </TooltipHint>
          </span>
        ) : (
          <TooltipHint label={collection.name} onlyWhenClipped>
            <span className="text-sm font-medium truncate flex-1">
              {collection.name}
            </span>
          </TooltipHint>
        )}
        <Badge
          variant="secondary"
          className="text-3xs h-4 px-1 shrink-0"
        >
          {collection.itemCount}
        </Badge>
      </label>
    );
  };

  return (
    <div inert={busy} className={cn("fade-enter max-h-[280px] overflow-y-auto space-y-1", busy && "opacity-50")} onScroll={onScroll}>
      {collections.map(row)}
      {shared.length ? <p className="px-3 pb-0.5 pt-2 text-xs font-medium text-muted-foreground">{ts("title")}</p> : null}
      {shared.map(row)}
    </div>
  );
}
