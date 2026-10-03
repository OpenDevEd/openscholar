"use client";

import { AlertCircle, AlertTriangle, Info, type LucideIcon } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Section card with a header strip, the same shape the settings pages use
 * (`app/settings/ai/page.tsx:321-331`).
 */
export function SectionCard({
  id,
  icon: Icon,
  title,
  description,
  aside,
  tone = "default",
  className,
  bodyClassName,
  children,
  ...rest
}: Omit<React.HTMLAttributes<HTMLElement>, "title"> & {
  id?: string;
  icon?: LucideIcon | React.ComponentType<{ className?: string }>;
  title: ReactNode;
  description?: ReactNode;
  /** Right-hand slot in the header strip, such as a status chip. */
  aside?: ReactNode;
  tone?: "default" | "danger";
  bodyClassName?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "overflow-hidden rounded-2xl border-2",
        tone === "danger" ? "border-destructive/30" : "border-border/60",
        className,
      )}
      {...rest}
    >
      <div
        className={cn(
          "space-y-1 border-b px-4 py-3",
          tone === "danger"
            ? "border-destructive/20 bg-destructive/5"
            : "border-border/50 bg-muted/30",
        )}
      >
        <div className="flex flex-wrap items-center gap-2.5">
          {Icon ? (
            <Icon
              className={cn(
                "h-4 w-4 shrink-0",
                tone === "danger" ? "text-destructive" : "text-primary",
              )}
            />
          ) : null}
          <h3
            className={cn(
              "flex-1 text-base font-semibold",
              tone === "danger" && "text-destructive",
            )}
          >
            {title}
          </h3>
          {aside}
        </div>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className={cn("space-y-4 p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Inline error block under a field (`app/settings/ai/page.tsx:390-393`). */
export function FieldError({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-2.5",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs text-destructive">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{children}</span>
      </div>
      {action}
    </div>
  );
}

/**
 * Inline notice banner. Warning and info follow the raw-palette recipe used
 * in `app/connect/page.tsx:152` and `components/Pricing.tsx:725`.
 */
export function InlineNotice({
  tone,
  title,
  children,
  action,
  className,
  ...rest
}: Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & {
  tone: "warning" | "info" | "danger";
  title?: ReactNode;
  action?: ReactNode;
}) {
  const Icon = tone === "info" ? Info : tone === "danger" ? AlertCircle : AlertTriangle;
  return (
    <div
      className={cn(
        "flex flex-wrap items-start gap-3 rounded-lg border p-3 text-sm",
        tone === "warning" && "border-warning/30 bg-warning/5 ink-warning",
        tone === "info" && "border-info/20 bg-info/10 ink-info",
        tone === "danger" && "border-destructive/20 bg-destructive/5 text-destructive",
        className,
      )}
      {...rest}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="font-medium">{title}</p> : null}
        <div className={cn("text-xs", title ? "opacity-90" : "text-sm")}>{children}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** The id of the label `Field` renders for a control id. Lets non-form controls point at it with `aria-labelledby`. */
export const labelId = (controlId: string) => `${controlId}-label`;

/** Label, control, help or error text, spaced like the settings forms. */
export function Field({
  label,
  hint,
  error,
  counter,
  suffix,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode | null;
  counter?: ReactNode;
  suffix?: ReactNode;
  className?: string;
  children: (id: string, invalid: boolean) => ReactNode;
}) {
  const id = useId();
  const invalid = Boolean(error);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <Label id={labelId(id)} htmlFor={id} className="font-normal">
          {label}
          {suffix ? (
            <span className="text-xs leading-none text-muted-foreground">{suffix}</span>
          ) : null}
        </Label>
        {counter ? (
          <span className="text-xs font-mono text-muted-foreground">{counter}</span>
        ) : null}
      </div>
      {children(id, invalid)}
      {error ? (
        <FieldError>{error}</FieldError>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
