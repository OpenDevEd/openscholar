"use client";

/**
 * Shared controls for the configuration page. All of them follow the look of
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
  type LucideIcon,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Children, type ReactNode, useId, useState } from "react";
import { type DropzoneState, useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { HEX_COLOUR } from "@/lib/evidence-libraries/configuration/rules";
import { COLOUR_PRESETS, contrastRatio } from "./colours";
import { Field, FieldError, labelId } from "./section-card";
import {
  EVIDENCE_LIBRARY_UPLOAD_ACCEPT,
  EVIDENCE_LIBRARY_UPLOAD_LIMITS,
} from "@/lib/evidence-libraries/configuration/uploads";
import { fileNameFromUrl, type UploadError, type UploadKind } from "./upload-file";
import { useFileUploads } from "./use-file-uploads";

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${bytes / (1024 * 1024)} MB` : `${Math.round(bytes / 1024)} KB`;

export function UploadField({
  label,
  hint,
  kind,
  value,
  onChange,
  optional,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  kind: UploadKind;
  /** Public URL of the stored file, or null when empty. */
  value: string | null;
  onChange: (url: string | null) => void;
  optional?: boolean;
  className?: string;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.fields");
  const { uploadFile } = useFileUploads();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<UploadError | null>(null);
  const maxBytes = EVIDENCE_LIBRARY_UPLOAD_LIMITS[kind];

  async function handleFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const result = await uploadFile(kind, file);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.kind !== "file") {
        setError("type");
        return;
      }
      onChange(result.url);
    } finally {
      setUploading(false);
    }
  }

  // The replaced file stays stored until the draft is saved; the page deletes it then.
  function handleRemove() {
    onChange(null);
  }

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: EVIDENCE_LIBRARY_UPLOAD_ACCEPT[kind],
    multiple: false,
    noClick: Boolean(value),
    disabled: uploading,
    onDrop: handleFiles,
  });

  const accepts = t(`accepts.${kind}`);
  const errorText =
    error === "type"
      ? t("wrongType", { accepts })
      : error === "size"
        ? t("tooBig", { max: formatBytes(maxBytes) })
        : error === "failed"
          ? t("uploadFailed")
          : null;

  return (
    <Field
      label={label}
      hint={hint ?? t("limits", { accepts })}
      error={errorText}
      suffix={optional ? t("optional") : undefined}
      className={className}
    >
      {(id, invalid) => (
        <UploadSurface
          id={id}
          invalid={invalid}
          uploading={uploading}
          filled={Boolean(value)}
          dropzone={{ getRootProps, getInputProps, isDragActive }}
        >
          {value ? (
            <div className="flex items-center gap-3 p-3">
              <FileThumb url={value} kind={kind} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{fileNameFromUrl(value)}</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={open}>
                {t("replace")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("remove")}
                onClick={handleRemove}
              >
                <X />
              </Button>
            </div>
          ) : null}
        </UploadSurface>
      )}
    </Field>
  );
}

/**
 * Upload for a Markdown or text file whose content is stored in the section
 * itself (legal pages). The value is the text, not a file address.
 */
export function TextUploadField({
  label,
  hint,
  value,
  onChange,
  required,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** The stored text, or null when empty. */
  value: string | null;
  onChange: (text: string | null) => void;
  /** Show the "missing" error when empty. */
  required?: boolean;
  className?: string;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.fields");
  const { uploadFile } = useFileUploads();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<UploadError | null>(null);
  const kind = "legal";

  async function handleFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const result = await uploadFile(kind, file);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.kind !== "text") {
        setError("type");
        return;
      }
      onChange(result.text);
    } finally {
      setUploading(false);
    }
  }

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: EVIDENCE_LIBRARY_UPLOAD_ACCEPT[kind],
    multiple: false,
    noClick: Boolean(value),
    disabled: uploading,
    onDrop: handleFiles,
  });

  const accepts = t(`accepts.${kind}`);
  const errorText =
    error === "type"
      ? t("wrongType", { accepts })
      : error === "size"
        ? t("tooBig", { max: formatBytes(EVIDENCE_LIBRARY_UPLOAD_LIMITS[kind]) })
        : error === "failed"
          ? t("uploadFailed")
          : required && !value && !uploading
            ? t("required")
            : null;

  return (
    <Field
      label={label}
      hint={hint ?? t("limits", { accepts })}
      error={errorText}
      className={className}
    >
      {(id, invalid) => (
        <UploadSurface
          id={id}
          invalid={invalid}
          uploading={uploading}
          filled={Boolean(value)}
          dropzone={{ getRootProps, getInputProps, isDragActive }}
        >
          {value ? (
            <div className="flex items-center gap-3 p-3">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/30">
                <FileText className="h-5 w-5 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{textTitle(value) ?? t("textFile")}</p>
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="ghost" size="sm">
                    {t("view")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-96 p-0">
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-3 font-sans text-xs">
                    {value}
                  </pre>
                </PopoverContent>
              </Popover>
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
          ) : null}
        </UploadSurface>
      )}
    </Field>
  );
}

/** The first Markdown heading of an uploaded text, if it has one. */
function textTitle(text: string): string | null {
  const heading = text.split(/\r?\n/).find((line) => /^#{1,6}\s+\S/.test(line));
  return heading ? heading.replace(/^#{1,6}\s+/, "").trim() : null;
}

/** The dashed drop zone every upload uses: empty, uploading, or filled with `children`. */
function UploadSurface({
  id,
  invalid,
  uploading,
  filled,
  dropzone,
  children,
}: {
  id: string;
  invalid: boolean;
  uploading: boolean;
  filled: boolean;
  dropzone: Pick<DropzoneState, "getRootProps" | "getInputProps" | "isDragActive">;
  children: ReactNode;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.fields");
  const { getRootProps, getInputProps, isDragActive } = dropzone;
  return (
    <div
      {...getRootProps()}
      data-upload-state={uploading ? "uploading" : filled ? "filled" : "empty"}
      aria-invalid={invalid || undefined}
      className={cn(
        "rounded-lg border-2 border-dashed transition-colors",
        isDragActive
          ? "border-primary bg-primary/5"
          : invalid
            ? "border-destructive/40"
            : "border-border/60",
        !filled && !uploading && "cursor-pointer hover:border-primary/50 hover:bg-muted/30",
      )}
    >
      <input {...getInputProps()} id={id} />
      {uploading ? (
        <div className="flex items-center gap-3 p-4">
          <Spinner className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">{t("uploading")}</p>
        </div>
      ) : filled ? (
        children
      ) : (
        <div className="flex items-center gap-3 p-4 text-center sm:text-left">
          <Upload className="h-5 w-5 shrink-0 text-muted-foreground" />
          <p className="text-sm">
            <span className="font-medium">{isDragActive ? t("dropHere") : t("dropOrClick")}</span>
          </p>
        </div>
      )}
    </div>
  );
}

function FileThumb({ url, kind }: { url: string; kind: UploadKind }) {
  if (kind === "legal") {
    return (
      <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/30">
        <FileText className="h-5 w-5 text-muted-foreground" />
      </span>
    );
  }
  return (
    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:12px_12px]">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="max-h-full max-w-full object-contain" />
      ) : (
        <ImageIcon className="h-5 w-5 text-muted-foreground" />
      )}
    </span>
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
  const t = useTranslations("evidenceLibraryConfiguration.fields");
  const tp = useTranslations("evidenceLibraryConfiguration.theme.presets");
  const valid = HEX_COLOUR.test(value);
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
                  value={valid ? value.slice(0, 7) : "#000000"}
                  onChange={(e) => onChange(e.target.value)}
                  className="h-10 w-full cursor-pointer rounded-md border border-border/50 bg-background p-0.5"
                />
                <div className="grid grid-cols-8 gap-1.5">
                  {COLOUR_PRESETS.map((p) => (
                    <Tooltip key={p.key}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={tp(p.key)}
                          onClick={() => onChange(p.colors.accent)}
                          className="flex size-6 items-center justify-center rounded-md border border-border/40"
                          style={{ background: p.colors.accent }}
                        >
                          {p.colors.accent.toLowerCase() === value.toLowerCase() ? (
                            <Check className="h-3 w-3 text-white" />
                          ) : null}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{tp(p.key)}</TooltipContent>
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
              {t("lowContrast", { ratio: contrastRatio(value, low[0]!).toFixed(1) })}
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
  /** Why the switch cannot change right now. Shown under the hint, or as a tooltip when locked. */
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

/** A small switch with its label beside it, for options inside a list row. */
export function InlineSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex h-9 items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="scale-90" />
      <Label htmlFor={id} className="text-xs font-normal">
        {label}
      </Label>
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
  // Stable id so dnd-kit's aria-describedby matches between server and client render.
  const id = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  return (
    <DndContext
      id={id}
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
  /** Rows that can be reordered but not removed. */
  hideRemove?: boolean;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.fields");
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
  next.splice(to, 0, item as T);
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

/** Tags typed one at a time; Enter, comma or blur adds one, Backspace removes the last. */
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
  const t = useTranslations("evidenceLibraryConfiguration.fields");
  const [text, setText] = useState("");
  // Unfinished text belongs to the values it was typed against; a reset or
  // outside change replaces `values`, so the text is dropped with it.
  const [typedFor, setTypedFor] = useState(values.join("\0"));
  const current = values.join("\0");
  if (typedFor !== current) {
    setTypedFor(current);
    if (text) setText("");
  }
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
            <span key={v} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-xs">
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
            aria-invalid={invalid || undefined}
            className="min-w-24 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground"
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                commit();
              }
              if (e.key === "Backspace" && !text && values.length) onChange(values.slice(0, -1));
            }}
          />
        </div>
      )}
    </Field>
  );
}

export function EmptyList({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * Child items under a list row (dropdown links under a nav link, links under
 * a footer section). A thin left rule and an indent instead of a box; the
 * add action is a quiet text button and there is no empty-state sentence.
 */
export function NestedList({
  label,
  addLabel,
  onAdd,
  disabled,
  children,
}: {
  label: string;
  addLabel: string;
  onAdd: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="ml-1 space-y-2 border-l-2 border-border/50 pl-4" role="group" aria-label={label}>
      {children}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        className="-ml-2 h-7 text-xs text-muted-foreground hover:text-foreground"
        onClick={onAdd}
      >
        <Plus className="h-3.5 w-3.5" />
        {addLabel}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Choices                                                             */
/* ------------------------------------------------------------------ */

type ChoiceOption<V extends string> = {
  value: V;
  label: ReactNode;
  hint?: ReactNode;
  /** Small mono code shown before the label (chips only). */
  code?: string;
  disabled?: boolean;
  /** Shown as a tooltip / title when disabled. */
  disabledReason?: string;
  /** Small illustration shown above the label (cards only). */
  preview?: ReactNode;
};

/** One highlighted-card look for single choices that need an explanation. */
export function ChoiceCards<V extends string>({
  value,
  onChange,
  options,
  columns = 2,
  ariaLabel,
  className,
}: {
  value: V;
  onChange: (value: V) => void;
  options: ChoiceOption<V>[];
  columns?: 1 | 2 | 3;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as V)}
      aria-label={ariaLabel}
      className={cn(
        "grid gap-2",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-3",
        className,
      )}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Label
            key={o.value}
            data-value={o.value}
            data-selected={selected}
            className={cn(
              "flex items-start gap-2.5 rounded-lg border-2 px-3 py-2.5 font-normal transition-colors",
              o.disabled
                ? "cursor-not-allowed border-dashed border-border/60 bg-muted/40 text-muted-foreground"
                : selected
                  ? "cursor-pointer border-primary/40 bg-primary/5"
                  : "cursor-pointer border-border/50 bg-background hover:border-border/80 hover:bg-muted/30",
            )}
            title={o.disabled ? o.disabledReason : undefined}
          >
            <RadioGroupItem value={o.value} disabled={o.disabled} className="mt-0.5" />
            <span className="min-w-0 flex-1 space-y-0.5">
              {o.preview ? <span className="mb-2 block">{o.preview}</span> : null}
              <span className="block text-sm font-medium">{o.label}</span>
              {o.hint ? <span className="block text-xs text-muted-foreground">{o.hint}</span> : null}
            </span>
          </Label>
        );
      })}
    </RadioGroup>
  );
}

/** One chip look for multi-select lists (search scopes, languages). */
export function ChoiceChips<V extends string>({
  values,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  values: V[];
  onChange: (values: V[]) => void;
  options: ChoiceOption<V>[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)} role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const checked = values.includes(o.value);
        return (
          <Label
            key={o.value}
            data-value={o.value}
            data-checked={checked}
            data-disabled={o.disabled || undefined}
            title={o.disabled ? o.disabledReason : undefined}
            className={cn(
              "flex items-center gap-2 rounded-lg border-2 px-3 py-1.5 text-sm font-normal transition-colors",
              o.disabled
                ? "cursor-not-allowed border-dashed border-border/60 bg-muted/40 text-muted-foreground"
                : checked
                  ? "cursor-pointer border-primary/40 bg-primary/5"
                  : "cursor-pointer border-border/50 bg-background hover:border-border/80 hover:bg-muted/30",
            )}
          >
            <Checkbox
              checked={checked}
              disabled={o.disabled}
              aria-label={typeof o.label === "string" ? o.label : undefined}
              onCheckedChange={(next) =>
                onChange(
                  next === true
                    ? options.filter((x) => x.value === o.value || values.includes(x.value)).map((x) => x.value)
                    : values.filter((v) => v !== o.value),
                )
              }
            />
            {o.code ? <code className="font-mono text-xs text-muted-foreground">{o.code}</code> : null}
            <span>{o.label}</span>
          </Label>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

/**
 * The one bordered box. `muted` for information (an account, an owner line,
 * a balance), `plain` for a piece of content that sits in a list, `danger`
 * for destructive actions.
 */
export function Panel({
  tone = "muted",
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { tone?: "muted" | "plain" | "danger" }) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        tone === "muted" && "border-border/50 bg-muted/30",
        tone === "plain" && "border-border/50 bg-background",
        tone === "danger" && "border-destructive/20 bg-destructive/5",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Panel content laid out as "text on the left, action on the right". */
export function PanelRow({
  tone,
  title,
  hint,
  action,
  leading,
  className,
  ...rest
}: Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & {
  tone?: "muted" | "plain" | "danger";
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  leading?: ReactNode;
}) {
  return (
    <Panel tone={tone} className={cn("flex flex-wrap items-center gap-3", className)} {...rest}>
      {leading}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </Panel>
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
  locked = true,
  className,
  title,
}: {
  id?: string;
  value: ReactNode;
  mono?: boolean;
  /** Show the lock. Off for values that are only derived, not yet fixed. */
  locked?: boolean;
  className?: string;
  /** Hover text. Use it when a long value has to be truncated. */
  title?: string;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.fields");
  return (
    <div
      id={id}
      role="textbox"
      aria-readonly="true"
      aria-labelledby={id ? labelId(id) : undefined}
      tabIndex={0}
      title={title ?? t("fixed")}
      className={cn(
        "flex h-9 w-full cursor-default items-center gap-2 rounded-md border border-dashed border-border/60 bg-muted/40 px-3 text-sm text-muted-foreground",
        mono && "font-mono",
        className,
      )}
    >
      <span className="min-w-0 flex-1 truncate">{value}</span>
      {locked ? <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
    </div>
  );
}

export function ResetButton({ onClick }: { onClick: () => void }) {
  const t = useTranslations("evidenceLibraryConfiguration.fields");
  return (
    <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onClick} data-reset>
      <RotateCcw className="h-3.5 w-3.5" />
      {t("reset")}
    </Button>
  );
}

/**
 * A titled group of fields inside a section card. Gives every group the same
 * shape: a divider above (except the first), a heading row with an optional
 * hint and action, then the fields with one fixed gap. Use this instead of a
 * bare heading followed by siblings.
 */
export function FieldGroup({
  title,
  hint,
  action,
  children,
  className,
  ...rest
}: Omit<React.HTMLAttributes<HTMLElement>, "title"> & {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  const hasContent = Children.toArray(children).length > 0;
  return (
    <section
      className={cn(
        "border-t border-border/50 pt-5 first:border-t-0 first:pt-0",
        className,
      )}
      {...rest}
    >
      <div className={cn("flex items-start justify-between gap-3", hasContent && "mb-3")}>
        <div className="min-w-0 space-y-0.5">
          <h4 className="text-sm font-semibold">{title}</h4>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {hasContent ? <div className="space-y-4">{children}</div> : null}
    </section>
  );
}

export type MetaItem = { key: string; label?: ReactNode; value: ReactNode; icon?: LucideIcon };

/**
 * Small facts under a title: "Address example.org   Last activated 26 Aug".
 * Labels are muted, values are not. Spacing separates the facts; never a dot.
 */
export function MetaList({ items, className }: { items: MetaItem[]; className?: string }) {
  return (
    <dl className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs", className)}>
      {items.map(({ key, label, value, icon: Icon }) => (
        <div key={key} className="inline-flex items-center gap-1.5">
          {Icon ? <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> : null}
          {label ? <dt className="text-muted-foreground">{label}</dt> : null}
          <dd className="text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export { FieldError };
