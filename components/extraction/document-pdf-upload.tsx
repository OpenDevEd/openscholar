"use client";

import React, { useState, useCallback, useRef } from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  FileText,
  Loader2,
  Upload,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";

interface DocumentPdfUploadProps {
  documentId: Id<"documents">;
  documentTitle: string;
  onSuccess?: () => void;
}

type UploadStatus = "idle" | "uploading" | "processing" | "indexing" | "done" | "error";

export function DocumentPdfUpload({
  documentId,
  documentTitle,
  onSuccess,
}: DocumentPdfUploadProps) {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const generateUploadUrl = useMutation(api.rag.mutations.generateUploadUrl);
  const processPdf = useAction(api.rag.actions.processPdf);

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      // Validate file type
      if (file.type !== "application/pdf") {
        toast.error("Please select a PDF file");
        return;
      }

      // Validate file size (100MB limit)
      if (file.size > 100 * 1024 * 1024) {
        toast.error("File size must be less than 100MB");
        return;
      }

      setFileName(file.name);
      setError(null);
      setStatus("uploading");
      setProgress(10);

      try {
        // Step 1: Get upload URL
        const uploadUrl = await generateUploadUrl();
        setProgress(20);

        // Step 2: Upload file
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });

        if (!response.ok) {
          throw new Error("Upload failed");
        }

        const { storageId } = await response.json();
        setProgress(40);
        setStatus("processing");

        // Step 3: Process PDF and index into RAG
        // (processPdf action handles saving storageId internally)
        setStatus("indexing");
        setProgress(60);

        const result = await processPdf({
          documentId,
          storageId,
        });

        if (!result.success) {
          throw new Error(result.error || "Processing failed");
        }

        setProgress(100);
        setStatus("done");
        toast.success(
          `PDF processed: ${result.textLength?.toLocaleString()} characters, ${result.chunksIndexed} chunks indexed`
        );
        onSuccess?.();
      } catch (err: any) {
        console.error("PDF upload failed:", err);
        setError(err.message || "Upload failed");
        setStatus("error");
        toast.error(err.message || "Failed to upload PDF");
      }

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
        [documentId, generateUploadUrl, processPdf, onSuccess]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const file = event.dataTransfer.files?.[0];
      if (file) {
        // Create a synthetic event for the file input
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        if (fileInputRef.current) {
          fileInputRef.current.files = dataTransfer.files;
          fileInputRef.current.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    },
    []
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const resetUpload = () => {
    setStatus("idle");
    setProgress(0);
    setError(null);
    setFileName(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const statusLabels: Record<UploadStatus, string> = {
    idle: "Drop PDF here or click to upload",
    uploading: "Uploading...",
    processing: "Extracting text...",
    indexing: "Indexing for search...",
    done: "PDF processed successfully",
    error: error || "Processing failed",
  };

  return (
    <div className="space-y-4">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        accept="application/pdf"
        className="hidden"
      />

      <div
        onClick={() => status === "idle" && fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className={cn(
          "border-2 border-dashed rounded-lg p-6 transition-colors",
          status === "idle" && "cursor-pointer hover:border-primary/50 hover:bg-muted/50",
          status === "done" && "border-green-500/50 bg-green-500/5",
          status === "error" && "border-destructive/50 bg-destructive/5"
        )}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          {status === "idle" && (
            <>
              <Upload className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="font-medium">Upload PDF</p>
                <p className="text-sm text-muted-foreground">
                  Full-text will be indexed for better extraction
                </p>
              </div>
            </>
          )}

          {(status === "uploading" || status === "processing" || status === "indexing") && (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <div>
                <p className="font-medium">{fileName}</p>
                <p className="text-sm text-muted-foreground">{statusLabels[status]}</p>
              </div>
              <Progress value={progress} className="w-full max-w-xs" />
            </>
          )}

          {status === "done" && (
            <>
              <CheckCircle2 className="h-8 w-8 text-green-500" />
              <div>
                <p className="font-medium text-green-700">{fileName}</p>
                <p className="text-sm text-muted-foreground">{statusLabels[status]}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={resetUpload}>
                Upload another
              </Button>
            </>
          )}

          {status === "error" && (
            <>
              <AlertCircle className="h-8 w-8 text-destructive" />
              <div>
                <p className="font-medium text-destructive">{fileName || "Upload failed"}</p>
                <p className="text-sm text-muted-foreground">{error}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={resetUpload}>
                Try again
              </Button>
            </>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Max file size: 100MB. The PDF text will be extracted and indexed for semantic search during data extraction.
      </p>
    </div>
  );
}
