import { List, LayoutList, LayoutGrid, Grid3X3, type AppIcon } from "@/components/icons";
import type { ViewMode } from "@/lib/types";

/** The views a list can offer; `label` is a key in the `viewMode` messages. */
export const VIEW_MODE_OPTIONS = [
  { mode: "list-simple", icon: List, label: "simpleList" },
  { mode: "list-detail", icon: LayoutList, label: "detailedList" },
  { mode: "grid-2", icon: LayoutGrid, label: "twoColumnGrid" },
  { mode: "grid-3", icon: Grid3X3, label: "threeColumnGrid" },
] as const satisfies readonly { mode: ViewMode; icon: AppIcon; label: string }[];

/**
 * Grid/flex layout classes for each view mode
 */
export const GRID_CLASSES: Record<ViewMode, string> = {
  "list-simple": "flex flex-col gap-2",
  "list-detail": "flex flex-col gap-4",
  "grid-2": "grid grid-cols-1 md:grid-cols-2 gap-4",
  "grid-3": "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3",
};

/**
 * Default items per page for paginated command centers
 */
export const COMMAND_CENTER_ITEMS_PER_PAGE = 12;
