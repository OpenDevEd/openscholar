"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useExtractionStore } from "@/lib/store/extraction";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AlertCircle, Database, FileText, Library, Loader2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Cascader, type CascaderOption } from "@/components/ui/cascader";
import { useAppToast } from "@/lib/toast";
import { getConvexSiteUrl } from "@/lib/convex-site";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useTranslations } from "next-intl";
import {
  getToastMessageKeyForErrorCode,
  resolveToastError,
} from "@/lib/toast/error-resolver";

type ZoteroGroup = {
  id: string;
  name: string;
  type: string;
  numItems: number;
};

type ZoteroCollection = {
  key: string;
  name: string;
  parentCollection: string | null;
  numItems: number;
  numCollections: number;
};

type ZoteroItem = {
  key: string;
  title: string;
  abstract?: string;
  authors: string[];
  year?: number;
  doi?: string;
  itemType: string;
  numChildren?: number;
  hasPdfChild: boolean;
};

export function ZoteroSelector() {
  const toast = useAppToast();
  const t = useTranslations('zotero');
  const tToast = useTranslations("toast");
  const te = useTranslations('extraction');
  const tc = useTranslations('common');
  const { draftJob, setZoteroSelection } = useExtractionStore();
  const meQuery = useProtectedQuery(api.users.queries.me, {});
  const me = meQuery.data;
  const connectionStatusQuery = useProtectedQuery(
    api.zotero.queries.getConnectionStatus,
    {},
  );
  const connectionStatus = connectionStatusQuery.data;
  const startOAuth = useAction(api.zotero.actions.startOAuth);
  const fetchGroups = useAction(api.zotero.actions.fetchGroups);
  const fetchCollections = useAction(api.zotero.actions.fetchCollections);
  const fetchItems = useAction(api.zotero.actions.fetchItems);

  const [libraryType, setLibraryType] = useState<"user" | "group">("user");
  const [groupId, setGroupId] = useState<string | undefined>(undefined);
  const [collectionKey, setCollectionKey] = useState<string | undefined>(undefined);
  const [includeDescendants, setIncludeDescendants] = useState<boolean>(true);
  const requiresGroupSelection = libraryType === "group" && !groupId;

  const zoteroUserId = connectionStatus?.connected ? connectionStatus.zoteroUserId : undefined;
  const callbackUrl = useMemo(() => {
    const convexSite = getConvexSiteUrl();
    return convexSite ? `${convexSite}/api/zotero/callback` : null;
  }, []);

  const groups = useSWR(
    connectionStatus?.connected ? ["zotero-groups"] : null,
    async () => fetchGroups({}),
    { revalidateOnFocus: false }
  );

  const collections = useSWR(
    connectionStatus?.connected && !requiresGroupSelection
      ? ["zotero-collections", libraryType, groupId]
      : null,
    async () => fetchCollections({ groupId: libraryType === "group" ? groupId : undefined }),
    { revalidateOnFocus: false }
  );

  const getItemsKey = (pageIndex: number, previousPageData: any) => {
    if (!connectionStatus?.connected) return null;
    if (requiresGroupSelection) return null;
    if (previousPageData && !previousPageData.hasMore) return null;
    const cursor = pageIndex === 0 ? 0 : (previousPageData?.nextCursor ?? 0);
    return [
      "zotero-items",
      libraryType,
      groupId,
      collectionKey,
      includeDescendants,
      cursor,
    ];
  };

  const items = useSWRInfinite(
    getItemsKey,
    async (key) => {
      const cursor = key[key.length - 1] as number;
      return await fetchItems({
        groupId: libraryType === "group" ? groupId : undefined,
        collectionKey,
        includeDescendants,
        start: cursor,
        limit: 50,
      });
    },
    { revalidateOnFocus: false }
  );

  const itemPages = requiresGroupSelection ? [] : (items.data || []);
  const flattenedItems = itemPages.flatMap((page) => page.items || []);
  const isLoadingItems = requiresGroupSelection ? false : (items.isLoading || items.isValidating);
  const isReachingEnd = itemPages.length > 0 && itemPages[itemPages.length - 1]?.hasMore === false;

  const selectedItems = draftJob.zoteroSelection?.items || [];
  const collectionOptions = useMemo<CascaderOption[]>(() => {
    const source = requiresGroupSelection
      ? []
      : ((collections.data as ZoteroCollection[] | undefined) || []);
    const byParent = new Map<string | null, ZoteroCollection[]>();
    for (const collection of source) {
      const parent = collection.parentCollection ?? null;
      const entries = byParent.get(parent) || [];
      entries.push(collection);
      byParent.set(parent, entries);
    }

    const buildNodes = (parentKey: string | null): CascaderOption[] => {
      const nodes = byParent.get(parentKey) || [];
      return nodes.map((collection) => ({
        value: collection.key,
        label: `${collection.name} (${collection.numItems})`,
        textLabel: collection.name,
        children: buildNodes(collection.key),
      }));
    };

    return buildNodes(null);
  }, [collections.data, requiresGroupSelection]);
  const selectedCollectionPath = useMemo<string[]>(() => {
    if (!collectionKey || requiresGroupSelection) return [];
    const source = (collections.data as ZoteroCollection[] | undefined) || [];
    const byKey = new Map(source.map((collection) => [collection.key, collection]));
    const path: string[] = [];
    let current: string | null = collectionKey;

    while (current) {
      const found = byKey.get(current);
      if (!found) break;
      path.unshift(found.key);
      current = found.parentCollection ?? null;
    }

    return path;
  }, [collectionKey, collections.data, requiresGroupSelection]);

  const toggleItem = (item: ZoteroItem) => {
    const exists = selectedItems.some((i) => i.itemKey === item.key);
    const nextItems = exists
      ? selectedItems.filter((i) => i.itemKey !== item.key)
      : [...selectedItems, {
          itemKey: item.key,
          title: item.title,
          abstract: item.abstract,
          authors: item.authors,
          year: item.year,
          doi: item.doi,
        }];
      setZoteroSelection({
        libraryType,
        groupId: libraryType === "group" ? groupId : undefined,
        zoteroUserId,
        collectionKey,
        includeDescendants,
        items: nextItems,
      });
  };

  const isLoading = groups.isLoading || collections.isLoading || isLoadingItems;
  const itemsError = requiresGroupSelection ? undefined : (items.error as Error | undefined);
  const itemsErrorMessage = useMemo(() => {
    if (!itemsError) return null;
    const resolved = resolveToastError(itemsError, t("failedToLoadItems"));
    const toastKey = getToastMessageKeyForErrorCode(resolved.code);
    if (toastKey) return tToast(toastKey);
    return resolved.isConvex ? tToast("convexUnknownError") : resolved.message;
  }, [itemsError, t, tToast]);

  if (
    meQuery.isDeferred ||
    connectionStatusQuery.isDeferred ||
    connectionStatus === undefined
  ) {
    return (
      <div className="rounded-xl border border-border bg-muted p-6 text-sm text-muted-foreground">
        {t('loadingStatus')}
      </div>
    );
  }

  if (!connectionStatus.connected) {
    return (
      <div className="rounded-xl border border-border bg-muted p-6 text-sm text-muted-foreground flex items-start gap-4">
        <AlertCircle className="h-5 w-5 text-muted-foreground" />
        <div>
          <p className="font-medium text-foreground">{t('notConnected')}</p>
          <p>{t('connectDescription')}</p>
          <div className="mt-4">
            <Button
              size="sm"
              onClick={async () => {
                if (!me?._id) {
                  toast.validation.failed(t('signInToConnect'));
                  return;
                }
                if (!callbackUrl) {
                  toast.error(t('missingBackendUrl'));
                  return;
                }
                try {
                  const result = await startOAuth({
                    callbackUrl,
                  });
                  window.location.href = result.authorizeUrl;
                } catch (error) {
                  console.error("Failed to start Zotero OAuth", error);
                  toast.zotero.failed();
                }
              }}
            >
              {t('connectZotero')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select value={libraryType} onValueChange={(value) => {
            setLibraryType(value as "user" | "group");
            setGroupId(undefined);
            setCollectionKey(undefined);
            setIncludeDescendants(true);
            setZoteroSelection({
              libraryType: value as "user" | "group",
              groupId: undefined,
              zoteroUserId,
              collectionKey: undefined,
              includeDescendants: true,
              items: [],
            });
          }}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('library')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">
                <div className="flex items-center gap-2"><Library className="h-4 w-4" />{t('myLibrary')}</div>
              </SelectItem>
              <SelectItem value="group">
                <div className="flex items-center gap-2"><Database className="h-4 w-4" />{t('groupLibrary')}</div>
              </SelectItem>
            </SelectContent>
          </Select>

          {libraryType === "group" && (
            <Select value={groupId} onValueChange={(value) => {
              setGroupId(value);
              setCollectionKey(undefined);
              setIncludeDescendants(true);
              setZoteroSelection({
                libraryType: "group",
                groupId: value,
                zoteroUserId,
                collectionKey: undefined,
                includeDescendants: true,
                items: [],
              });
            }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('selectGroup')} />
              </SelectTrigger>
              <SelectContent>
                {(groups.data as ZoteroGroup[] | undefined)?.map((group) => (
                  <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Cascader
            options={collectionOptions}
            value={selectedCollectionPath}
            placeholder={requiresGroupSelection ? t('selectGroupFirst') : t('allItems')}
            disabled={requiresGroupSelection}
            className="w-full sm:col-span-2 lg:col-span-1"
            popupClassName="p-0"
            allowClear={true}
            onChange={(path) => {
              const nextKey = path.length > 0 ? path[path.length - 1] : undefined;
              setCollectionKey(nextKey);
              setIncludeDescendants(true);
              setZoteroSelection({
                libraryType,
                groupId: libraryType === "group" ? groupId : undefined,
                zoteroUserId,
                collectionKey: nextKey,
                includeDescendants: true,
                items: [],
              });
            }}
          />
        </div>

        {collectionKey && (
          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={includeDescendants}
              onCheckedChange={(checked) => {
                const next = checked === true;
                setIncludeDescendants(next);
                setZoteroSelection({
                  libraryType,
                  groupId: libraryType === "group" ? groupId : undefined,
                  zoteroUserId,
                  collectionKey,
                  includeDescendants: next,
                  items: [],
                });
              }}
            />
            Include items from subcollections
          </label>
        )}

        <div className="text-sm text-muted-foreground">
          {t("selectedCount", { count: selectedItems.length })}
        </div>
      </div>

      {isLoading && (
        <div className="rounded-xl border border-border bg-muted p-6 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('loadingItems')}
        </div>
      )}

      {requiresGroupSelection && (
        <div className="rounded-xl border border-border bg-muted p-6 text-sm text-muted-foreground">
          {t("selectGroupToLoad")}
        </div>
      )}

      {itemsError && (
        <div className="rounded-xl border border-border bg-muted p-6 text-sm text-muted-foreground">
          {itemsErrorMessage}
        </div>
      )}

      {!requiresGroupSelection && !isLoading && !itemsError && flattenedItems.length === 0 && (
        <div className="rounded-xl border border-border bg-muted p-6 text-sm text-muted-foreground">
          {t("noItemsFound")}
        </div>
      )}

      <div className="space-y-0 divide-y divide-border border border-border rounded-xl overflow-hidden">
        {flattenedItems.map((item: ZoteroItem, index: number) => {
          const isSelected = selectedItems.some((i) => i.itemKey === item.key);
          return (
            <div
              key={item.key}
              role="button"
              tabIndex={0}
              onClick={() => toggleItem(item)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleItem(item);
                }
              }}
              className={cn(
                "cursor-pointer transition-all duration-200 p-4",
                index % 2 === 0 ? "bg-background" : "bg-muted/30",
                isSelected ? "bg-primary/5 border-l-4 border-l-primary" : "hover:bg-muted/50 border-l-4 border-l-transparent"
              )}
            >
              <div className="flex items-start gap-3">
                <Checkbox checked={isSelected} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.authors.slice(0, 3).join(", ") || te('unknownAuthors')}
                    {item.year ? ` • ${item.year}` : ""}
                  </p>
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    {item.hasPdfChild ? (
                      <span className="inline-flex items-center gap-1">
                        <Paperclip className="h-3 w-3" /> {tc('pdfAttached')}
                      </span>
                    ) : (
                      <></>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {!isReachingEnd && flattenedItems.length > 0 && (
        <div className="flex items-center justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => items.setSize(items.size + 1)}
            disabled={items.isValidating}
          >
            {items.isValidating ? t('loadingItems') : t('loadMore')}
          </Button>
        </div>
      )}
      {flattenedItems.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Showing {flattenedItems.length} items.
        </p>
      )}
    </div>
  );
}
