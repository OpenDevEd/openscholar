"use client";

import React, { useState } from 'react';
import { useScreeningStore, useAIConfigStore } from '@/lib/store';
import { performScreening } from '@/app/actions/screening';
import { estimateScreeningTime } from '@/lib/screening-utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Brain, CheckCircle, Clock, Loader2, Zap, Settings } from 'lucide-react';
import { toast } from 'sonner';

interface AIScreeningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AIScreeningDialog({ open, onOpenChange }: AIScreeningDialogProps) {
  const { documents, questions, addAIScreeningResults } = useScreeningStore();
  const { provider, apiKey } = useAIConfigStore();
  
  const [isScreening, setIsScreening] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [completedDocuments, setCompletedDocuments] = useState(0);
  const [batchSize, setBatchSize] = useState(5);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isConfigured = provider && apiKey;
  const canStart = isConfigured && documents.length > 0 && questions.length > 0;

  const { estimatedMinutes, totalBatches: estimatedBatches } = estimateScreeningTime(
    documents.length,
    questions.length,
    batchSize
  );

  const handleStartScreening = async () => {
    if (!canStart) return;

    setIsScreening(true);
    setProgress(0);
    setCurrentBatch(0);
    setTotalBatches(0);
    setCompletedDocuments(0);

    try {
      const results = await performScreening(
        documents,
        questions,
        provider,
        apiKey,
        batchSize,
        (completed, total, currentBatchNum, totalBatchesNum) => {
          setCompletedDocuments(completed);
          setCurrentBatch(currentBatchNum);
          setTotalBatches(totalBatchesNum);
          setProgress((completed / total) * 100);
        }
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
      // Note: In a real implementation, you'd want to implement cancellation logic
      toast.info("Screening cannot be cancelled once started", {
        description: "Please wait for the current batch to complete.",
      });
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-600" />
            AI-Powered Screening
          </DialogTitle>
          <DialogDescription>
            Use AI to automatically screen your documents based on your configured questions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Configuration and Preview Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Configuration Status */}
            <Card className="h-fit">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Provider</span>
                  <Badge variant={provider ? "default" : "secondary"} className="text-xs">
                    {provider ? provider.toUpperCase() : "Not set"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">API Key</span>
                  <Badge variant={apiKey ? "default" : "destructive"} className="text-xs">
                    {apiKey ? "✓ Set" : "Missing"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Documents</span>
                  <Badge variant={documents.length > 0 ? "default" : "secondary"} className="text-xs">
                    {documents.length}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Questions</span>
                  <Badge variant={questions.length > 0 ? "default" : "secondary"} className="text-xs">
                    {questions.length}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Screening Preview */}
            {canStart && (
              <Card className="h-fit">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    Screening Preview
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total Documents</span>
                    <span className="font-medium">{documents.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Questions Each</span>
                    <span className="font-medium">{questions.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Batches</span>
                    <span className="font-medium">{estimatedBatches}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Est. Time</span>
                    <Badge variant="outline" className="text-xs">
                      <Clock className="h-3 w-3 mr-1" />
                      ~{estimatedMinutes}m
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Advanced Settings - Collapsible */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Advanced Settings
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="h-6 px-2 text-xs"
                >
                  {showAdvanced ? "Hide" : "Show"}
                </Button>
              </div>
            </CardHeader>
            {showAdvanced && (
              <CardContent className="pt-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="batch-size" className="text-sm">Batch Size</Label>
                    <Input
                      id="batch-size"
                      type="number"
                      min="1"
                      max="20"
                      value={batchSize}
                      onChange={(e) => setBatchSize(Math.max(1, Math.min(20, parseInt(e.target.value) || 5)))}
                      disabled={isScreening}
                      className="h-8"
                    />
                  </div>
                  <div className="flex items-end">
                    <p className="text-xs text-muted-foreground">
                      Documents per batch. Smaller = more reliable, slower.
                    </p>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Progress Display */}
          {isScreening && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Screening in Progress
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Overall Progress</span>
                      <span className="font-mono">{completedDocuments}/{documents.length}</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>
                  
                  {totalBatches > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span>Current Batch</span>
                        <span className="font-mono">{currentBatch}/{totalBatches}</span>
                      </div>
                      <Progress value={(currentBatch / totalBatches) * 100} className="h-2" />
                    </div>
                  )}
                </div>

                <p className="text-xs text-muted-foreground text-center">
                  Processing documents with AI... This may take several minutes.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Warnings */}
          {!isConfigured && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800">
              <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                  AI Configuration Required
                </p>
                <p className="text-sm text-yellow-700 dark:text-yellow-300">
                  Configure your AI provider and API key in the AI Config tab.
                </p>
              </div>
            </div>
          )}

          {isConfigured && (!documents.length || !questions.length) && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
              <AlertTriangle className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                  Documents and Questions Required
                </p>
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  {!documents.length && !questions.length 
                    ? "Add documents and screening questions to start."
                    : !documents.length 
                    ? "Add documents to screen."
                    : "Add screening questions."
                  }
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleCancel} disabled={isScreening} className="w-full sm:w-auto">
            {isScreening ? "Close" : "Cancel"}
          </Button>
          <Button 
            onClick={handleStartScreening} 
            disabled={!canStart || isScreening}
            className="w-full sm:w-auto bg-gradient-to-r from-purple-500 to-blue-600 hover:from-purple-600 hover:to-blue-700"
          >
            {isScreening ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Screening...
              </>
            ) : (
              <>
                <Brain className="mr-2 h-4 w-4" />
                Start AI Screening
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 