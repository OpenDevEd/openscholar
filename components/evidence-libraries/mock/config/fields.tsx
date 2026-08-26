"use client";

/**
 * Shared controls for the configuration mock. All of them follow the look of
 * the settings pages: `bg-background` inputs, `rounded-lg border-border/50`
 * rows, `bg-muted/30` surfaces, dashed drop zones like the PDF uploader.
 */

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Check,
  FileText,
  GripVertical,
  ImageIcon,
  Lock,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  COLOUR_PRESETS,
  contrastRatio,
  FILE_LIMITS,
  type FileKind,
  formatBytes,
  HEX,
  type MockFile,
} from "@/lib/evidence-libraries/mock/config";
import { useEvidenceLibraryMockStore } from "@/lib/evidence-libraries/mock/store";
import { Field, FieldError } from "../section-card";

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

export function UploadField({
  label,
  hint,
  kind,
  value,
  onChange,
  required,
  optional,
  className,
  slot,
}: {
  label: ReactNode;
  hint?: ReactNode;
  kind: FileKind;
  value: MockFile | null;
  onChange: (file: MockFile | null) => void;
  /** Show the "missing" error when empty. */
  required?: boolean;
  optional?: boolean;
  className?: string;
  /** Unique key for the progress slot. */
  slot: string;
}) {
  const t = useTranslations("evidenceLibraryMock.fields");
  const uploadFile = useEvidenceLibraryMockStore((s) => s.uploadFile);
  const percent = useEvidenceLibraryMockStore((s) => s.uploads[slot]);
  const [error, setError] = useState<"type" | "size" | null>(null);
  const limit = FILE_LIMITS[kind];
  const uploading = percent !== undefined;

  async function handleFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    setError(null);
    const result = await uploadFile(slot, kind, file);
    if (result.ok) {
      onChange(result.file);
    } else {
      setError(result.error);
    }
  }

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    multiple: false,
    noClick: Boolean(value),
    disabled: uploading,
    onDrop: handleFiles,
  });

  const accepts = kind === "legal" ? ".md, .txt" : kind === "shareImage" ? "PNG" : "SVG, PNG, WEBP";
  const errorText =
    error === "type"
      ? t("wrongType", { accepts })
      : error === "size"
        ? t("tooBig", { max: formatBytes(limit.maxBytes) })
        : required && !value && !uploading
          ? t("required")
          : null;

  return (
    <Field
      label={label}
      hint={hint ?? t("limits", { accepts, max: formatBytes(limit.maxBytes) })}
      error={errorText}
      suffix={optional ? t("optional") : undefined}
      className={className}
    >
      {(id, invalid) => (
        <div
          {...getRootProps()}
          data-upload-state={uploading ? "uploading" : value ? "filled" : "empty"}
          aria-invalid={invalid || undefined}
          className={cn(
            "rounded-xl border-2 border-dashed transition-colors",
            isDragActive
              ? "border-primary bg-primary/5"
              : invalid
                ? "border-destructive/40"
                : "border-border/60",
            !value && !uploading && "cursor-pointer hover:border-primary/50 hover:bg-muted/30",
          )}
        >
          <input {...getInputProps()} id={id} />
          {uploading ? (
            <div className="space-y-2 p-4">
              <p className="text-sm font-medium">{t("uploading", { percent })}</p>
              <Progress value={percent} />
            </div>
          ) : value ? (
            <div className="flex items-center gap-3 p-3">
              <FileThumb file={value} kind={kind} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{value.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(value.size)}</p>
              </div>
              {kind === "legal" && value.text !== undefined ? (
                <TextFileViewer file={value} />
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={open}>
                {t("replace")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("remove")}
                onClick={() => onChange(null)}
              >
                <X />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-4 text-center sm:text-left">
              <Upload className="h-5 w-5 shrink-0 text-muted-foreground" />
              <p className="text-sm">
                <span className="font-medium">{isDragActive ? t("dropHere") : t("dropOrClick")}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </Field>
  );
}

function FileThumb({ file, kind }: { file: MockFile; kind: FileKind }) {
  if (kind === "legal") {
    return (
      <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/30">
        <FileText className="h-5 w-5 text-muted-foreground" />
      </span>
    );
  }
  return (
    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:12px_12px]">
      {file.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={file.url} alt="" className="max-h-full max-w-full object-contain" />
      ) : (
        <ImageIcon className="h-5 w-5 text-muted-foreground" />
      )}
    </span>
  );
}

function TextFileViewer({ file }: { file: MockFile }) {
  const t = useTranslations("evidenceLibraryMock.fields");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          {t("view")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="border-b border-border/50 bg-muted/30 px-3 py-2 text-xs font-medium">
          {file.name}
        </div>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-3 font-sans text-xs">
          {file.text}
        </pre>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Colour                                                              */
/* ------------------------------------------------------------------ */

export function ColourField({
  label,
  hint,
  value,
  onChange,
  contrastAgainst,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** Background colours; warns when the colour fails WCAG AA (4.5:1) on all of them. */
  contrastAgainst?: string[];
  className?: string;
}) {
  const t = useTranslations("evidenceLibraryMock.fields");
  const valid = HEX.test(value);
  // Warn only when the colour fails on every background, like the runtime check.
  const backgrounds = contrastAgainst ?? [];
  const low =
    valid && backgrounds.length > 0 && backgrounds.every((bg) => contrastRatio(value, bg) < 4.5)
      ? backgrounds
      : [];
  return (
    <Field
      label={label}
      hint={hint}
      error={!valid ? t("badHex") : null}
      className={className}
    >
      {(id, invalid) => (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t("pickColour")}
                  className="size-9 shrink-0 rounded-md border border-border/50 shadow-xs"
                  style={{ background: valid ? value : "transparent" }}
                />
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 space-y-3">
                <input
                  type="color"
                  aria-label={t("pickColour")}
                  value={valid ? value : "#000000"}
                  onChange={(e) => onChange(e.target.value)}
                  className="h-10 w-full cursor-pointer rounded-md border border-border/50 bg-background p-0.5"
                />
                <div className="grid grid-cols-8 gap-1.5">
                  {COLOUR_PRESETS.map((p) => (
                    <Tooltip key={p.name}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={p.name}
                          onClick={() => onChange(p.accent)}
                          className="flex size-6 items-center justify-center rounded-md border border-border/40"
                          style={{ background: p.accent }}
                        >
                          {p.accent.toLowerCase() === value.toLowerCase() ? (
                            <Check className="h-3 w-3 text-white" />
                          ) : null}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{p.name}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Input
              id={id}
              className="bg-background font-mono text-sm"
              value={value}
              aria-invalid={invalid || undefined}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
          {low.length > 0 ? (
            <p role="status" className="text-xs text-amber-700 dark:text-amber-400" data-contrast="low">
              {t("lowContrast", { ratio: contrastRatio(value, low[0]).toFixed(1) })}
            </p>
          ) : null}
        </div>
      )}
    </Field>
  );
}

/* ------------------------------------------------------------------ */
/* Toggle row                                                          */
/* ------------------------------------------------------------------ */

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
  disabledReason,
  locked,
  className,
  ...rest
}: Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> & {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  disabledReason?: ReactNode;
  /** Switch is shown but cannot change. */
  locked?: boolean;
}) {
  const id = useId();
  const control = (
    <Switch
      id={id}
      checked={checked}
      disabled={disabled || locked}
      onCheckedChange={onChange}
      aria-describedby={hint ? `${id}-hint` : undefined}
    />
  );
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5",
        disabled || locked
          ? "cursor-not-allowed border-dashed border-border/60 bg-muted/40 text-muted-foreground"
          : "border-border/50 bg-background",
        className,
      )}
      data-checked={checked}
      data-disabled={disabled || locked || undefined}
      {...rest}
    >
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        {hint ? (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        ) : null}
        {disabled && disabledReason ? (
          <p className="text-xs text-amber-700 dark:text-amber-400" data-reason>
            {disabledReason}
          </p>
        ) : null}
      </div>
      {locked && disabledReason ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {control}
            </span>
          </TooltipTrigger>
          <TooltipContent>{disabledReason}</TooltipContent>
        </Tooltip>
      ) : (
        control
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

/**
 * Drag-and-drop list. Wrap the rows; each row is a `ListRow` with a matching
 * `id`. Uses dnd-kit (pointer + keyboard sensors) and calls `onMove(from, to)`.
 */
export function SortableList({
  ids,
  onMove,
  children,
  className,
}: {
  ids: string[];
  onMove: (from: number, to: number) => void;
  children: ReactNode;
  className?: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }: DragEndEvent) => {
        if (!over || active.id === over.id) return;
        onMove(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className={cn("space-y-2", className)}>{children}</div>
      </SortableContext>
    </DndContext>
  );
}

/** Row chrome for editable list items: surface, drag handle, remove. Must sit inside `SortableList`. */
export function ListRow({
  id,
  onRemove,
  removeLabel,
  hideRemove,
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  id: string;
  onRemove: () => void;
  removeLabel: string;
  /** Rows that can be reordered but not removed (for example collections from Zotero). */
  hideRemove?: boolean;
}) {
  const t = useTranslations("evidenceLibraryMock.fields");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-dragging={isDragging || undefined}
      className={cn(
        "flex items-start gap-2 rounded-lg border border-border/50 bg-background p-3",
        isDragging && "relative z-10 shadow-lg",
        className,
      )}
      {...rest}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label={t("dragHandle")}
        className="mt-1 shrink-0 cursor-grab touch-none rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1 space-y-3">{children}</div>
      {hideRemove ? null : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={removeLabel}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

export function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function AddButton({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={disabled}>
      <Plus />
      {children}
    </Button>
  );
}

export function EmptyList({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Chips                                                               */
/* ------------------------------------------------------------------ */

export function ChipInput({
  label,
  hint,
  values,
  onChange,
  placeholder,
  error,
}: {
  label: ReactNode;
  hint?: ReactNode;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  error?: ReactNode | null;
}) {
  const t = useTranslations("evidenceLibraryMock.fields");
  const [text, setText] = useState("");
  function commit() {
    const v = text.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setText("");
  }
  return (
    <Field label={label} hint={hint} error={error}>
      {(id, invalid) => (
        <div
          className={cn(
            "flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5",
            invalid && "border-destructive/50",
          )}
        >
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-xs"
            >
              {v}
              <button
                type="button"
                aria-label={t("removeChip", { value: v })}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            id={id}
            value={text}
            placeholder={placeholder}
            className="min-w-24 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground"
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                commit();
              }
              if (e.key === "Backspace" && !text && values.length) {
                onChange(values.slice(0, -1));
              }
            }}
          />
        </div>
      )}
    </Field>
  );
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

/** A value the owner cannot change. Looks fixed: dashed, muted, with a lock. */
export function ReadOnlyValue({
  id,
  value,
  mono = true,
  className,
}: {
  id?: string;
  value: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  const t = useTranslations("evidenceLibraryMock.fields");
  return (
    <div
      id={id}
      role="textbox"
      aria-readonly="true"
      tabIndex={0}
      title={t("fixed")}
      className={cn(
        "flex h-9 w-full cursor-default items-center gap-2 rounded-md border border-dashed border-border/60 bg-muted/40 px-3 text-sm text-muted-foreground",
        mono && "font-mono",
        className,
      )}
    >
      <span className="min-w-0 flex-1 truncate">{value}</span>
      <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
    </div>
  );
}

export function ResetButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations("evidenceLibraryMock.fields");
  return (
    <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onClick} data-reset>
      <RotateCcw className="h-3.5 w-3.5" />
      {t("reset")}
    </Button>
  );
}

/** Small subsection heading inside a card. */
export function SubHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}

export { FieldError };
