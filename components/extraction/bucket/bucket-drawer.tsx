"use client";

import { useQuery } from "convex/react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import {
  useBucketStore,
  type AllClearSnapshot,
} from "@/lib/store/bucket";
import type { BucketItem } from "@/lib/bucket/bucketItem";
import { authorsPreview } from "@/lib/bucket/authors-preview";
import { bucketCleared } from "@/lib/toast/bucket";
import { Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SourceChip } from "./source-chip";

export function BucketDrawer({
  open,
  onOpenChange,
  onClearReturnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Called after Clear-all fires. Callers typically focus the
   * indicator button here so focus doesn't end up on <body> — a
   * screen-reader reset that's easy to miss.
   */
  onClearReturnFocus?: () => void;
}) {
  const limit = useQuery(api.extraction.bucket.queries.getMyPaperLimit) ?? 1000;
  const order = useBucketStore((s) => s.order);
  const itemsMap = useBucketStore((s) => s.items);
  const remove = useBucketStore((s) => s.remove);
  const clear = useBucketStore((s) => s.clear);
  const restoreFromSnapshot = useBucketStore((s) => s.restoreFromSnapshot);

  const items = order
    .map((k) => itemsMap[k])
    .filter((v): v is BucketItem => Boolean(v));

  const readyCount = items.reduce(
    (n, i) => (i.status === "ready" ? n + (i.paperCount ?? 1) : n),
    0,
  );
  const atCap = readyCount >= limit;
  const nearCap = !atCap && readyCount >= Math.floor(limit * 0.9);

  const handleClearAll = () => {
    const snapshot: AllClearSnapshot = {
      items: { ...itemsMap },
      order: [...order],
    };
    clear();
    bucketCleared(readyCount, snapshot, restoreFromSnapshot);
    onClearReturnFocus?.();
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Bucket</DrawerTitle>
          <DrawerDescription>
            {readyCount} / {limit} papers ready to submit
          </DrawerDescription>
          {(nearCap || atCap) && (
            <div
              className={cn(
                "mt-2 rounded-md p-2 text-xs",
                atCap
                  ? "bg-destructive/10 text-destructive"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
              )}
            >
              {atCap
                ? "You've hit the per-job cap. Remove items before submitting."
                : "Approaching the per-job cap."}
            </div>
          )}
        </DrawerHeader>

        <ScrollArea className="flex-1 px-4">
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              The bucket is empty. Add papers from any tab.
            </p>
          ) : (
            <ul className="space-y-2 pb-4">
              {items.map((item) => (
                <li
                  key={item.bucketKey}
                  className="flex items-start gap-3 rounded-lg border border-border p-3"
                >
                  <SourceChip source={item.source} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {item.title}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {authorsPreview(item)}
                    </p>
                    {item.status !== "ready" && (
                      <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                        {item.status === "uploading" && (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />{" "}
                            uploading
                          </>
                        )}
                        {item.status === "failed" && <span>upload failed</span>}
                      </div>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => remove(item.bucketKey)}
                    aria-label={`Remove ${item.title}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>

        <DrawerFooter className="border-t">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              disabled={items.length === 0}
            >
              Clear all
            </Button>
            <DrawerClose asChild>
              <Button size="sm">Close</Button>
            </DrawerClose>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
