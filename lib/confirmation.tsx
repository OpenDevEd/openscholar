import { showConfirmationToast } from "@/components/ui/sonner";

/**
 * Universal Confirmation Toast Component
 * 
 * Usage Examples:
 * 
 * // Basic confirmation
 * showConfirmation({
 *   title: "Delete File",
 *   message: "Are you sure you want to delete this file?",
 *   onConfirm: () => deleteFile()
 * });
 * 
 * // Custom button text and variant
 * showConfirmation({
 *   title: "Save Changes",
 *   message: "Do you want to save your changes?",
 *   confirmText: "Save",
 *   cancelText: "Discard",
 *   variant: 'default',
 *   onConfirm: () => saveChanges(),
 *   onCancel: () => discardChanges()
 * });
 * 
 * // Using convenience functions
 * confirmDelete("My Document", () => deleteDocument());
 * confirmClearAll(25, "Search Entries", () => clearAll());
 * confirmAction("publish this post", () => publishPost());
 */

interface ConfirmationOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'destructive' | 'default';
  onConfirm: () => void;
  onCancel?: () => void;
}

export const showConfirmation = ({
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = 'destructive',
  onConfirm,
  onCancel
}: ConfirmationOptions) => {
  showConfirmationToast({
    title,
    description: message,
    confirmText,
    cancelText,
    variant,
    onConfirm,
    onCancel
  });
};

// Convenience function for delete confirmations
export const confirmDelete = (
  itemName: string,
  onConfirm: () => void,
  options?: { confirmText?: string; cancelText?: string }
) => {
  showConfirmation({
    title: `Delete ${itemName}`,
    message: `Are you sure you want to delete "${itemName}"? This action cannot be undone.`,
    confirmText: options?.confirmText || "Delete",
    cancelText: options?.cancelText || "Cancel",
    variant: 'destructive',
    onConfirm
  });
};

// Convenience function for clear all confirmations
export const confirmClearAll = (
  count: number,
  itemType: string,
  onConfirm: () => void,
  options?: { confirmText?: string; cancelText?: string }
) => {
  showConfirmation({
    title: `Clear All ${itemType}`,
    message: `Are you sure you want to delete all ${count} ${itemType}? This action cannot be undone.`,
    confirmText: options?.confirmText || "Clear All",
    cancelText: options?.cancelText || "Cancel",
    variant: 'destructive',
    onConfirm
  });
};

// Convenience function for action confirmations (non-destructive)
export const confirmAction = (
  actionDescription: string,
  onConfirm: () => void,
  options?: { title?: string; confirmText?: string; cancelText?: string }
) => {
  showConfirmation({
    title: options?.title || "Confirm Action",
    message: `Are you sure you want to ${actionDescription}?`,
    confirmText: options?.confirmText || "Confirm",
    cancelText: options?.cancelText || "Cancel",
    variant: 'default',
    onConfirm
  });
};
