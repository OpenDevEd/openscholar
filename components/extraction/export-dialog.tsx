"use client";

import { useState } from "react";
import { FileSpreadsheet, FileJson } from "lucide-react";
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

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  papers: PaperWithResults[];
  questions: Question[];
  label?: string;
}

export function ExportDialog({
  open,
  onOpenChange,
  papers,
  questions,
  label,
}: ExportDialogProps) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");

  const [format, setFormat] = useState<"csv" | "json" | "excel">("csv");
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includeConfidence, setIncludeConfidence] = useState(true);
  const [includeReasoning, setIncludeReasoning] = useState(false);
  const [includeCitations, setIncludeCitations] = useState(false);

  const handleExport = async () => {
    const options = {
      includeMetadata,
      includeConfidence,
      includeReasoning,
      includeCitations,
    };

    if (format === "csv") {
      exportToCSV(papers, questions, options);
    } else if (format === "json") {
      exportToJSON(papers, questions, options);
    } else {
      await exportToExcel(papers, questions, options);
    }

    onOpenChange(false);
  };

  const displayLabel =
    label ?? tc("paperCount", { count: papers.length });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button onClick={handleExport}>{t("exportButton", { label: displayLabel })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
