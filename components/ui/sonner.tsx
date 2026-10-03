"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, ToasterProps, toast } from "sonner";
import { AlertCircle, ArrowRight, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastAction = {
  label: string;
  onClick: () => void;
  icon?: "settings" | "arrow-right";
  secondaryAction?: {
    label: string;
    onClick: () => void;
    icon?: "settings" | "arrow-right";
  };
};

function CustomToast({
  title,
  description,
  action,
  closeToast,
}: {
  title: string;
  description?: string;
  action?: ToastAction;
  closeToast: () => void;
}) {
  const ActionIcon = action?.icon === "settings" ? Settings : ArrowRight;

  return (
    <div
      className={cn(
        "relative flex min-w-[300px] max-w-[400px] items-start gap-3 overflow-hidden rounded-xl border p-3 pl-5",
        "bg-[color-mix(in_oklab,var(--destructive)_8%,var(--background))] border-destructive/30",
        "shadow-md transition-shadow duration-200 ease-out hover:shadow-lg"
      )}
    >
      <div className="absolute left-0 top-1/2 h-[60%] w-[3px] -translate-y-1/2 rounded-r-sm bg-destructive" />

      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />

      <div className="flex min-w-0 flex-1 flex-col gap-1 pr-6">
        <span className="text-sm font-medium leading-tight text-foreground">{title}</span>
        {description ? (
          <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
        ) : null}
        {action ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => {
                action.onClick();
                closeToast();
              }}
              className={cn(
                "inline-flex h-7 w-fit items-center justify-center gap-1.5 rounded-md border-0 px-3 text-xs font-medium",
                "bg-primary text-primary-foreground transition-colors duration-150 hover:bg-primary-600",
                "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
            >
              <ActionIcon className="h-3 w-3" />
              {action.label}
            </button>
            {action.secondaryAction ? (() => {
              const SecondaryIcon = action.secondaryAction!.icon === "settings" ? Settings : ArrowRight;
              return (
                <button
                  onClick={() => {
                    action.secondaryAction!.onClick();
                    closeToast();
                  }}
                  className={cn(
                    "inline-flex h-7 w-fit items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium",
                    "bg-transparent text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground",
                    "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  )}
                >
                  <SecondaryIcon className="h-3 w-3" />
                  {action.secondaryAction!.label}
                </button>
              );
            })() : null}
          </div>
        ) : null}
      </div>

      <button
        onClick={closeToast}
        className={cn(
          "absolute right-2 top-2 flex h-6 w-6 scale-90 items-center justify-center rounded-md border-0 p-0",
          "bg-transparent text-muted-foreground opacity-0 transition-[opacity,scale,background-color,color] duration-150",
          "cursor-pointer hover:bg-accent hover:text-accent-foreground",
          "focus-visible:scale-100 focus-visible:opacity-100 focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "group-hover:scale-100 group-hover:opacity-100"
        )}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function showStyledToast(
  type: "error",
  title: string,
  options?: {
    description?: string;
    duration?: number;
    action?: ToastAction;
  }
) {
  return toast.custom(
    (t) => (
      <CustomToast
        title={title}
        description={options?.description}
        action={options?.action}
        closeToast={() => toast.dismiss(t)}
      />
    ),
    { duration: options?.duration ?? 4000 }
  );
}

/**
 * Wraps a modal's onInteractOutside so pressing a toast's button, such as Undo,
 * doesn't count as outside and close the modal.
 */
export function withToastsInside<Event extends { target: EventTarget | null; preventDefault(): void }>(
  handler?: (event: Event) => void,
) {
  return (event: Event) => {
    if (event.target instanceof Element && event.target.closest("[data-sonner-toaster]")) {
      event.preventDefault();
    }
    handler?.(event);
  };
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      // A modal blocks pointer events outside itself; toasts stay pressable above it.
      className="toaster group pointer-events-auto"
      position="bottom-right"
      visibleToasts={4}
      expand
      {...props}
    />
  );
};

export { Toaster };
