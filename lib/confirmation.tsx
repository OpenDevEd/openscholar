import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  toast.custom((t) => (
    <div className="bg-background border border-border rounded-lg p-4 shadow-lg max-w-md">
      <div className="flex flex-col gap-3">
        <div>
          <h4 className="font-semibold text-foreground">{title}</h4>
          <p className="text-sm text-muted-foreground mt-1">{message}</p>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => {
              onCancel?.();
              toast.dismiss(t);
            }}
            className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-muted transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={() => {
              onConfirm();
              toast.dismiss(t);
            }}
            className={cn(
              "px-3 py-1.5 text-sm rounded-md transition-colors",
              variant === 'destructive'
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            )}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  ), {
    duration: Infinity,
  });
}; 