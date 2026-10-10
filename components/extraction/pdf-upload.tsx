"use client";
"use no memo"; // try/catch in handlers

// PDFs of the person's own as papers to extract from (#690): each uploads as it lands, and joins
// the job's papers once it has.

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppToast } from "@/lib/toast";
import { MAX_PDF_BYTES, MAX_PDF_MB } from "@/lib/files/limits";
import { validatePdfFile } from "@/lib/bucket/bulk-upload";
import { useExtractionStore, usePickedPapers } from "@/lib/store/extraction";
import { useWorkspace } from "@/lib/workspaces/url";
import { CircleCheck, FileText, FileUp, Loader2, RefreshCw, Trash2 } from "@/components/icons";
import { Chip } from "@/components/screening/parts";
import { LIST } from "@/components/settings/parts";
import { TooltipHint } from "@/components/ui/tooltip";

const CONCURRENCY = 3;

type UploadRow = {
  uploadId: string;
  file: File;
  status: "pending" | "uploading" | "failed";
  error?: string;
};

export function PdfUpload() {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const toast = useAppToast();
  const workspaceId = useWorkspace();
  const addUpload = useExtractionStore((s) => s.addUpload);
  const removeUpload = useExtractionStore((s) => s.removeUpload);
  const generateUploadUrl = useMutation(api.extraction.uploads.generateUploadUrl);
  const recordUploadedFile = useMutation(api.extraction.uploads.recordUploadedFile);
  const [rows, setRows] = useState<UploadRow[]>([]);
  // Uploaded PDFs are the draft's, so they're listed when the page comes back to them; the rest are this visit's.
  const { uploads } = usePickedPapers(workspaceId);

  const patch = useCallback((uploadId: string, updates: Partial<UploadRow>) => setRows((prev) => prev.map((r) => (r.uploadId === uploadId ? { ...r, ...updates } : r))), []);

  const upload = useCallback(
    async (row: UploadRow) => {
      patch(row.uploadId, { status: "uploading", error: undefined });
      try {
        const response = await fetch(await generateUploadUrl({}), { method: "POST", headers: { "Content-Type": row.file.type }, body: row.file });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
        await recordUploadedFile({ storageId });
        if (workspaceId) addUpload(workspaceId, { storageId, title: row.file.name });
        setRows((prev) => prev.filter((r) => r.uploadId !== row.uploadId));
      } catch (error) {
        patch(row.uploadId, { status: "failed", error: error instanceof Error ? error.message : String(error) });
      }
    },
    [addUpload, generateUploadUrl, patch, recordUploadedFile, workspaceId],
  );

  /** Uploads the rows, CONCURRENCY at a time. */
  const schedule = useCallback(
    async (queue: UploadRow[]) => {
      let cursor = 0;
      const next = () => (cursor < queue.length ? queue[cursor++] : null);
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          for (let row = next(); row; row = next()) await upload(row);
        }),
      );
    },
    [upload],
  );

  const addFiles = useCallback(
    (incoming: File[]) => {
      const accepted: UploadRow[] = [];
      for (const file of incoming) {
        const invalid = validatePdfFile(file, MAX_PDF_BYTES);
        if (invalid === "wrong-mime") toast.validation.fileType("PDF");
        else if (invalid === "too-large") toast.validation.fileSize(MAX_PDF_MB);
        else accepted.push({ uploadId: crypto.randomUUID(), file, status: "pending" });
      }
      if (!accepted.length) return;
      setRows((prev) => [...prev, ...accepted]);
      void schedule(accepted);
    },
    [schedule, toast],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ accept: { "application/pdf": [".pdf"] }, multiple: true, onDrop: addFiles });

  const uploading = rows.filter((r) => r.status === "uploading").length;
  /** A file's row: uploaded, from the draft, or still on its way, from this visit. */
  const fileRow = (key: string, name: string, state: { done: boolean; busy: boolean; error?: string; size?: number }, onRetry: (() => void) | null, onRemove: () => void) => (
    <div key={key} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-inset", state.done ? "text-primary" : state.error ? "text-destructive" : "text-muted-foreground")}>
        {state.busy ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <TooltipHint label={name} onlyWhenClipped>
          <span className="block truncate text-sm font-medium">{name}</span>
        </TooltipHint>
        {state.error ? <span className="block truncate text-xs text-destructive">{state.error}</span> : null}
      </span>
      {state.size !== undefined ? <Chip>{t("pdfSize", { mb: (state.size / (1024 * 1024)).toFixed(1) })}</Chip> : null}
      {onRetry ? (
        <Button size="sm" variant="outline" className="h-8" onClick={onRetry}>
          <RefreshCw /> {tc("retry")}
        </Button>
      ) : null}
      <TooltipHint label={tc("remove")}>
        <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" aria-label={t("removeSource", { name })} onClick={onRemove}>
          <Trash2 className="size-4" />
        </Button>
      </TooltipHint>
    </div>
  );

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={cn(
          "flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-6 py-6 text-center transition-colors",
          isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/60",
        )}
      >
        <input {...getInputProps()} />
        <span className={cn("flex size-10 items-center justify-center rounded-xl bg-inset", isDragActive ? "text-primary" : "text-muted-foreground")}>
          <FileUp className="size-5" />
        </span>
        <span className="text-sm font-medium">{isDragActive ? t("dropPdfs") : t("dropOrChoosePdfs")}</span>
        <Chip>{t("pdfSizeLimit", { mb: MAX_PDF_MB })}</Chip>
      </div>

      {uploads.length || rows.length ? (
        <div className={LIST}>
          {uploads.map((file) => fileRow(file.storageId, file.title, { done: true, busy: false }, null, () => removeUpload(file.storageId)))}
          {rows.map((row) =>
            fileRow(row.uploadId, row.file.name, { done: false, busy: row.status === "uploading", error: row.error, size: row.file.size }, row.status === "failed" ? () => void schedule([row]) : null, () => setRows((prev) => prev.filter((r) => r.uploadId !== row.uploadId))),
          )}
        </div>
      ) : null}
      {uploads.length || uploading ? (
        <span className="flex flex-wrap gap-1.5">
          <Chip icon={CircleCheck}>{t("uploadedCount", { count: uploads.length })}</Chip>
          {uploading ? <Chip icon={Loader2}>{t("uploadingCount", { count: uploading })}</Chip> : null}
        </span>
      ) : null}
    </div>
  );
}
