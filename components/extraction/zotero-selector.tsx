"use client";

import { ZoteroIcon } from "@/components/icons/zotero-icon";

import { useMemo, useRef, useState } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { collectAllPages } from "@/lib/zotero/collect-all-pages";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Database, Library, Loader2, Paperclip } from "lucide-react";
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
import { SelectableList } from "./bucket/selectable-list";
import { SkeletonBar } from "@/components/library/library-item-skeleton";
import { useBucketStore } from "@/lib/store/bucket";
import {
  fromZoteroItem,
  zoteroBucketKeyFor,
} from "@/lib/bucket/bucketItem";
import type { BucketSource } from "@/lib/bucket/bucketItem";
import { BUCKET_SOURCE_LABELS } from "@/lib/bucket/source-labels";
import { bucketAdded } from "@/lib/toast/bucket";

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
  venueName?: string;
  numChildren?: number;
  hasPdfChild: boolean;
};

export function ZoteroSelector({ paperLimit }: { paperLimit?: number }) {
  const toast = useAppToast();
  const t = useTranslations('zotero');
  const tToast = useTranslations("toast");
  const te = useTranslations('extraction');
  const tc = useTranslations('common');
  const bucketAdd = useBucketStore((s) => s.addMany);
  const bucketRemoveMany = useBucketStore((s) => s.removeMany);
  const bucketOrder = useBucketStore((s) => s.order);
  const bucketKeys = useMemo(() => new Set(bucketOrder), [bucketOrder]);
  const dedupeKeys = useBucketStore((s) => s.dedupeKeys);
  const dedupeKeyToSource = useBucketStore((s) => s.dedupeKeyToSource);
  const livePaperLimit = useQuery(
    api.extraction.bucket.queries.getMyPaperLimit,
    paperLimit === undefined ? {} : "skip",
  );
  const resolvedPaperLimit = paperLimit ?? livePaperLimit ?? 1000;
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

  const getItemsKey = (pageIndex: number, previousPageData: { hasMore: boolean; nextCursor?: number; items: ZoteroItem[] } | null) => {
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

  const zoteroContext = useMemo(
    () => ({
      libraryType,
      groupId: libraryType === "group" ? groupId : undefined,
      zoteroUserId,
      collectionKey,
    }),
    [libraryType, groupId, zoteroUserId, collectionKey],
  );
  const toBucketItems = (items: ZoteroItem[]) =>
    items.map((item) =>
      fromZoteroItem(
        {
          itemKey: item.key,
          title: item.title,
          authors: item.authors,
          year: item.year,
          doi: item.doi,
          abstract: item.abstract,
          venueName: item.venueName,
          workType: item.itemType,
        },
        zoteroContext,
      ),
    );
  const addItems = (items: ZoteroItem[], silent = false) => {
    bucketAdded(bucketAdd(toBucketItems(items), resolvedPaperLimit), { silent });
  };
  const removeItems = (items: ZoteroItem[]) => {
    bucketRemoveMany(toBucketItems(items).map((b) => b.bucketKey));
  };

  // Zotero can't fetch "all across pages" in one shot — the REST API is
  // cursor-paginated with 50-item pages. Drive setSize() in a loop until
  // the server runs out, the plan cap is reached, or the user cancels.
  const cancelAllAcrossRef = useRef(false);
  const selectAllAcross = async () => {
    cancelAllAcrossRef.current = false;
    const result = await collectAllPages({
      initialPages: items.data ?? [],
      fetchNext: (size) => items.setSize(size),
      cap: resolvedPaperLimit,
      isCancelled: () => cancelAllAcrossRef.current,
    });
    if (result.cancelled) return;
    const all = result.pages.flatMap((p) => p.items ?? []);
    const added = bucketAdd(toBucketItems(all), resolvedPaperLimit);
    bucketAdded({ ...added, truncated: result.truncated });
  };
  const cancelSelectAllAcross = () => {
    cancelAllAcrossRef.current = true;
  };
  const isItemSelected = (item: ZoteroItem) =>
    bucketKeys.has(
      zoteroBucketKeyFor({
        title: item.title,
        year: item.year,
        doi: item.doi,
      }),
    );
  const alsoStagedFrom = (item: ZoteroItem): BucketSource | null => {
    const weakKey = zoteroBucketKeyFor({
      title: item.title,
      year: item.year,
      doi: item.doi,
    });
    // Zotero's bucketKey IS the weak dedupe key. If it's already in the
    // bucket (isItemSelected === true) this branch isn't entered by the
    // caller anyway. Any dedupe hit pointing back at zotero is the same
    // item — skip so we don't show "Also staged from Zotero" on Zotero.
    if (!dedupeKeys.has(weakKey)) return null;
    const src = dedupeKeyToSource[weakKey];
    return src && src !== "zotero" ? src : null;
  };
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
    // Shape matches the connected-state header (library-type select +
    // collection cascader) so the layout doesn't shift when auth resolves.
    return (
      <div className="space-y-4" aria-busy="true" aria-live="polite">
        <span className="sr-only">{t('loadingStatus')}</span>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonBar className="h-9 w-full rounded-md" />
          <SkeletonBar className="h-9 w-full rounded-md sm:col-span-2 lg:col-span-1" />
        </div>
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
                  toast.error(t('signInToConnect'), undefined, {
                    label: tc('signIn'),
                    onClick: () => {
                      window.location.href = '/sign-in';
                    },
                    icon: 'arrow-right',
                  });
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
              <ZoteroIcon className="size-4 shrink-0" aria-hidden />
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
            }}
          />
        </div>

        {collectionKey && (
          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={includeDescendants}
              onCheckedChange={(checked) => {
                setIncludeDescendants(checked === true);
              }}
            />
            Include items from subcollections
          </label>
        )}

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

      {flattenedItems.length > 0 && (
        <SelectableList<ZoteroItem>
          items={flattenedItems}
          keyOf={(item) => item.key}
          isSelected={isItemSelected}
          onToggle={(item, next) =>
            next ? addItems([item], true) : removeItems([item])
          }
          onToggleRange={(rangeItems, next) =>
            next ? addItems(rangeItems) : removeItems(rangeItems)
          }
          onToggleAll={(next) =>
            next ? addItems(flattenedItems) : removeItems(flattenedItems)
          }
          onSelectAllAcross={selectAllAcross}
          onCancelSelectAllAcross={cancelSelectAllAcross}
          hasMore={!isReachingEnd}
          renderRow={(item) => {
            const alsoFrom = isItemSelected(item)
              ? null
              : alsoStagedFrom(item);
            return (
              <div>
                <p className="font-medium text-foreground truncate">
                  {item.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.authors.slice(0, 3).join(", ") || te("unknownAuthors")}
                  {item.year ? `, ${item.year}` : ""}
                </p>
                {item.hasPdfChild && (
                  <div className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Paperclip className="h-3 w-3" /> {tc("pdfAttached")}
                  </div>
                )}
                {alsoFrom && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Also staged from {BUCKET_SOURCE_LABELS[alsoFrom]}
                  </p>
                )}
              </div>
            );
          }}
        />
      )}
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
