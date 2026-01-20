"use client";

import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  FolderOpen,
  Users,
  FileText,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Check,
  RefreshCw,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";

interface SourceZoteroProps {
  analysisId: Id<"analyses">;
  onSuccess?: () => void;
}

type ZoteroCollection = {
  key: string;
  name: string;
  parentCollection: string | null;
  numItems: number;
};

type ZoteroGroup = {
  id: string;
  name: string;
  type: string;
  numItems: number;
};

type ZoteroItem = {
  key: string;
  title: string;
  abstract?: string;
  authors: string[];
  year?: number;
  doi?: string;
  itemType: string;
};

type BrowseLocation = {
  type: "library" | "group" | "collection";
  groupId?: string;
  groupName?: string;
  collectionKey?: string;
  collectionName?: string;
};

export function SourceZotero({ analysisId, onSuccess }: SourceZoteroProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Navigation state
  const [browseLocation, setBrowseLocation] = useState<BrowseLocation>({
    type: "library",
  });
  const [breadcrumbs, setBreadcrumbs] = useState<
    { label: string; location: BrowseLocation }[]
  >([{ label: "My Library", location: { type: "library" } }]);

  // Data state
  const [collections, setCollections] = useState<ZoteroCollection[]>([]);
  const [groups, setGroups] = useState<ZoteroGroup[]>([]);
  const [items, setItems] = useState<ZoteroItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // Convex
  const currentUser = useQuery(api.users.queries.me);
  const connectionStatus = useQuery(api.zotero.queries.getConnectionStatus);
  const startOAuth = useAction(api.zotero.actions.startOAuth);
  const fetchCollections = useAction(api.zotero.actions.fetchCollections);
  const fetchGroups = useAction(api.zotero.actions.fetchGroups);
  const fetchItems = useAction(api.zotero.actions.fetchItems);
  const disconnectZotero = useMutation(api.zotero.mutations.disconnect);
  const importFromZotero = useMutation(api.extraction.sources.importFromZotero);

  const isConnected = connectionStatus?.connected === true;

  // Load data when location changes
  useEffect(() => {
    if (!isConnected || !currentUser) return;
    loadData();
  }, [isConnected, currentUser, browseLocation]);

  const loadData = async () => {
    if (!currentUser) return;
    setIsLoading(true);
    setItems([]);
    setCollections([]);

    try {
      // Always fetch collections for current location
      const cols = await fetchCollections({
        userId: currentUser._id,
        groupId: browseLocation.groupId,
      });

      // Filter to show only collections at current level
      const parentKey = browseLocation.collectionKey || null;
      const filteredCols = cols.filter(
        (c) => c.parentCollection === parentKey
      );
      setCollections(filteredCols);

      // Fetch groups only at library root
      if (browseLocation.type === "library" && !browseLocation.collectionKey) {
        const grps = await fetchGroups({ userId: currentUser._id });
        setGroups(grps);
      } else {
        setGroups([]);
      }

      // Fetch items at current location
      const result = await fetchItems({
        userId: currentUser._id,
        collectionKey: browseLocation.collectionKey,
        groupId: browseLocation.groupId,
        limit: 100,
      });
      setItems(result.items);
      setTotalItems(result.totalResults);
    } catch (error: any) {
      console.error("Failed to load Zotero data:", error);
      toast.error(error.message || "Failed to load Zotero data");
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = async () => {
    if (!currentUser) return;
    setIsConnecting(true);

    try {
      // Use the Convex Site URL for the callback.
      // For self-hosted Convex, this is usually port 3211.
      // For cloud Convex, it's https://your-app.convex.site.
      const convexSiteUrl =
        process.env.NEXT_PUBLIC_CONVEX_SITE_URL ||
        (process.env.NEXT_PUBLIC_CONVEX_URL?.includes("127.0.0.1")
          ? process.env.NEXT_PUBLIC_CONVEX_URL.replace(":3210", ":3211")
          : process.env.NEXT_PUBLIC_CONVEX_URL?.replace(".cloud", ".site"));

      const callbackUrl = `${convexSiteUrl}/api/zotero/callback`;
      
      const result = await startOAuth({
        userId: currentUser._id,
        callbackUrl,
      });

      // Open Zotero auth in new window
      window.open(result.authorizeUrl, "_blank", "width=600,height=700");

      toast.info("Complete authorization in the Zotero window, then refresh this page.");
    } catch (error: any) {
      console.error("OAuth start failed:", error);
      toast.error(error.message || "Failed to start Zotero connection");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectZotero({});
      toast.success("Zotero disconnected");
    } catch (error: any) {
      toast.error(error.message || "Failed to disconnect");
    }
  };

  const navigateToCollection = (collection: ZoteroCollection) => {
    const newLocation: BrowseLocation = {
      type: "collection",
      groupId: browseLocation.groupId,
      groupName: browseLocation.groupName,
      collectionKey: collection.key,
      collectionName: collection.name,
    };
    setBrowseLocation(newLocation);
    setBreadcrumbs((prev) => [
      ...prev,
      { label: collection.name, location: newLocation },
    ]);
    setSelectedItems(new Set());
  };

  const navigateToGroup = (group: ZoteroGroup) => {
    const newLocation: BrowseLocation = {
      type: "group",
      groupId: group.id,
      groupName: group.name,
    };
    setBrowseLocation(newLocation);
    setBreadcrumbs([
      { label: "My Library", location: { type: "library" } },
      { label: group.name, location: newLocation },
    ]);
    setSelectedItems(new Set());
  };

  const navigateToBreadcrumb = (index: number) => {
    const crumb = breadcrumbs[index];
    setBrowseLocation(crumb.location);
    setBreadcrumbs(breadcrumbs.slice(0, index + 1));
    setSelectedItems(new Set());
  };

  const toggleItemSelection = (key: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (selectedItems.size === items.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(items.map((i) => i.key)));
    }
  };

  const handleImport = async () => {
    if (selectedItems.size === 0) return;

    setIsImporting(true);
    try {
      const selectedItemsData = items
        .filter((i) => selectedItems.has(i.key))
        .map((i) => ({
          key: i.key,
          title: i.title,
          abstract: i.abstract,
          authors: i.authors,
          year: i.year,
          doi: i.doi,
        }));

      const result = await importFromZotero({
        analysisId,
        collectionKey: browseLocation.collectionKey,
        collectionName: browseLocation.collectionName,
        groupId: browseLocation.groupId,
        groupName: browseLocation.groupName,
        items: selectedItemsData,
      });

      toast.success(`Imported ${result.documentCount} documents from Zotero`);
      setSelectedItems(new Set());
      onSuccess?.();
    } catch (error: any) {
      console.error("Import failed:", error);
      toast.error(error.message || "Failed to import from Zotero");
    } finally {
      setIsImporting(false);
    }
  };

  // Not connected state
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] gap-4">
        <div className="p-4 rounded-full bg-muted">
          <FileText className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="text-center space-y-2">
          <h3 className="font-medium">Connect to Zotero</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Connect your Zotero account to import references from your library
            and collections.
          </p>
        </div>
        <Button onClick={handleConnect} disabled={isConnecting}>
          {isConnecting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          <ExternalLink className="h-4 w-4 mr-2" />
          Connect Zotero
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[400px]">
      {/* Header with breadcrumbs and actions */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-1 text-sm overflow-x-auto">
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <button
                onClick={() => navigateToBreadcrumb(i)}
                className={cn(
                  "hover:underline whitespace-nowrap",
                  i === breadcrumbs.length - 1
                    ? "font-medium"
                    : "text-muted-foreground"
                )}
              >
                {crumb.label}
              </button>
            </React.Fragment>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={loadData}
            disabled={isLoading}
          >
            <RefreshCw
              className={cn("h-4 w-4", isLoading && "animate-spin")}
            />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDisconnect}
            className="text-muted-foreground"
          >
            <Unlink className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 border rounded-lg">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {/* Groups (only at library root) */}
            {groups.map((group) => (
              <button
                key={group.id}
                onClick={() => navigateToGroup(group)}
                className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 text-left"
              >
                <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">{group.name}</span>
                <span className="text-xs text-muted-foreground">
                  {group.numItems} items
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}

            {/* Collections */}
            {collections.map((collection) => (
              <button
                key={collection.key}
                onClick={() => navigateToCollection(collection)}
                className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 text-left"
              >
                <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">{collection.name}</span>
                <span className="text-xs text-muted-foreground">
                  {collection.numItems} items
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}

            {/* Divider if we have both folders and items */}
            {(groups.length > 0 || collections.length > 0) &&
              items.length > 0 && <div className="border-t my-2" />}

            {/* Items */}
            {items.map((item) => {
              const isSelected = selectedItems.has(item.key);
              return (
                <button
                  key={item.key}
                  onClick={() => toggleItemSelection(item.key)}
                  className={cn(
                    "w-full flex items-start gap-3 p-2 rounded-lg text-left transition-colors",
                    isSelected
                      ? "bg-primary/10 border border-primary/30"
                      : "hover:bg-muted/50"
                  )}
                >
                  <div
                    className={cn(
                      "mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0",
                      isSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-muted-foreground/30"
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{item.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {item.authors.slice(0, 3).join(", ")}
                      {item.authors.length > 3 && " et al."}
                      {item.year && ` (${item.year})`}
                    </p>
                  </div>
                </button>
              );
            })}

            {/* Empty state */}
            {groups.length === 0 &&
              collections.length === 0 &&
              items.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <FileText className="h-8 w-8 mb-2" />
                  <p className="text-sm">No items found</p>
                </div>
              )}
          </div>
        )}
      </ScrollArea>

      {/* Actions */}
      <div className="flex items-center justify-between pt-4 border-t mt-4">
        <div className="flex items-center gap-3">
          {items.length > 0 && (
            <Button variant="ghost" size="sm" onClick={selectAll}>
              {selectedItems.size === items.length ? "Deselect All" : "Select All"}
            </Button>
          )}
          <p className="text-sm text-muted-foreground">
            {selectedItems.size > 0
              ? `${selectedItems.size} of ${items.length} selected`
              : `${totalItems} items total`}
          </p>
        </div>
        <Button
          onClick={handleImport}
          disabled={selectedItems.size === 0 || isImporting}
        >
          {isImporting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Import {selectedItems.size > 0 && `(${selectedItems.size})`}
        </Button>
      </div>
    </div>
  );
}
