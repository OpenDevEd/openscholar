import { toast } from "sonner";

/**
 * Centralized toast utilities for consistent messaging across the app.
 * Reduces repetitive toast.success/toast.error calls with the same strings.
 */
export const toasts = {
  clipboard: {
    copied: (item = "item") => toast.success(`${item} copied to clipboard`),
    queryCopied: () => toast.success("Query copied to clipboard"),
    expansionCopied: () => toast.success("Expansion copied to clipboard"),
  },

  download: {
    success: (count: number, type: string, format: string) =>
      toast.success(`Downloaded ${count} ${type} as ${format}`),
    error: (format: string) => toast.error(`Failed to download ${format} file`),
  },

  upload: {
    success: (count: number, type: string) =>
      toast.success(`Successfully imported ${count} ${type}`),
    noValid: (type: string) =>
      toast.warning(`No valid ${type} found in the file`),
    error: (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : "Failed to upload file"
      ),
  },

  bookmark: {
    nameRequired: () => toast.error("Bookmark name is required"),
    invalidChars: () => toast.error("Only letters, numbers, and dashes allowed"),
    exists: (name: string) => toast.error(`Bookmark "${name}" already exists`),
    saved: (name: string) => toast.success(`Saved as bookmark "${name}"`),
  },

  history: {
    deleted: () => toast.success("Search entry deleted"),
    cleared: () => toast.success("All search history cleared"),
  },

  bookmarks: {
    cleared: () => toast.success("All bookmarks cleared"),
  },

  generic: {
    cleared: (type: string) => toast.success(`All ${type} cleared`),
    deleted: (type: string) => toast.success(`${type} deleted`),
  },
};
