import { appToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { AlertTriangle, ShieldAlert } from "lucide-react";

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
  appToast.custom((t) => (
    <div
      className={cn(
        "relative w-[min(24rem,calc(100vw-1rem))] overflow-hidden rounded-xl border p-3.5 shadow-md",
        "bg-card/95 backdrop-blur-sm backdrop-saturate-150",
        "transition-all duration-150"
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-transparent" />
      <div className="pointer-events-none absolute left-1.5 top-2 bottom-2 w-[3px] rounded-full bg-gradient-to-b from-primary/70 to-primary" />

      <div className="relative grid grid-cols-[2.15rem_minmax(0,1fr)] gap-x-3 gap-y-2">
        <div
          className={cn(
            "mt-0.5 flex h-[2.15rem] w-[2.15rem] items-center justify-center rounded-[0.75rem] border",
            variant === "destructive"
              ? "border-destructive/25 bg-destructive/10 text-destructive"
              : "border-primary/25 bg-primary/12 text-primary"
          )}
        >
          {variant === "destructive" ? (
            <ShieldAlert className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
        </div>

        <div className="min-w-0 pr-6">
          <h4 className="text-[0.92rem] font-semibold leading-[1.3] tracking-[-0.01em] text-foreground">
            {title}
          </h4>
          <p className="mt-1 text-[0.8rem] leading-[1.45] text-muted-foreground">
            {message}
          </p>
        </div>

        <div className="col-span-2 mt-1 grid grid-cols-1 gap-2 sm:grid-cols-[auto_auto] sm:justify-end">
          <button
            onClick={() => {
              onCancel?.();
              appToast.dismiss(t);
            }}
            className={cn(
              "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border px-3 text-sm font-medium",
              "border-border bg-background text-foreground shadow-xs transition-all",
              "hover:-translate-y-px hover:bg-accent hover:text-accent-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
            )}
          >
            {cancelText}
          </button>
          <button
            onClick={() => {
              onConfirm();
              appToast.dismiss(t);
            }}
            className={cn(
              "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border px-3 text-sm font-medium",
              "shadow-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
              "hover:-translate-y-px",
              variant === 'destructive'
                ? 'border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
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
