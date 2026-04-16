"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, FolderOpen } from "lucide-react";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";
import { useAddToBasket } from "@/lib/hooks/use-add-to-basket";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Id } from "@/convex/_generated/dataModel";

export function CollectionsTab() {
  const t = useTranslations("extraction.selector");
  const { data: collections } = useProtectedQuery(
    api.library.collections.getCollectionsWithCounts,
    {},
  );
  const { addToBasket } = useAddToBasket();

  const isLoading = collections === undefined;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!collections || collections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <p className="text-sm font-semibold">
          {t("collectionsEmpty.heading")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("collectionsEmpty.body")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {collections.map((collection) => (
        <CollectionRow
          key={collection._id}
          collectionId={collection._id}
          name={collection.name}
          itemCount={collection.itemCount}
          addToBasket={addToBasket}
          t={t}
        />
      ))}
    </div>
  );
}

function CollectionRow({
  collectionId,
  name,
  itemCount,
  addToBasket,
  t,
}: {
  collectionId: Id<"collections">;
  name: string;
  itemCount: number;
  addToBasket: ReturnType<typeof useAddToBasket>["addToBasket"];
  t: ReturnType<typeof useTranslations>;
}) {
  const [isAdding, setIsAdding] = useState(false);

  // Fetch this collection's items via listLibrary with collectionId filter
  const { data: collectionItems } = useProtectedQuery(
    api.library.queries.listLibrary,
    {
      sortBy: "savedAt",
      sortOrder: "desc",
      collectionId,
    },
  );

  const handleAddAll = useCallback(() => {
    if (!collectionItems || collectionItems.length === 0) return;
    setIsAdding(true);

    const toAdd = collectionItems.map((item) => ({
      rawId: item.openalexId,
      title: item.title,
      doi: item.doi ?? null,
      source: "collection" as const,
    }));

    const result = addToBasket(toAdd);
    setIsAdding(false);

    if (result.dropped > 0) {
      toast.info(
        t("addedWithDropped", {
          added: result.added,
          dropped: result.dropped,
        }),
      );
    } else if (result.added > 0) {
      toast.success(t("addedSuccess", { added: result.added }));
    }
  }, [collectionItems, addToBasket, t]);

  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <FolderOpen className="h-5 w-5 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">{name}</p>
          <Badge variant="secondary" className="mt-1">
            {itemCount} {itemCount === 1 ? "paper" : "papers"}
          </Badge>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={handleAddAll}
        disabled={isAdding || !collectionItems || collectionItems.length === 0}
      >
        {isAdding ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : null}
        {t("extractCollection")}
      </Button>
    </div>
  );
}
