"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import {
  Folder,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { showConfirmation } from "@/lib/confirmation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface CollectionManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Mode = "list" | "create" | "rename";

export function CollectionManager({
  open,
  onOpenChange,
}: CollectionManagerProps) {
  const t = useTranslations("libraryPage");

  const { data: collections } = useProtectedQuery(
    api.library.collections.getCollectionsWithCounts,
    {},
  );

  const createCollection = useMutation(api.library.collections.createCollection);
  const renameCollection = useMutation(api.library.collections.renameCollection);
  const deleteCollection = useMutation(api.library.collections.deleteCollection);

  const [mode, setMode] = useState<Mode>("list");
  const [inputValue, setInputValue] = useState("");
  const [renameTarget, setRenameTarget] = useState<Id<"collections"> | null>(
    null,
  );

  const resetToList = () => {
    setMode("list");
    setInputValue("");
    setRenameTarget(null);
  };

  const handleCreate = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    try {
      await createCollection({ name: trimmed });
      toast.success(t("collectionCreated"));
      resetToList();
    } catch (err) {
      console.error("[CollectionManager] Failed to create:", err);
    }
  };

  const handleRename = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || !renameTarget) return;
    try {
      await renameCollection({ collectionId: renameTarget, name: trimmed });
      toast.success(t("collectionRenamed"));
      resetToList();
    } catch (err) {
      console.error("[CollectionManager] Failed to rename:", err);
    }
  };

  const handleDelete = (
    collectionId: Id<"collections">,
    collectionName: string,
  ) => {
    showConfirmation({
      title: t("deleteCollectionConfirmTitle"),
      message: t("deleteCollectionConfirmMessage", { name: collectionName }),
      confirmText: t("deleteCollection"),
      cancelText: t("cancelButton"),
      variant: "destructive",
      onConfirm: () => {
        deleteCollection({ collectionId })
          .then(() => {
            toast.success(t("collectionDeleted"));
          })
          .catch((err) => {
            console.error("[CollectionManager] Failed to delete:", err);
            toast.error(t("deleteCollectionError"));
          });
      },
    });
  };

  const startRename = (
    collectionId: Id<"collections">,
    currentName: string,
  ) => {
    setRenameTarget(collectionId);
    setInputValue(currentName);
    setMode("rename");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) resetToList();
        onOpenChange(o);
      }}
    >
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

        {/* Create mode */}
        {mode === "create" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("createCollectionDescription")}
            </p>
            <Input
              autoFocus
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={t("collectionNamePlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreate();
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetToList}>
                {t("cancelButton")}
              </Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={!inputValue.trim()}
              >
                {t("createButton")}
              </Button>
            </div>
          </div>
        )}

        {/* Rename mode */}
        {mode === "rename" && (
          <div className="space-y-3">
            <Input
              autoFocus
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={t("collectionNamePlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleRename();
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={resetToList}>
                {t("cancelButton")}
              </Button>
              <Button
                size="sm"
                onClick={handleRename}
                disabled={!inputValue.trim()}
              >
                {t("saveButton")}
              </Button>
            </div>
          </div>
        )}

        {/* List mode */}
        {mode === "list" && (
          <div className="space-y-2">
            {collections && collections.length > 0 ? (
              <div className="max-h-[300px] overflow-y-auto space-y-1">
                {collections.map((collection) => (
                  <div
                    key={collection._id}
                    className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium truncate">
                        {collection.name}
                      </span>
                      <Badge
                        variant="secondary"
                        className="text-[10px] h-4 px-1 shrink-0"
                      >
                        {collection.itemCount}
                      </Badge>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
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
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t("noCollections")}
              </p>
            )}

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setMode("create")}
            >
              <FolderPlus className="h-4 w-4 mr-2" />
              {t("createCollection")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
