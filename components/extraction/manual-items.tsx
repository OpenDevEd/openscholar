"use client";
"use no memo"; // try/finally in handlers

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useExtractionStore } from "@/lib/store/extraction";
import { cn } from "@/lib/utils";
import { useAppToast } from "@/lib/toast";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import { FileUp, Plus, Trash2 } from "lucide-react";

const ACCEPTED_TYPES = ["application/pdf"];
const MAX_FILE_MB = 25;

export function ManualItems() {
  const toast = useAppToast();
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const tToast = useTranslations("toast");
  const { draftJob, addManualItem, updateManualItem, removeManualItem } = useExtractionStore();
  const generateUploadUrl = useMutation(api.extraction.uploads.generateUploadUrl);
  const [uploadingIds, setUploadingIds] = useState<string[]>([]);
  const pdfEnabled = useFeatureFlag("extraction.pdf");

  const handleFileUpload = async (id: string, file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.validation.fileType(tToast("entityPdf"));
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast.validation.fileSize(MAX_FILE_MB);
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
        toast.io.uploadFailed(tToast("entityPdf"));
        return;
      }
      const { storageId } = await result.json();
      updateManualItem(id, { storageId, pdfUrl: undefined });
    } catch (error) {
      toast.io.uploadFailed(tToast("entityPdf"));
    } finally {
      setUploadingIds((prev) => prev.filter((itemId) => itemId !== id));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {t("addPapersDescription")}
        </div>
        <Button size="sm" variant="secondary" onClick={() => addManualItem()}>
          <Plus className="h-4 w-4 mr-2" /> {t("addPaper")}
        </Button>
      </div>

      {draftJob.manualItems.length === 0 && (
        <div className="rounded-xl border border-border bg-muted p-6 text-sm text-muted-foreground">
          {t("noManualItems")}
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
                    placeholder={t("paperTitle")}
                    value={item.title}
                    onChange={(e) => updateManualItem(item.id, { title: e.target.value })}
                  />
                  <Textarea
                    placeholder={t("abstractOptional")}
                    value={item.abstract || ""}
                    rows={3}
                    onChange={(e) => updateManualItem(item.id, { abstract: e.target.value })}
                  />
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      placeholder={t("authorsCommaSeparated")}
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
                      placeholder={t("publicationYear")}
                      type="number"
                      value={item.year ?? ""}
                      onChange={(e) => {
                        const next = e.target.value ? Number(e.target.value) : undefined;
                        updateManualItem(item.id, { year: Number.isFinite(next as number) ? (next as number) : undefined });
                      }}
                    />
                    <Input
                      placeholder={t("doi")}
                      value={item.doi || ""}
                      onChange={(e) => updateManualItem(item.id, { doi: e.target.value })}
                    />
                    {pdfEnabled ? (
                      <Input
                        placeholder={t("pdfUrlOptional")}
                        value={item.pdfUrl || ""}
                        onChange={(e) => updateManualItem(item.id, { pdfUrl: e.target.value, storageId: undefined })}
                      />
                    ) : null}
                  </div>
                  {pdfEnabled ? (
                    <div className="flex items-center gap-3">
                      <Button asChild variant="outline" size="sm" disabled={isUploading}>
                        <label className="cursor-pointer">
                          <FileUp className="h-4 w-4 mr-2" />
                          {item.storageId ? t("replacePdf") : t("attachPdf")}
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
                        <span className="text-xs text-muted-foreground">{tc("pdfAttached")}</span>
                      )}
                    </div>
                  ) : null}
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
