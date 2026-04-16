"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ExtractionCounter } from "@/components/extraction/extraction-counter";
import { ExtractionBasketDrawer } from "@/components/extraction/extraction-basket-drawer";
import { ExtractionDialog } from "@/components/extraction/extraction-dialog";
import { useExtractionBasketStore } from "@/lib/store/extraction-basket";
import { LibraryTab } from "./library-tab";
import { CollectionsTab } from "./collections-tab";
import { SearchResultsTab } from "./search-results-tab";
import { ManualIdsTab } from "./manual-ids-tab";
import { ShoppingBag, Play, Beaker } from "lucide-react";

export function SelectorPageClient() {
  const t = useTranslations("extraction.selector");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const basketPapers = useExtractionBasketStore((s) => s.papers);
  const basketCount = useExtractionBasketStore((s) => s.papers.size);

  const papersForDialog = useMemo(
    () =>
      Array.from(basketPapers.values()).map((entry) => ({
        openalexId: entry.openAlexId,
        title: entry.title,
        doi: entry.doi ?? undefined,
      })),
    [basketPapers],
  );

  return (
    <>
      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b pb-4 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-primary/10 p-2">
              <Beaker className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">{t("title")}</h1>
              <p className="text-sm text-muted-foreground">
                {t("description")}
              </p>
            </div>
          </div>
          <ExtractionCounter />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="library">
          <TabsList>
            <TabsTrigger value="library">{t("tabs.library")}</TabsTrigger>
            <TabsTrigger value="collections">
              {t("tabs.collections")}
            </TabsTrigger>
            <TabsTrigger value="search">{t("tabs.search")}</TabsTrigger>
            <TabsTrigger value="manual">{t("tabs.manual")}</TabsTrigger>
            <TabsTrigger value="zotero" disabled className="opacity-50">
              {t("tabs.zotero")}
            </TabsTrigger>
          </TabsList>
          <div className="min-h-[50vh] mt-4">
            <TabsContent value="library">
              <LibraryTab />
            </TabsContent>
            <TabsContent value="collections">
              <CollectionsTab />
            </TabsContent>
            <TabsContent value="search">
              <SearchResultsTab />
            </TabsContent>
            <TabsContent value="manual">
              <ManualIdsTab />
            </TabsContent>
            <TabsContent value="zotero">
              <div className="flex min-h-[30vh] items-center justify-center">
                <p className="text-center text-sm text-muted-foreground max-w-sm">
                  {t("zoteroComingSoon")}
                </p>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        {/* Sticky footer */}
        <div className="sticky bottom-0 z-10 bg-background/95 backdrop-blur-sm border-t pt-4 mt-6">
          <ExtractionCounter />
          <div className="flex items-center justify-between mt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDrawerOpen(true)}
            >
              <ShoppingBag className="mr-2 h-4 w-4" />
              {t("reviewBasket")}
            </Button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      onClick={() => setDialogOpen(true)}
                      disabled={basketCount === 0}
                    >
                      <Play className="mr-2 h-4 w-4" />
                      {t("startExtraction")}
                    </Button>
                  </span>
                </TooltipTrigger>
                {basketCount === 0 && (
                  <TooltipContent>
                    {t("startExtractionEmpty")}
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>

      {/* Modals */}
      <ExtractionBasketDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
      <ExtractionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        papers={papersForDialog}
      />
    </>
  );
}
