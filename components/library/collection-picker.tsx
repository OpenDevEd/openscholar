"use client";

import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { Folder } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface CollectionPickerProps {
  libraryItemId: Id<"libraryItems">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CollectionPicker({
  libraryItemId,
  open,
  onOpenChange,
}: CollectionPickerProps) {
  const t = useTranslations("libraryPage");

  const { data: collections } = useProtectedQuery(
    api.library.collections.getCollectionsWithCounts,
    {},
  );

  const { data: itemCollectionIds } = useProtectedQuery(
    api.library.collections.getItemCollections,
    { libraryItemId },
  );

  const addToCollection = useMutation(api.library.collections.addToCollection);
  const removeFromCollection = useMutation(
    api.library.collections.removeFromCollection,
  );

  const itemCollectionSet = new Set(itemCollectionIds ?? []);

  const handleToggle = (
    collectionId: Id<"collections">,
    isCurrentlyChecked: boolean,
  ) => {
    if (isCurrentlyChecked) {
      removeFromCollection({ collectionId, libraryItemId }).catch((err) => {
        console.error("[CollectionPicker] Failed to remove:", err);
      });
      toast.success(t("removedFromCollection"));
    } else {
      addToCollection({ collectionId, libraryItemId }).catch((err) => {
        console.error("[CollectionPicker] Failed to add:", err);
      });
      toast.success(t("addedToCollection"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Folder className="h-4 w-4" />
            {t("addToCollection")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("addToCollection")}
          </DialogDescription>
        </DialogHeader>

        {collections && collections.length > 0 ? (
          <div className="max-h-[280px] overflow-y-auto space-y-1">
            {collections.map((collection) => {
              const isChecked = itemCollectionSet.has(collection._id);
              return (
                <label
                  key={collection._id}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() =>
                      handleToggle(collection._id, isChecked)
                    }
                  />
                  <span className="text-sm font-medium truncate flex-1">
                    {collection.name}
                  </span>
                  <Badge
                    variant="secondary"
                    className="text-[10px] h-4 px-1 shrink-0"
                  >
                    {collection.itemCount}
                  </Badge>
                </label>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t("noCollections")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
