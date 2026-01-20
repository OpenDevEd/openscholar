"use client";

import React from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileJson, FileSpreadsheet, Loader2 } from "lucide-react";
import { downloadAsFile, jsonToCSV, generateFilename } from "@/lib/utils";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";

interface ExportMenuProps {
  analysisId: Id<"analyses">;
  analysisName: string;
  variant?: "button" | "icon";
}

export function ExportMenu({
  analysisId,
  analysisName,
  variant = "button",
}: ExportMenuProps) {
  const exportData = useQuery(api.extraction.documents.getExportData, {
    analysisId,
  });

  const handleExportJSON = () => {
    if (!exportData) {
      toast.error("Data not ready for export");
      return;
    }

    const filename = generateFilename(analysisName, "extraction", "json");
    downloadAsFile(JSON.stringify(exportData, null, 2), filename, "json");
    toast.success("Exported as JSON");
  };

  const handleExportCSV = () => {
    if (!exportData) {
      toast.error("Data not ready for export");
      return;
    }

    // Flatten for CSV: one row per document with extraction values as columns
    const rows = exportData.documents.map((doc) => {
      const row: Record<string, any> = {
        title: doc.title,
        authors: doc.authors?.join("; ") || "",
        year: doc.year || "",
        doi: doc.doi || "",
        abstract: doc.abstract || "",
      };

      // Add extraction columns
      for (const q of exportData.questions) {
        const extraction = doc.extractions[q.key];
        row[q.key] = extraction?.value ?? "";
        row[`${q.key}_confidence`] = extraction?.confidence ?? "";
      }

      return row;
    });

    const csv = jsonToCSV(rows);
    const filename = generateFilename(analysisName, "extraction", "csv");
    downloadAsFile(csv, filename, "csv");
    toast.success("Exported as CSV");
  };

  const handleExportResultsOnly = () => {
    if (!exportData) {
      toast.error("Data not ready for export");
      return;
    }

    // Just the essential extraction results
    const rows = exportData.documents.map((doc) => {
      const row: Record<string, any> = {
        title: doc.title,
        doi: doc.doi || "",
      };

      for (const q of exportData.questions) {
        const extraction = doc.extractions[q.key];
        row[q.key] = extraction?.value ?? "";
      }

      return row;
    });

    const csv = jsonToCSV(rows);
    const filename = generateFilename(analysisName, "results", "csv");
    downloadAsFile(csv, filename, "csv");
    toast.success("Exported results as CSV");
  };

  const isLoading = !exportData;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "icon" ? (
          <Button variant="outline" size="icon" disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
          </Button>
        ) : (
          <Button variant="outline" disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Export
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={handleExportJSON}>
          <FileJson className="h-4 w-4 mr-2" />
          Full Export (JSON)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportCSV}>
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Full Export (CSV)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleExportResultsOnly}>
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Results Only (CSV)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
