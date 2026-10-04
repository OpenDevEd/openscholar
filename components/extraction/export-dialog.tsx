"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, FileJson, Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { exportToCSV, exportToJSON, exportToExcel } from "@/lib/extraction/export";
import type { PaperWithResults, Question } from "@/lib/extraction/filtering";
import { useTranslations } from "next-intl";
import { useAppToast } from "@/lib/toast";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Read when the user exports, so opening the dialog reads nothing. */
  loadPapers: () => Promise<PaperWithResults[]>;
  paperCount: number;
  questions: Question[];
  label?: string;
}

export function ExportDialog({
  open,
  onOpenChange,
  loadPapers,
  paperCount,
  questions,
  label,
}: ExportDialogProps) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const toast = useAppToast();
  const [isLoading, setIsLoading] = useState(false);
  // Each export gets a number; closing the dialog moves it on, so a canceled export's
  // papers, arriving later, are dropped instead of downloaded.
  const exportRun = useRef(0);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      exportRun.current++;
      setIsLoading(false);
    }
    onOpenChange(next);
  };

  const [format, setFormat] = useState<"csv" | "json" | "excel">("csv");
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includeConfidence, setIncludeConfidence] = useState(true);
  const [includeReasoning, setIncludeReasoning] = useState(false);
  const [includeCitations, setIncludeCitations] = useState(false);

  const handleExport = async () => {
    if (isLoading || paperCount === 0) return;

    const options = {
      includeMetadata,
      includeConfidence,
      includeReasoning,
      includeCitations,
    };

    const run = ++exportRun.current;
    setIsLoading(true);
    try {
      const papers = await loadPapers();
      if (run !== exportRun.current) return;
      if (format === "csv") {
        exportToCSV(papers, questions, options);
      } else if (format === "json") {
        exportToJSON(papers, questions, options);
      } else {
        await exportToExcel(papers, questions, options);
      }
      handleOpenChange(false);
    } catch (error) {
      if (run !== exportRun.current) return;
      console.error("[Extraction] Failed to export results:", error);
      toast.io.downloadFailed(t(`${format}Label`));
    } finally {
      if (run === exportRun.current) setIsLoading(false);
    }
  };

  const displayLabel =
    label ?? tc("paperCount", { count: paperCount });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("exportResults")}</DialogTitle>
          <DialogDescription>
            {t("exportDescription", { label: displayLabel })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>{t("exportFormat")}</Label>
            <RadioGroup
              value={format}
              onValueChange={(v) => setFormat(v as "csv" | "json" | "excel")}
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="csv" id="export-csv" />
                <Label
                  htmlFor="export-csv"
                  className="font-normal cursor-pointer flex items-center gap-2"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  {t("csvLabel")}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="excel" id="export-excel" />
                <Label
                  htmlFor="export-excel"
                  className="font-normal cursor-pointer flex items-center gap-2"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  {t("excelLabel")}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="json" id="export-json" />
                <Label
                  htmlFor="export-json"
                  className="font-normal cursor-pointer flex items-center gap-2"
                >
                  <FileJson className="w-4 h-4" />
                  {t("jsonLabel")}
                </Label>
              </div>
            </RadioGroup>
          </div>
          <div className="space-y-2">
            <Label>{tc("include")}</Label>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="export-metadata"
                  checked={includeMetadata}
                  onCheckedChange={(checked) =>
                    setIncludeMetadata(checked as boolean)
                  }
                />
                <Label
                  htmlFor="export-metadata"
                  className="font-normal cursor-pointer"
                >
                  {t("paperMetadata")}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="export-confidence"
                  checked={includeConfidence}
                  onCheckedChange={(checked) =>
                    setIncludeConfidence(checked as boolean)
                  }
                />
                <Label
                  htmlFor="export-confidence"
                  className="font-normal cursor-pointer"
                >
                  {t("confidenceScores")}
                </Label>
              </div>
              {format === "json" && (
                <>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="export-reasoning"
                      checked={includeReasoning}
                      onCheckedChange={(checked) =>
                        setIncludeReasoning(checked as boolean)
                      }
                    />
                    <Label
                      htmlFor="export-reasoning"
                      className="font-normal cursor-pointer"
                    >
                      {t("aiReasoning")}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="export-citations"
                      checked={includeCitations}
                      onCheckedChange={(checked) =>
                        setIncludeCitations(checked as boolean)
                      }
                    />
                    <Label
                      htmlFor="export-citations"
                      className="font-normal cursor-pointer"
                    >
                      {t("citationText")}
                    </Label>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button disabled={isLoading || paperCount === 0} onClick={handleExport}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {tc("loading")}
              </>
            ) : (
              t("exportButton", { label: displayLabel })
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
