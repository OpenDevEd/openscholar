"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface CollectionManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collections: Array<{
    _id: Id<"collections">;
    name: string;
    itemCount: number;
  }> | undefined;
}

const SEARCH_THRESHOLD = 8;

export function CollectionManager({
  open,
  onOpenChange,
  collections,
}: CollectionManagerProps) {
  const t = useTranslations("libraryPage");

  const createCollection = useMutation(
    api.library.collections.createCollection,
  );
  const renameCollection = useMutation(
    api.library.collections.renameCollection,
  );
  const deleteCollection = useMutation(
    api.library.collections.deleteCollection,
  );

  // Inline create
  const [newName, setNewName] = useState("");
  const createInputRef = useRef<HTMLInputElement>(null);

  // Inline rename
  const [editingId, setEditingId] = useState<Id<"collections"> | null>(null);
  const [editingName, setEditingName] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState("");

  // Optimistic deletes pending undo
  const [pendingDeletes, setPendingDeletes] = useState<
    Set<Id<"collections">>
  >(new Set());
  const undoTimers = useRef<Map<Id<"collections">, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // Pagination
  const [page, setPage] = useState(0);

  // Focused row for keyboard navigation
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset state on dialog close
  useEffect(() => {
    if (!open) {
      setNewName("");
      setEditingId(null);
      setEditingName("");
      setSearchQuery("");
      setPage(0);
      setFocusedIndex(-1);
    }
  }, [open]);

  // Focus rename input when editingId changes
  useEffect(() => {
    if (editingId) {
      // Small delay so the input renders first
      requestAnimationFrame(() => renameInputRef.current?.select());
    }
  }, [editingId]);

  // Cleanup all pending undo timers on unmount
  useEffect(() => {
    const timers = undoTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const totalCollections = collections?.length ?? 0;
  const showSearch = totalCollections >= SEARCH_THRESHOLD;
  const hasSearch = searchQuery.trim().length > 0;

  const DIALOG_PAGE_SIZE = 8;

  const filteredCollections = useMemo(() => {
    if (!collections) return [];
    // Hide optimistically deleted items
    const visible = collections.filter((c) => !pendingDeletes.has(c._id));
    if (!hasSearch) return visible;
    const q = searchQuery.toLowerCase().trim();
    return visible.filter((c) => c.name.toLowerCase().includes(q));
  }, [collections, pendingDeletes, searchQuery, hasSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredCollections.length / DIALOG_PAGE_SIZE));
  const effectivePage = Math.min(page, totalPages - 1);
  const pageCollections = hasSearch
    ? filteredCollections
    : filteredCollections.slice(effectivePage * DIALOG_PAGE_SIZE, (effectivePage + 1) * DIALOG_PAGE_SIZE);
  const showPagination = !hasSearch && filteredCollections.length > DIALOG_PAGE_SIZE;

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      await createCollection({ name: trimmed });
      setNewName("");
      createInputRef.current?.focus();
    } catch (err) {
      console.error("[CollectionManager] Failed to create:", err);
    }
  }, [createCollection, newName, t]);

  const startRename = useCallback(
    (id: Id<"collections">, currentName: string) => {
      setEditingId(id);
      setEditingName(currentName);
    },
    [],
  );

  const commitRename = useCallback(async () => {
    const trimmed = editingName.trim();
    if (!trimmed || !editingId) {
      setEditingId(null);
      return;
    }
    try {
      await renameCollection({ collectionId: editingId, name: trimmed });
    } catch (err) {
      console.error("[CollectionManager] Failed to rename:", err);
    }
    setEditingId(null);
  }, [editingId, editingName, renameCollection, t]);

  const cancelRename = useCallback(() => {
    setEditingId(null);
    setEditingName("");
  }, []);

  const handleDelete = useCallback(
    (collectionId: Id<"collections">, collectionName: string) => {
      // Optimistic: hide the row immediately
      setPendingDeletes((prev) => new Set(prev).add(collectionId));

      // Show undo toast
      const toastId = toast(
        t("collectionDeleted"),
        {
          description: collectionName,
          action: {
            label: t("undoDelete"),
            onClick: () => {
              // Cancel the pending delete
              clearTimeout(undoTimers.current.get(collectionId));
              undoTimers.current.delete(collectionId);
              setPendingDeletes((prev) => {
                const next = new Set(prev);
                next.delete(collectionId);
                return next;
              });
            },
          },
          duration: 5000,
        },
      );

      // Actually delete after 5 seconds
      const timer = setTimeout(() => {
        deleteCollection({ collectionId })
          .catch((err) => {
            console.error("[CollectionManager] Failed to delete:", err);
            toast.error(t("deleteCollectionError"));
            // Restore on failure
            setPendingDeletes((prev) => {
              const next = new Set(prev);
              next.delete(collectionId);
              return next;
            });
          });
        undoTimers.current.delete(collectionId);
        setPendingDeletes((prev) => {
          const next = new Set(prev);
          next.delete(collectionId);
          return next;
        });
      }, 5000);

      undoTimers.current.set(collectionId, timer);
    },
    [deleteCollection, t],
  );

  // Keyboard navigation on the list
  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const maxIndex = filteredCollections.length - 1;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((i) => Math.min(i + 1, maxIndex));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
        case "F2": {
          e.preventDefault();
          const item = filteredCollections[focusedIndex];
          if (item && !editingId) {
            startRename(item._id, item.name);
          }
          break;
        }
        case "Delete":
        case "Backspace": {
          if (editingId) return; // Don't delete while renaming
          e.preventDefault();
          const item = filteredCollections[focusedIndex];
          if (item) {
            handleDelete(item._id, item.name);
            setFocusedIndex((i) => Math.min(i, maxIndex - 1));
          }
          break;
        }
        case "Escape":
          if (editingId) {
            cancelRename();
          } else {
            setFocusedIndex(-1);
          }
          break;
      }
    },
    [
      filteredCollections,
      focusedIndex,
      editingId,
      startRename,
      handleDelete,
      cancelRename,
    ],
  );

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex < 0) return;
    const container = listRef.current;
    if (!container) return;
    const rows = container.querySelectorAll("[data-collection-row]");
    rows[focusedIndex]?.scrollIntoView({ block: "nearest" });
  }, [focusedIndex]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Folder className="h-5 w-5" />
            {t("manageCollectionsTitle")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("manageCollections")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Search (8+ collections) */}
          {showSearch && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(0);
                  setFocusedIndex(-1);
                }}
                placeholder={t("searchCollections")}
                className="h-8 pl-8 text-sm"
              />
            </div>
          )}

          {/* Collection list */}
          {filteredCollections.length > 0 ? (
            <div>
              {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
              <div
                ref={listRef}
                className="space-y-px"
                onKeyDown={handleListKeyDown}
                tabIndex={-1}
              >
                {pageCollections.map((collection, index) => {
                  const isEditing = editingId === collection._id;
                  const isFocused = focusedIndex === index;

                  return (
                    <div
                      key={collection._id}
                      data-collection-row
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5",
                        isFocused && !isEditing && "bg-muted/50",
                      )}
                      onClick={() => setFocusedIndex(index)}
                    >
                      <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />

                      {isEditing ? (
                        <Input
                          ref={renameInputRef}
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitRename();
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              cancelRename();
                            }
                          }}
                          className="h-7 text-sm flex-1"
                        />
                      ) : (
                        <span
                          className="text-sm font-medium truncate flex-1 cursor-default select-none"
                          onDoubleClick={() =>
                            startRename(collection._id, collection.name)
                          }
                        >
                          {collection.name}
                        </span>
                      )}

                      <span className="text-xs text-muted-foreground/70 tabular-nums shrink-0">
                        {collection.itemCount}
                      </span>

                      {!isEditing && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0 text-muted-foreground/50 hover:text-foreground"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-36">
                            <DropdownMenuItem
                              onClick={() =>
                                startRename(collection._id, collection.name)
                              }
                            >
                              <Pencil className="h-3.5 w-3.5 mr-2" />
                              {t("renameCollection")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                handleDelete(collection._id, collection.name)
                              }
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" />
                              {t("deleteCollection")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {showPagination && (
                <div className="flex items-center justify-between px-3 pt-2">
                  <button
                    type="button"
                    disabled={effectivePage === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {effectivePage + 1} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={effectivePage >= totalPages - 1}
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ) : hasSearch ? (
            <div className="text-center py-6">
              <Search className="h-5 w-5 mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {t("noCollectionsMatchSearch")}
              </p>
            </div>
          ) : !collections?.length ? (
            <div className="rounded-lg border border-dashed border-border/60 py-8 px-4 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <FolderPlus className="h-5 w-5 text-muted-foreground" />
              </div>
              <h3 className="text-sm font-semibold">
                {t("emptyCollectionsTitle")}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground max-w-[240px] mx-auto">
                {t("emptyCollectionsDescription")}
              </p>
            </div>
          ) : null}

          {/* Separator + Inline create */}
          <div className="border-t border-border/40 pt-3">
            <div className="flex items-center gap-3">
              <FolderPlus className="h-4 w-4 text-muted-foreground/60 shrink-0" />
              <Input
                ref={createInputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("newCollectionPlaceholder")}
                className="h-8 text-sm flex-1 border-dashed"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
