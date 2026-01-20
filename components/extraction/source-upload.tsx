"use client";

import React, { useState, useCallback, useRef } from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Upload,
  Loader2,
  FileText,
  AlertCircle,
  CheckCircle2,
  X,
  File,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { triggerFileUpload, uploadFile } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";

interface SourceUploadProps {
  analysisId: Id<"analyses">;
  onSuccess?: () => void;
}

interface ParsedPaper {
  externalId: string;
  title: string;
  abstract?: string;
  authors?: string[];
  year?: number;
  doi?: string;
}

interface PdfFile {
  file: File;
  name: string;
  status: "pending" | "uploading" | "processing" | "done" | "error";
  error?: string;
}

export function SourceUpload({ analysisId, onSuccess }: SourceUploadProps) {
  const [activeTab, setActiveTab] = useState("pdf");
  
  // JSON/CSV state
  const [fileName, setFileName] = useState<string | null>(null);
  const [papers, setPapers] = useState<ParsedPaper[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // PDF state
  const [pdfFiles, setPdfFiles] = useState<PdfFile[]>([]);
  const [isUploadingPdfs, setIsUploadingPdfs] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importFromUpload = useMutation(api.extraction.sources.importFromUpload);
  const generateUploadUrl = useMutation(api.rag.mutations.generateUploadUrl);
  const uploadPdfs = useAction(api.rag.actions.uploadPdfs);

  // ===== PDF Upload Handlers =====
  const handlePdfSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      const pdfFiles = files.filter((f) => f.type === "application/pdf");

      if (pdfFiles.length === 0) {
        toast.error("Please select PDF files");
        return;
      }

      setPdfFiles((prev) => [
        ...prev,
        ...pdfFiles.map((file) => ({
          file,
          name: file.name,
          status: "pending" as const,
        })),
      ]);

      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    []
  );

  const handleRemovePdf = (index: number) => {
    setPdfFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUploadPdfs = async () => {
    if (pdfFiles.length === 0) return;

    setIsUploadingPdfs(true);
    setUploadProgress(0);

    try {
      // Upload each file to storage
      const uploadedPdfs: { storageId: Id<"_storage">; fileName: string }[] = [];
      const totalFiles = pdfFiles.length;

      for (let i = 0; i < pdfFiles.length; i++) {
        const pdf = pdfFiles[i];

        // Update status
        setPdfFiles((prev) =>
          prev.map((p, idx) =>
            idx === i ? { ...p, status: "uploading" } : p
          )
        );

        try {
          // Get upload URL
          const uploadUrl = await generateUploadUrl();

          // Upload file
          const response = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": "application/pdf" },
            body: pdf.file,
          });

          if (!response.ok) {
            throw new Error("Upload failed");
          }

          const { storageId } = await response.json();
          uploadedPdfs.push({ storageId, fileName: pdf.name });

          // Update status to processing
          setPdfFiles((prev) =>
            prev.map((p, idx) =>
              idx === i ? { ...p, status: "processing" } : p
            )
          );
        } catch (error: any) {
          setPdfFiles((prev) =>
            prev.map((p, idx) =>
              idx === i
                ? { ...p, status: "error", error: error.message }
                : p
            )
          );
        }

        setUploadProgress(((i + 1) / totalFiles) * 50);
      }

      // Process all uploaded PDFs
      if (uploadedPdfs.length > 0) {
        setUploadProgress(60);

        const result = await uploadPdfs({
          analysisId,
          pdfs: uploadedPdfs,
        });

        setUploadProgress(100);

        // Update all statuses to done
        setPdfFiles((prev) =>
          prev.map((p) =>
            p.status === "processing" ? { ...p, status: "done" } : p
          )
        );

        if (result.errors.length > 0) {
          toast.warning(
            `Processed ${result.documentsCreated} PDFs with ${result.errors.length} errors`
          );
        } else {
          toast.success(`Successfully processed ${result.documentsCreated} PDFs`);
        }

        // Wait a moment then close
        setTimeout(() => {
          onSuccess?.();
        }, 1000);
      }
    } catch (error: any) {
      console.error("PDF upload error:", error);
      toast.error(error.message || "Failed to upload PDFs");
    } finally {
      setIsUploadingPdfs(false);
    }
  };

  // ===== JSON/CSV Handlers =====
  const handleFileSelect = useCallback(async () => {
    try {
      setParseError(null);
      const file = await triggerFileUpload(".json,.csv");
      setFileName(file.name);

      const data = await uploadFile(file);

      // Parse the data into papers format
      const parsedPapers: ParsedPaper[] = (Array.isArray(data) ? data : [data])
        .map((item: any, index: number) => {
          // Handle various field name formats
          const title =
            item.title ||
            item.Title ||
            item.display_name ||
            item.displayName ||
            "";
          const abstract =
            item.abstract ||
            item.Abstract ||
            item.abstractNote ||
            item.summary ||
            "";
          const authors =
            item.authors ||
            item.Authors ||
            item.author ||
            (item.authorships
              ? item.authorships.map((a: any) => a.author?.display_name)
              : undefined);
          const year =
            item.year ||
            item.Year ||
            item.publication_year ||
            item.publicationYear;
          const doi = item.doi || item.DOI;
          const id =
            item.id ||
            item.externalId ||
            item.openalex_id ||
            doi ||
            `upload-${index}`;

          return {
            externalId: String(id),
            title: String(title || "Untitled"),
            abstract: abstract ? String(abstract) : undefined,
            authors: Array.isArray(authors)
              ? authors.filter(Boolean).map(String)
              : undefined,
            year: year ? Number(year) : undefined,
            doi: doi ? String(doi).replace("https://doi.org/", "") : undefined,
          };
        })
        .filter((p) => p.title && p.title !== "Untitled");

      if (parsedPapers.length === 0) {
        setParseError(
          "No valid papers found. Make sure your file has 'title' field."
        );
        return;
      }

      setPapers(parsedPapers);
    } catch (error: any) {
      console.error("File parse error:", error);
      setParseError(error.message || "Failed to parse file");
    }
  }, []);

  const handleImport = async () => {
    if (papers.length === 0 || !fileName) return;

    setIsImporting(true);
    try {
      const result = await importFromUpload({
        analysisId,
        fileName,
        papers,
      });

      toast.success(`Imported ${result.documentCount} documents`);
      onSuccess?.();
    } catch (error: any) {
      console.error("Import failed:", error);
      toast.error(error.message || "Failed to import documents");
    } finally {
      setIsImporting(false);
    }
  };

  const handleClear = () => {
    setFileName(null);
    setPapers([]);
    setParseError(null);
  };

  const handleDrop = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const files = Array.from(event.dataTransfer.files);
    const pdfFiles = files.filter((f) => f.type === "application/pdf");

    if (pdfFiles.length > 0) {
      setActiveTab("pdf");
      setPdfFiles((prev) => [
        ...prev,
        ...pdfFiles.map((file) => ({
          file,
          name: file.name,
          status: "pending" as const,
        })),
      ]);
    }
  }, []);

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
    },
    []
  );

  return (
    <div className="flex flex-col h-[400px]">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handlePdfSelect}
        accept="application/pdf"
        multiple
        className="hidden"
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="grid w-full grid-cols-2 mb-4">
          <TabsTrigger value="pdf">PDF Files</TabsTrigger>
          <TabsTrigger value="data">JSON/CSV Data</TabsTrigger>
        </TabsList>

        {/* PDF Upload Tab */}
        <TabsContent value="pdf" className="flex-1 flex flex-col m-0">
          {pdfFiles.length === 0 ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className={cn(
                "flex-1 border-2 border-dashed rounded-lg",
                "flex flex-col items-center justify-center gap-4",
                "hover:border-primary/50 hover:bg-muted/30 transition-colors",
                "cursor-pointer"
              )}
            >
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <Upload className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="font-medium">Drop PDFs here or click to upload</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Upload research papers directly as PDF files
                </p>
              </div>
            </button>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-muted-foreground">
                  {pdfFiles.length} file{pdfFiles.length !== 1 ? "s" : ""} selected
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingPdfs}
                >
                  Add More
                </Button>
              </div>

              <ScrollArea className="flex-1 border rounded-lg">
                <div className="p-2 space-y-1">
                  {pdfFiles.map((pdf, index) => (
                    <div
                      key={`${pdf.name}-${index}`}
                      className="flex items-center gap-3 p-2 rounded hover:bg-muted/50"
                    >
                      <File className="h-5 w-5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{pdf.name}</p>
                        {pdf.error && (
                          <p className="text-xs text-destructive">{pdf.error}</p>
                        )}
                      </div>
                      {pdf.status === "pending" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleRemovePdf(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                      {pdf.status === "uploading" && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                      {pdf.status === "processing" && (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      )}
                      {pdf.status === "done" && (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      )}
                      {pdf.status === "error" && (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {isUploadingPdfs && (
                <div className="mt-3">
                  <Progress value={uploadProgress} className="w-full" />
                  <p className="text-xs text-muted-foreground mt-1 text-center">
                    {uploadProgress < 50
                      ? "Uploading files..."
                      : uploadProgress < 100
                        ? "Processing PDFs..."
                        : "Done!"}
                  </p>
                </div>
              )}
            </>
          )}

          {pdfFiles.length > 0 && !isUploadingPdfs && (
            <div className="flex items-center justify-between pt-4 border-t mt-4">
              <Button variant="outline" onClick={() => setPdfFiles([])}>
                Clear All
              </Button>
              <Button onClick={handleUploadPdfs}>
                Upload & Process {pdfFiles.length} PDF
                {pdfFiles.length !== 1 ? "s" : ""}
              </Button>
            </div>
          )}
        </TabsContent>

        {/* JSON/CSV Tab */}
        <TabsContent value="data" className="flex-1 flex flex-col m-0">
          {!fileName ? (
            <button
              onClick={handleFileSelect}
              className={cn(
                "flex-1 border-2 border-dashed rounded-lg",
                "flex flex-col items-center justify-center gap-4",
                "hover:border-primary/50 hover:bg-muted/30 transition-colors",
                "cursor-pointer"
              )}
            >
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="font-medium">Click to upload a data file</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Supports JSON and CSV with paper metadata
                </p>
              </div>
            </button>
          ) : parseError ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="h-8 w-8 text-destructive" />
              </div>
              <div className="text-center">
                <p className="font-medium text-destructive">Parse Error</p>
                <p className="text-sm text-muted-foreground mt-1">{parseError}</p>
              </div>
              <Button variant="outline" onClick={handleClear}>
                Try Another File
              </Button>
            </div>
          ) : (
            <>
              {/* File info */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 mb-4">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{fileName}</p>
                    <p className="text-sm text-muted-foreground">
                      {papers.length} papers found
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleClear}
                  className="h-8 w-8"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Preview */}
              <ScrollArea className="flex-1 border rounded-lg">
                <div className="p-2 space-y-1">
                  {papers.slice(0, 50).map((paper, index) => (
                    <div
                      key={paper.externalId || index}
                      className="p-2 rounded hover:bg-muted/50"
                    >
                      <p className="font-medium text-sm line-clamp-1">
                        {paper.title}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                        {paper.authors?.[0] && <span>{paper.authors[0]}</span>}
                        {paper.year && <span>({paper.year})</span>}
                      </div>
                    </div>
                  ))}
                  {papers.length > 50 && (
                    <p className="text-center text-sm text-muted-foreground py-2">
                      + {papers.length - 50} more papers
                    </p>
                  )}
                </div>
              </ScrollArea>
            </>
          )}

          {/* Actions */}
          {papers.length > 0 && (
            <div className="flex items-center justify-between pt-4 border-t mt-4">
              <p className="text-sm text-muted-foreground">
                Ready to import {papers.length} documents
              </p>
              <Button onClick={handleImport} disabled={isImporting}>
                {isImporting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Import Documents
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
