"use client";
"use no memo"; // try/catch in handlers

import { useCallback, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppToast } from "@/lib/toast";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import { MAX_PDF_BYTES, MAX_PDF_MB } from "@/lib/files/limits";
import { validatePdfFile } from "@/lib/bucket/bulk-upload";
import { useBucketStore } from "@/lib/store/bucket";
import { fromUpload } from "@/lib/bucket/bucketItem";
import { FileUp, Loader2, RefreshCw, Trash2 } from "lucide-react";

const CONCURRENCY = 3;

type UploadRowStatus = "pending" | "uploading" | "uploaded" | "failed";

type UploadRow = {
  uploadId: string;
  file: File;
  status: UploadRowStatus;
  error?: string;
  storageId?: Id<"_storage">;
  bucketKey?: string;
};

function makeUploadId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `up_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function BulkPdfUpload({ paperLimit }: { paperLimit?: number }) {
  const toast = useAppToast();
  const pdfEnabled = useFeatureFlag("extraction.pdf");
  const livePaperLimit = useQuery(
    api.extraction.bucket.queries.getMyPaperLimit,
    paperLimit === undefined ? {} : "skip",
  );
  const resolvedPaperLimit = paperLimit ?? livePaperLimit ?? 1000;
  const bucketAdd = useBucketStore((s) => s.addMany);
  const bucketRemove = useBucketStore((s) => s.remove);

  const generateUploadUrl = useMutation(
    api.extraction.uploads.generateUploadUrl,
  );
  const recordUploadedFile = useMutation(
    api.extraction.uploads.recordUploadedFile,
  );

  const [rows, setRows] = useState<UploadRow[]>([]);
  const inFlight = useMemo(
    () => rows.filter((r) => r.status === "uploading").length,
    [rows],
  );

  const patch = useCallback(
    (uploadId: string, updates: Partial<UploadRow>) => {
      setRows((prev) =>
        prev.map((r) => (r.uploadId === uploadId ? { ...r, ...updates } : r)),
      );
    },
    [],
  );

  const processRow = useCallback(
    async (row: UploadRow) => {
      patch(row.uploadId, { status: "uploading", error: undefined });
      try {
        const uploadUrl = await generateUploadUrl({});
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": row.file.type },
          body: row.file,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const { storageId } = (await response.json()) as {
          storageId: Id<"_storage">;
        };
        await recordUploadedFile({ storageId });
        const item = fromUpload({
          uploadId: row.uploadId,
          title: row.file.name,
          storageId,
          status: "ready",
        });
        const result = bucketAdd([item], resolvedPaperLimit);
        if (result.capped > 0) {
          patch(row.uploadId, {
            status: "failed",
            error: "Bucket is full — remove items and retry",
          });
          return;
        }
        patch(row.uploadId, {
          status: "uploaded",
          storageId,
          bucketKey: item.bucketKey,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        patch(row.uploadId, { status: "failed", error: message });
      }
    },
    [bucketAdd, resolvedPaperLimit, generateUploadUrl, recordUploadedFile, patch],
  );

  const schedule = useCallback(
    async (queue: UploadRow[]) => {
      // Tiny inline pool: grab up to `CONCURRENCY` workers, each
      // consuming from the queue one row at a time.
      let cursor = 0;
      const next = () => (cursor < queue.length ? queue[cursor++] : null);
      const worker = async () => {
        for (let row = next(); row; row = next()) {
          await processRow(row);
        }
      };
      await Promise.all(
        Array.from({ length: CONCURRENCY }, () => worker()),
      );
    },
    [processRow],
  );

  const addFiles = useCallback(
    (incoming: File[]) => {
      const accepted: UploadRow[] = [];
      for (const file of incoming) {
        const validation = validatePdfFile(file, MAX_PDF_BYTES);
        if (validation === "wrong-mime") {
          toast.validation.fileType("PDF");
          continue;
        }
        if (validation === "too-large") {
          toast.validation.fileSize(MAX_PDF_MB);
          continue;
        }
        accepted.push({
          uploadId: makeUploadId(),
          file,
          status: "pending",
        });
      }
      if (accepted.length === 0) return;
      setRows((prev) => [...prev, ...accepted]);
      void schedule(accepted);
    },
    [schedule, toast],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "application/pdf": [".pdf"] },
    multiple: true,
    onDrop: addFiles,
    disabled: !pdfEnabled,
  });

  const retry = useCallback(
    (uploadId: string) => {
      const row = rows.find((r) => r.uploadId === uploadId);
      if (!row) return;
      void schedule([row]);
    },
    [rows, schedule],
  );

  const remove = useCallback(
    (uploadId: string) => {
      const row = rows.find((r) => r.uploadId === uploadId);
      if (row?.bucketKey) bucketRemove(row.bucketKey);
      setRows((prev) => prev.filter((r) => r.uploadId !== uploadId));
    },
    [rows, bucketRemove],
  );

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={cn(
          "rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer",
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/30",
          !pdfEnabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <input {...getInputProps()} />
        <FileUp className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm font-medium">
          {isDragActive
            ? "Drop PDFs here"
            : "Drag PDFs here or click to select"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Up to {MAX_PDF_MB} MB per file
        </p>
      </div>

      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.uploadId}
              className="flex items-center gap-3 rounded-lg border border-border bg-background p-3 text-sm"
            >
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium">{row.file.name}</p>
                <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  <span className="tabular-nums">{(row.file.size / (1024 * 1024)).toFixed(1)} MB</span>
                  <span>{row.status}</span>
                  {row.error ? <span className="text-destructive">{row.error}</span> : null}
                </p>
              </div>
              {row.status === "uploading" && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {row.status === "failed" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => retry(row.uploadId)}
                >
                  <RefreshCw className="h-3 w-3 mr-1" /> Retry
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                onClick={() => remove(row.uploadId)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <p className="flex flex-wrap gap-x-3 text-xs tabular-nums text-muted-foreground">
            <span>{inFlight} in flight</span>
            <span>{rows.filter((r) => r.status === "uploaded").length} uploaded</span>
            <span>{rows.filter((r) => r.status === "failed").length} failed</span>
          </p>
        </div>
      )}
    </div>
  );
}
