import { List, LayoutList, LayoutGrid, Grid3X3 } from "lucide-react";
import type { ViewMode } from "@/lib/types";
import type { LucideIcon } from "lucide-react";

export interface ViewModeOption {
  mode: ViewMode;
  icon: LucideIcon;
  label: string;
}

/**
 * Shared view mode options for command centers (bookmarks, history, etc.)
 */
export const VIEW_MODE_OPTIONS: ViewModeOption[] = [
  { mode: "list-simple", icon: List, label: "Simple List" },
  { mode: "list-detail", icon: LayoutList, label: "Detailed List" },
  { mode: "grid-2", icon: LayoutGrid, label: "2 Column Grid" },
  { mode: "grid-3", icon: Grid3X3, label: "3 Column Grid" },
];

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
