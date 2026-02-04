"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useExtractionStore } from "@/lib/store/extraction";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { FileUp, Plus, Trash2 } from "lucide-react";

const ACCEPTED_TYPES = ["application/pdf"];
const MAX_FILE_MB = 25;

export function ManualItems() {
  const { draftJob, addManualItem, updateManualItem, removeManualItem } = useExtractionStore();
  const generateUploadUrl = useMutation(api.extraction.uploads.generateUploadUrl);
  const [uploadingIds, setUploadingIds] = useState<string[]>([]);

  const handleFileUpload = async (id: string, file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error("Only PDF files are supported");
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast.error(`PDF must be under ${MAX_FILE_MB}MB`);
      return;
    }

    setUploadingIds((prev) => [...prev, id]);
    try {
      const uploadUrl = await generateUploadUrl({});
      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!result.ok) {
        toast.error("Upload failed. Please try again.");
        return;
      }
      const { storageId } = await result.json();
      updateManualItem(id, { storageId, pdfUrl: undefined });
    } catch (error) {
      toast.error("Upload failed. Please try again.");
    } finally {
      setUploadingIds((prev) => prev.filter((itemId) => itemId !== id));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Add papers manually with optional PDF upload.
        </div>
        <Button size="sm" variant="secondary" onClick={() => addManualItem()}>
          <Plus className="h-4 w-4 mr-2" /> Add paper
        </Button>
      </div>

      {draftJob.manualItems.length === 0 && (
        <div className="rounded-xl border border-border bg-muted p-6 text-sm text-muted-foreground">
          No manual items yet.
        </div>
      )}

      <div className="space-y-4">
        {draftJob.manualItems.map((item, index) => {
          const isUploading = uploadingIds.includes(item.id);
          return (
            <div
              key={item.id}
              className={cn(
                "rounded-xl border border-border p-4",
                index % 2 === 0 ? "bg-background" : "bg-muted/30"
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-3">
                  <Input
                    placeholder="Paper title"
                    value={item.title}
                    onChange={(e) => updateManualItem(item.id, { title: e.target.value })}
                  />
                  <Textarea
                    placeholder="Abstract (optional)"
                    value={item.abstract || ""}
                    rows={3}
                    onChange={(e) => updateManualItem(item.id, { abstract: e.target.value })}
                  />
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      placeholder="Authors (comma-separated)"
                      value={item.authors?.join(", ") || ""}
                      onChange={(e) =>
                        updateManualItem(item.id, {
                          authors: e.target.value
                            .split(",")
                            .map((name) => name.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                    <Input
                      placeholder="Publication year"
                      type="number"
                      value={item.year ?? ""}
                      onChange={(e) => {
                        const next = e.target.value ? Number(e.target.value) : undefined;
                        updateManualItem(item.id, { year: Number.isFinite(next as number) ? (next as number) : undefined });
                      }}
                    />
                    <Input
                      placeholder="DOI"
                      value={item.doi || ""}
                      onChange={(e) => updateManualItem(item.id, { doi: e.target.value })}
                    />
                    <Input
                      placeholder="PDF URL (optional)"
                      value={item.pdfUrl || ""}
                      onChange={(e) => updateManualItem(item.id, { pdfUrl: e.target.value, storageId: undefined })}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <Button asChild variant="outline" size="sm" disabled={isUploading}>
                      <label className="cursor-pointer">
                        <FileUp className="h-4 w-4 mr-2" />
                        {item.storageId ? "Replace PDF" : "Attach PDF"}
                        <input
                          type="file"
                          accept="application/pdf"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              handleFileUpload(item.id, file);
                            }
                          }}
                        />
                      </label>
                    </Button>
                    {item.storageId && (
                      <span className="text-xs text-muted-foreground">PDF attached</span>
                    )}
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeManualItem(item.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
