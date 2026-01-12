"use client";

import React, { useState } from 'react';
import { useScreeningStore, useAIConfigStore, useZoteroConfigStore } from '@/lib/store';
import { performScreening } from '@/app/actions/screening';
import { estimateScreeningTime } from '@/lib/screening-utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, Brain, CheckCircle, Clock, Loader2, Zap, Settings, FileText, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';

interface AIScreeningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentsToScreen?: any[]; // Optional: specific documents to screen (for rescreen)
  title?: string; // Optional: custom title
  actionLabel?: string; // Optional: custom action button label
}

export function AIScreeningDialog({ 
  open, 
  onOpenChange,
  documentsToScreen,
  title = "AI-Powered Screening",
  actionLabel = "Start AI Screening"
}: AIScreeningDialogProps) {
  const { documents, questions, addAIScreeningResults } = useScreeningStore();
  const { provider, model, apiKey, dollarsUsed, budget } = useAIConfigStore();
  const { zoteroApiKey, zoteroGroupId } = useZoteroConfigStore();
  
  const [isScreening, setIsScreening] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [completedDocuments, setCompletedDocuments] = useState(0);
  const [batchSize, setBatchSize] = useState(5);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [usePdfs, setUsePdfs] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'advanced'>('overview');

  // Use provided documents or all documents
  const targetDocuments = documentsToScreen || documents;
  
  const isConfigured = provider && apiKey;
  const canStart = isConfigured && targetDocuments.length > 0 && questions.length > 0;

  const { estimatedMinutes, totalBatches: estimatedBatches } = estimateScreeningTime(
    targetDocuments.length,
    questions.length,
    batchSize
  );

  const handleStartScreening = async () => {
    if (!canStart) return;

    setIsScreening(true);
    setActiveTab('overview');
    setProgress(0);
    setCurrentBatch(0);
    setTotalBatches(0);
    setCompletedDocuments(0);

    try {
      // Prepare Zotero auth if available
      const zoteroAuth = zoteroApiKey && zoteroGroupId ? { apiKey: zoteroApiKey, groupId: zoteroGroupId } : undefined;
      
      const results = await performScreening(
        targetDocuments,
        questions,
        provider,
        apiKey,
        model,
        batchSize,
        (completed, total, currentBatchNum, totalBatchesNum) => {
          setCompletedDocuments(completed);
          setCurrentBatch(currentBatchNum);
          setTotalBatches(totalBatchesNum);
          setProgress((completed / total) * 100);
        },
        usePdfs,
        zoteroAuth
      );

      // Add results to store
      addAIScreeningResults(results);

      toast.success("AI Screening Complete", {
        description: `Successfully screened ${results.length} documents with ${questions.length} questions.`,
      });

      onOpenChange(false);
    } catch (error) {
      console.error('AI Screening failed:', error);
      toast.error("AI Screening Failed", {
        description: error instanceof Error ? error.message : "Unknown error occurred during screening",
      });
    } finally {
      setIsScreening(false);
      setProgress(0);
      setCurrentBatch(0);
      setTotalBatches(0);
      setCompletedDocuments(0);
    }
  };

  const handleCancel = () => {
    if (isScreening) {
      toast.info("Screening cannot be cancelled once started", {
        description: "Please wait for the current batch to complete.",
      });
      return;
    }
    onOpenChange(false);
  };

  /* ------------------------------ UI RENDER ------------------------------ */
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl w-full p-0 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b bg-background/50 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-md bg-gradient-to-br from-purple-600 to-blue-600 text-white flex-shrink-0">
              <Brain className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <DialogTitle className="text-lg font-semibold leading-none tracking-tight">
                {title}
              </DialogTitle>
              <DialogDescription>
                Configure and run AI powered screening for your documents.
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* Body */}
        <ScrollArea className="max-h-[70vh] overflow-y-auto px-6 py-4">
          <Tabs value={activeTab} onValueChange={(v)=>setActiveTab(v as any)} className="w-full">
            <TabsList className="grid grid-cols-2 w-full mb-6">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-6">
              {/* Stats Grid */}
              <div className="grid sm:grid-cols-2 gap-4">
                {/* Configuration */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base font-medium">Configuration</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Provider</span>
                      <Badge variant={provider ? 'default' : 'secondary'}>{provider ? provider.toUpperCase() : 'Not set'}</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">API Key</span>
                      <Badge variant={apiKey ? 'default' : 'destructive'}>{apiKey ? 'Configured' : 'Missing'}</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Documents</span>
                      <Badge variant={targetDocuments.length ? 'default' : 'secondary'}>{targetDocuments.length}</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Questions</span>
                      <Badge variant={questions.length ? 'default' : 'secondary'}>{questions.length}</Badge>
                    </div>
                  </CardContent>
                </Card>

                {/* Preview */}
                {canStart && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base font-medium">Run Preview</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Batches</span>
                        <span className="font-medium">{estimatedBatches}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Est. Time</span>
                        <Badge variant="outline">
                          <Clock className="h-3 w-3 mr-1" />~{estimatedMinutes}m
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Current Usage</span>
                        <span className="font-medium">${dollarsUsed.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Budget</span>
                        <span className="font-medium">{budget > 0 ? `$${budget.toFixed(2)}` : 'Unlimited'}</span>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Screening Progress */}
              {isScreening && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Progress
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Progress value={progress} className="h-2" />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{completedDocuments}/{targetDocuments.length} processed</span>
                        <span>{Math.round(progress)}%</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Advanced Tab */}
            <TabsContent value="advanced" className="space-y-6">
              {/* Batch Size */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-medium">Batch Size</CardTitle>
                  <CardDescription>Documents processed per request</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-4">
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={batchSize}
                    disabled={isScreening}
                    onChange={(e)=>setBatchSize(Math.max(1, Math.min(20, Number(e.target.value)||5)))}
                    className="w-24"
                  />
                  <p className="text-xs text-muted-foreground">Smaller batches are slower but more reliable.</p>
                </CardContent>
              </Card>

              {/* PDF Toggle */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-medium flex items-center gap-2">
                    <FileText className="h-4 w-4" />Use PDFs
                  </CardTitle>
                  <CardDescription>Include PDF content when available.</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground max-w-md">
                    PDFs will be downloaded and sent to the model which may increase cost and processing time but improves accuracy.
                  </p>
                  <Switch id="use-pdfs" checked={usePdfs} disabled={isScreening} onCheckedChange={setUsePdfs} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Warnings */}
          {!isConfigured && (
            <div className="mt-6 flex items-center gap-3 p-3 rounded-md border border-yellow-200 bg-yellow-50 text-sm text-yellow-800">
              <AlertTriangle className="h-4 w-4" />AI provider and key required.
            </div>
          )}
          {isConfigured && (!targetDocuments.length || !questions.length) && (
            <div className="mt-6 flex items-center gap-3 p-3 rounded-md border border-blue-200 bg-blue-50 text-sm text-blue-800">
              <AlertTriangle className="h-4 w-4" />Add { !targetDocuments.length ? 'documents' : 'questions' } before starting.
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-background/50 backdrop-blur supports-[backdrop-filter]:bg-background/70 flex flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleCancel} disabled={isScreening} className="w-full sm:w-auto">
            {isScreening ? 'Close' : 'Cancel'}
          </Button>
          <Button onClick={handleStartScreening} disabled={!canStart || isScreening} className="w-full sm:w-auto">
            {isScreening ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />Running...
              </>
            ) : (
              <>
                <Brain className="h-4 w-4 mr-2" />{actionLabel}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
} 