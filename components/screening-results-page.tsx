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
import { FileText, Download, ArrowLeft, Table as TableIcon, Trash2 } from 'lucide-react';
import { ScreeningDataTableShadcn } from '@/components/screening/screening-data-table-shadcn';
import { toast } from 'sonner';

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
      router.push(searchId ? `/results/${searchId}/screening` : '/screening');
    }
  };

  const completedResults = results.filter(r => r.status === 'completed').length;
  const failedResults = results.filter(r => r.status === 'error').length;
  const pendingResults = results.filter(r => r.status === 'pending').length;

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
        // AI metadata
        aiProvider: result?.aiMetadata?.provider || '',
        aiConfidence: result?.aiMetadata?.confidence || '',
        aiFlags: result?.aiMetadata?.flags?.join(', ') || '',
        aiReasoning: result?.aiMetadata?.reasoning || '',
      };

      // Add answers for each question
      questions.forEach(question => {
        rowData[question.key] = result?.answers[question.key] ?? '';
      });

      return rowData;
    });
  }, [documents, results, questions]);

  const handleExportResults = () => {
    // Create CSV content
    const headers = [
      'Title', 'Abstract', 'Authors', 'Year', 'Status', 'Completed At', 
      'AI Provider', 'AI Confidence', 'AI Flags', 'AI Reasoning',
      ...questions.map(q => q.question)
    ];
    const csvContent = [
      headers.join(','),
      ...tableData.map(row => [
        `"${row.title.replace(/"/g, '""')}"`,
        `"${(row.abstract || '').replace(/"/g, '""')}"`,
        `"${(Array.isArray(row.authors) ? row.authors.join('; ') : String(row.authors)).replace(/"/g, '""')}"`,
        row.year,
        row.status,
        row.completedAt ? new Date(row.completedAt).toLocaleDateString() : '',
        row.aiProvider,
        row.aiConfidence,
        `"${row.aiFlags.replace(/"/g, '""')}"`,
        `"${row.aiReasoning.replace(/"/g, '""')}"`,
        ...questions.map(q => {
          const value = row[q.key];
          if (typeof value === 'string') {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        })
      ].join(','))
    ].join('\n');

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
    );
  }

  return (
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
          { label: `${pendingResults} pending`, color: 'bg-gray-500' }
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{completedResults}</div>
                <div className="text-sm text-muted-foreground">Completed</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{failedResults}</div>
                <div className="text-sm text-muted-foreground">Failed</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-600">{pendingResults}</div>
                <div className="text-sm text-muted-foreground">Pending</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{questions.length}</div>
                <div className="text-sm text-muted-foreground">Questions</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results Table */}
        <Card>
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
  );
} 