"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, FileSpreadsheet, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { exportToCSV, exportToJSON, exportToExcel } from "@/lib/extraction/export";
import type { PaperWithResults, Question } from "@/lib/extraction/filtering";
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

interface BulkActionsBarProps {
  selectedIds: Set<string>;
  papers: PaperWithResults[];
  questions: Question[];
  onClearSelection: () => void;
}

export function BulkActionsBar({
  selectedIds,
  papers,
  questions,
  onClearSelection,
}: BulkActionsBarProps) {
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [format, setFormat] = useState<'csv' | 'json' | 'excel'>('csv');
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includeConfidence, setIncludeConfidence] = useState(true);
  const [includeReasoning, setIncludeReasoning] = useState(false);
  const [includeCitations, setIncludeCitations] = useState(false);

  const handleExport = () => {
    const options = {
      includeMetadata,
      includeConfidence,
      includeReasoning,
      includeCitations,
    };

    if (format === 'csv') {
      exportToCSV(papers, questions, options);
    } else if (format === 'json') {
      exportToJSON(papers, questions, options);
    } else {
      exportToExcel(papers, questions, options);
    }

    setExportDialogOpen(false);
  };

  return (
    <>
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
          >
            <Card className="shadow-2xl border-primary/20 py-4">
              <CardContent className="flex items-center gap-4 px-6">
                <span className="text-sm font-medium">
                  {selectedIds.size} paper{selectedIds.size !== 1 ? 's' : ''} selected
                </span>
                <div className="h-6 w-px bg-border" />
                <Button size="sm" onClick={() => setExportDialogOpen(true)}>
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
                <div className="h-6 w-px bg-border" />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onClearSelection}
                >
                  Clear
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Export Results</DialogTitle>
            <DialogDescription>
              Choose export format and options for {selectedIds.size} selected paper{selectedIds.size !== 1 ? 's' : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Export format</Label>
              <RadioGroup value={format} onValueChange={(v) => setFormat(v as any)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="csv" id="csv" />
                  <Label htmlFor="csv" className="font-normal cursor-pointer flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4" />
                    CSV (Excel-compatible)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="excel" id="excel" />
                  <Label htmlFor="excel" className="font-normal cursor-pointer flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4" />
                    Excel (.xlsx) with summary
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="json" id="json" />
                  <Label htmlFor="json" className="font-normal cursor-pointer flex items-center gap-2">
                    <FileJson className="w-4 h-4" />
                    JSON (for processing)
                  </Label>
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label>Include</Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="metadata"
                    checked={includeMetadata}
                    onCheckedChange={(checked) => setIncludeMetadata(checked as boolean)}
                  />
                  <Label htmlFor="metadata" className="font-normal cursor-pointer">
                    Paper metadata (authors, DOI, year)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="confidence"
                    checked={includeConfidence}
                    onCheckedChange={(checked) => setIncludeConfidence(checked as boolean)}
                  />
                  <Label htmlFor="confidence" className="font-normal cursor-pointer">
                    Confidence scores
                  </Label>
                </div>
                {format === 'json' && (
                  <>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="reasoning"
                        checked={includeReasoning}
                        onCheckedChange={(checked) => setIncludeReasoning(checked as boolean)}
                      />
                      <Label htmlFor="reasoning" className="font-normal cursor-pointer">
                        AI reasoning
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="citations"
                        checked={includeCitations}
                        onCheckedChange={(checked) => setIncludeCitations(checked as boolean)}
                      />
                      <Label htmlFor="citations" className="font-normal cursor-pointer">
                        Citation text
                      </Label>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleExport}>
              Export {selectedIds.size} paper{selectedIds.size !== 1 ? 's' : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
