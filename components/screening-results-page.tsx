"use client";

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useScreeningStore } from '@/lib/store';
import { FileText, Download, ArrowLeft, Table as TableIcon, Trash2, RefreshCcw, ClipboardCheck, Sparkles, BarChart3 } from 'lucide-react';
import { ScreeningDataTableShadcn } from '@/components/screening/screening-data-table-shadcn';
import { toast } from 'sonner';
import { generateScreeningCsv } from '@/lib/screening-utils';

interface ScreeningResultsPageProps {
  showBackButton?: boolean;
  onBack?: () => void;
  searchId?: string;
}

export function ScreeningResultsPage({ 
  showBackButton = false, 
  onBack,
  searchId
}: ScreeningResultsPageProps) {
  const router = useRouter();
  const { 
    documents, 
    questions, 
    results,
    isScreeningStarted,
    resetScreening
  } = useScreeningStore();
  
  const [showClearDialog, setShowClearDialog] = useState(false);

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  };

  const completedResults = results.filter(r => r.status === 'completed').length;
  const failedResults = results.filter(r => r.status === 'error').length;
  const pendingResults = results.filter(r => r.status === 'pending').length;
  const totalCost = results.reduce((sum, r) => sum + (r.cost ?? 0), 0);

  // Prepare data for the table
  const tableData = useMemo(() => {
    return documents.map(document => {
      const result = results.find(r => r.documentId === document.id);
      const rowData: any = {
        id: document.id,
        title: document.title,
        abstract: document.abstract || '',
        authors: document.authorships?.map(a => a.author.display_name) || [],
        year: document.publication_year || '',
        status: result?.status || 'pending',
        completedAt: result?.completedAt || '',
        pdfStatus: result?.pdfStatus || 'metadata',
        pdfErrorMessage: result?.pdfErrorMessage || '',
        source: document.source || '',
        zotero_group_id: (document as any).zotero_group_id || '',
        zotero_uri: (document as any).zotero_uri || '',
        // AI metadata
        aiProvider: result?.aiMetadata?.provider || '',
        aiConfidence: result?.aiMetadata?.confidence || '',
        aiFlags: result?.aiMetadata?.flags?.join(', ') || '',
        aiReasoning: result?.aiMetadata?.reasoning || '',
        cost: result?.cost ?? '',
      };

      // Add answers for each question
      questions.forEach(question => {
        rowData[question.key] = result?.answers[question.key] ?? '';
      });

      return rowData;
    });
  }, [documents, results, questions]);

  const handleExportResults = () => {
    const csvEscape = (val: any) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      return `"${str.replace(/"/g, '""')}"`;
    };
    const hasZotero = tableData.some((row) => row.source === 'zotero');
    // Create CSV content
    const headers = [
      'ID',
      ...(hasZotero ? ['Group ID', 'Zotero URI'] : []),
      'Title', 'Abstract', 'Authors', 'Year', 'Status', 'Completed At', 'PDF Status',
      'AI Provider', 'AI Confidence', 'AI Flags', 'AI Reasoning', 'Cost',
      ...questions.map(q => q.question)
    ];
    const csvContent = generateScreeningCsv(tableData, questions);

    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `screening-results-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleClearResults = () => {
    resetScreening();
    setShowClearDialog(false);
    toast.success("Screening results cleared", {
      description: "All screening results have been cleared. Documents and questions remain.",
    });
  };

  if (documents.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto p-6">
          <PageHeader
          title="Screening Results"
          description="No documents available for screening"
          icon={FileText}
          showBackButton={showBackButton}
          onBack={handleBack}
        />
        <Card>
          <CardContent className="p-8 text-center">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-muted-foreground">No documents have been added for screening.</p>
            <Button onClick={handleBack} className="mt-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Screening
            </Button>
          </CardContent>
        </Card>
      </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="container mx-auto p-6">
        <PageHeader
        title="Screening Results"
        description="Review and export your systematic screening results"
        icon={TableIcon}
        showBackButton={showBackButton}
        onBack={handleBack}
        infoItems={[
          { label: `${completedResults} completed out of ${documents.length} documents`, color: 'bg-green-500' },
          { label: `${failedResults} failed`, color: 'bg-red-500' },
          { label: `${pendingResults} pending`, color: 'bg-gray-500' },
          { label: `$${totalCost.toFixed(2)} spent`, color: 'bg-yellow-500' }
        ]}
      />

      <div className="space-y-6">
        {/* Summary Card */}
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <TableIcon className="h-5 w-5" />
                  Screening Summary
                </CardTitle>
                <CardDescription>
                  Overview of your screening progress and results
                </CardDescription>
              </div>
              <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handleExportResults}
                  disabled={results.length === 0}
                  className="w-full sm:w-auto"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowClearDialog(true)}
                  disabled={results.length === 0}
                  className="text-destructive hover:text-destructive w-full sm:w-auto"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear Results
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Main Progress Bar */}
            <div className="mb-8">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Total Progress</span>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {completedResults} of {documents.length}
                  </span>
                </div>
                <span className="text-sm font-medium">
                  {((completedResults / documents.length) * 100).toFixed(0)}%
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full transition-all duration-500 ease-in-out flex"
                  style={{ width: `${(completedResults / documents.length) * 100}%` }}
                />
              </div>
            </div>

            {/* Status Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
              {/* Completed */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  <span className="text-sm text-muted-foreground">Completed</span>
                </div>
                <p className="text-2xl font-semibold">{completedResults}</p>
              </div>

              {/* Failed */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-red-500" />
                  <span className="text-sm text-muted-foreground">Failed</span>
                </div>
                <p className="text-2xl font-semibold">{failedResults}</p>
              </div>

              {/* Questions */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-blue-500" />
                  <span className="text-sm text-muted-foreground">Questions</span>
                </div>
                <p className="text-2xl font-semibold">{questions.length}</p>
              </div>

              {/* Cost */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-yellow-500" />
                  <span className="text-sm text-muted-foreground">Total Cost</span>
                </div>
                <p className="text-2xl font-semibold">${totalCost.toFixed(2)}</p>
              </div>
            </div>

            {/* Additional Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="flex items-center justify-between md:flex-col md:items-start p-4 rounded-lg border bg-card/50">
                <span className="text-muted-foreground">Success Rate</span>
                <span className="font-medium">
                  {((completedResults - failedResults) / Math.max(completedResults, 1) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between md:flex-col md:items-start p-4 rounded-lg border bg-card/50">
                <span className="text-muted-foreground">Avg. Cost per Document</span>
                <span className="font-medium">
                  ${(totalCost / Math.max(completedResults, 1)).toFixed(3)}
                </span>
              </div>
              <div className="flex items-center justify-between md:flex-col md:items-start p-4 rounded-lg border bg-card/50">
                <span className="text-muted-foreground">Pending Documents</span>
                <span className="font-medium">{pendingResults}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results Table */}
        <Card className='relative'>
          <CardHeader>
            <CardTitle>Detailed Results</CardTitle>
            <CardDescription>
              Complete screening results for all documents and questions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScreeningDataTableShadcn data={tableData} questions={questions} />
          </CardContent>
        </Card>
      </div>

      {/* Clear Confirmation Dialog */}
      <Dialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear All Screening Results?</DialogTitle>
            <DialogDescription>
              This action will permanently delete all screening results, including manual answers and AI-generated results. 
              Your documents and questions will remain unchanged. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowClearDialog(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearResults}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear Results
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
} 