"use client";

import React, { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ArrowLeft,
  Database,
  Play,
  FileText,
  Loader2,
  Plus,
  Trash2,
  FolderPlus,
  History,
  Upload,
  Link,
  BookOpen,
  FileUp,
  CheckCircle2,
  Download,
  ExternalLink,
  Lock,
  Unlock,
  RefreshCw,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageWrapper } from "@/components/PageWrapper";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExtractionResultsTable } from "@/components/extraction/results-table";
import { SourceAddDialog } from "@/components/extraction/source-add-dialog";
import { ExportMenu } from "@/components/extraction/export-menu";
import { DocumentPdfUpload } from "@/components/extraction/document-pdf-upload";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AnalysisDetailClientProps {
  analysisId: string;
}

const STATUS_CONFIG = {
  draft: { label: "Draft", color: "bg-muted text-muted-foreground" },
  processing: { label: "Processing", color: "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400" },
  completed: { label: "Completed", color: "bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400" },
  failed: { label: "Failed", color: "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400" },
};

export function AnalysisDetailClient({ analysisId }: AnalysisDetailClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("overview");
  const [isStartingExtraction, setIsStartingExtraction] = useState(false);
  const [isStartingFullPipeline, setIsStartingFullPipeline] = useState(false);
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [isDownloadingOA, setIsDownloadingOA] = useState(false);
  const [pdfUploadDoc, setPdfUploadDoc] = useState<{
    id: Id<"documents">;
    title: string;
  } | null>(null);
  
  // Track which jobs we've shown toasts for (using ref to avoid re-render loops)
  const shownJobToasts = useRef<Set<string>>(new Set());

  const analysisData = useQuery(api.extraction.analyses.getWithStats, {
    id: analysisId as Id<"analyses">,
  });

  const extractionTable = useQuery(api.extraction.documents.getExtractionTable, {
    analysisId: analysisId as Id<"analyses">,
  });

  const sources = useQuery(api.extraction.sources.listByAnalysis, {
    analysisId: analysisId as Id<"analyses">,
  });

  const documents = useQuery(api.extraction.documents.listByAnalysis, {
    analysisId: analysisId as Id<"analyses">,
  });

  // Use new unified job system queries
  const latestPdfJob = useQuery(api.jobs.queries.getLatestJobByType, {
    analysisId: analysisId as Id<"analyses">,
    type: "pdf_download",
  });

  const latestIndexingJob = useQuery(api.jobs.queries.getLatestJobByType, {
    analysisId: analysisId as Id<"analyses">,
    type: "rag_indexing",
  });

  const latestExtractionJob = useQuery(api.jobs.queries.getLatestJobByType, {
    analysisId: analysisId as Id<"analyses">,
    type: "extraction",
  });

  // All jobs for this analysis (for potential job history view)
  const allJobs = useQuery(api.jobs.queries.getJobsForAnalysis, {
    analysisId: analysisId as Id<"analyses">,
  });

  // Check if jobs are currently running
  const isPdfJobRunning = latestPdfJob?.status === "running" || latestPdfJob?.status === "pending";
  const isIndexingJobRunning = latestIndexingJob?.status === "running" || latestIndexingJob?.status === "pending";
  const isExtractionJobRunning = latestExtractionJob?.status === "running" || latestExtractionJob?.status === "pending";

  // Show toast when jobs complete (check during render, use ref to prevent duplicates)
  const checkAndToastJob = (
    job: typeof latestPdfJob | typeof latestIndexingJob | typeof latestExtractionJob,
    jobType: string
  ) => {
    if (!job) return;
    if (job.status === "completed" || job.status === "failed") {
      const toastKey = `${job._id}_${job.status}`;
      if (!shownJobToasts.current.has(toastKey)) {
        shownJobToasts.current.add(toastKey);
        // Use setTimeout to avoid calling toast during render
        setTimeout(() => {
          if (job.status === "completed") {
            toast.success(
              `${jobType}: ${job.succeeded} succeeded, ${job.failed} failed, ${job.skipped} skipped`
            );
          } else {
            toast.error(`${jobType} failed: ${job.errors[0] || "Unknown error"}`);
          }
        }, 0);
      }
    }
  };
  
  checkAndToastJob(latestPdfJob, "PDF Download");
  checkAndToastJob(latestIndexingJob, "Indexing");
  checkAndToastJob(latestExtractionJob, "Extraction");

  // New unified entry points
  const startPdfDownloadJob = useAction(api.jobs.entrypoints.startPdfDownloadJob);
  const startRagIndexingJob = useAction(api.jobs.entrypoints.startRagIndexingJob);
  const startExtractionJob = useAction(api.jobs.entrypoints.startExtractionJob);
  const startFullPipeline = useAction(api.jobs.entrypoints.startFullPipeline);
  const retryFailedItems = useMutation(api.jobs.mutations.retryFailedItems);

  const deleteAnalysis = useMutation(api.extraction.analysesMutations.remove);
  const addQuestion = useMutation(api.extraction.analysesMutations.addQuestion);

  const handleRunExtraction = async () => {
    setIsStartingExtraction(true);
    try {
      const result = await startExtractionJob({ analysisId: analysisId as Id<"analyses"> });
      
      if (result.totalItems === 0) {
        toast.info("No items to extract (all completed, none failed)");
        setIsStartingExtraction(false);
      } else {
        toast.info(`Started extraction for ${result.totalItems} items...`);
      }
    } catch (error) {
      console.error("Extraction failed:", error);
      toast.error("Failed to start extraction");
      setIsStartingExtraction(false);
    }
  };

  const handleRunFullPipeline = async () => {
    setIsStartingFullPipeline(true);
    try {
      const result = await startFullPipeline({ analysisId: analysisId as Id<"analyses"> });
      
      const total = result.totalItems.pdfDownload + result.totalItems.ragIndexing + result.totalItems.extraction;
      if (total === 0) {
        toast.info("No work to do - all steps completed");
        setIsStartingFullPipeline(false);
      } else {
        toast.success(`Started full pipeline: ${result.totalItems.pdfDownload} PDFs, ${result.totalItems.ragIndexing} to index, ${result.totalItems.extraction} to extract`);
      }
    } catch (error) {
      console.error("Full pipeline failed:", error);
      toast.error("Failed to start full pipeline");
      setIsStartingFullPipeline(false);
    }
  };

  const handleRetryFailed = async (jobId: Id<"jobs">) => {
    try {
      const count = await retryFailedItems({ jobId });
      if (count > 0) {
        toast.success(`Retrying ${count} failed items`);
      } else {
        toast.info("No failed items to retry");
      }
    } catch (error) {
      console.error("Retry failed:", error);
      toast.error("Failed to retry items");
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this analysis? This cannot be undone.")) {
      return;
    }

    try {
      await deleteAnalysis({ id: analysisId as Id<"analyses"> });
      toast.success("Analysis deleted");
      router.push("/extraction");
    } catch (error) {
      console.error("Failed to delete:", error);
      toast.error("Failed to delete analysis");
    }
  };

  const handleAddQuestion = async () => {
    const question = prompt("Enter extraction question:");
    if (!question?.trim()) return;

    const type = prompt("Enter type (text/number/boolean):", "text");
    if (!type || !["text", "number", "boolean"].includes(type)) {
      toast.error("Invalid type. Must be text, number, or boolean");
      return;
    }

    try {
      await addQuestion({
        analysisId: analysisId as Id<"analyses">,
        question: question.trim(),
        type: type as "text" | "number" | "boolean",
      });
      toast.success("Question added");
    } catch (error) {
      console.error("Failed to add question:", error);
      toast.error("Failed to add question");
    }
  };

  const handleIndexAll = async () => {
    setIsIndexing(true);
    try {
      const result = await startRagIndexingJob({
        analysisId: analysisId as Id<"analyses">,
      });
      
      if (result.totalItems === 0) {
        toast.info("No documents to index");
        setIsIndexing(false);
      } else {
        toast.info(`Started indexing ${result.totalItems} documents...`);
      }
    } catch (error) {
      console.error("Indexing failed:", error);
      toast.error("Failed to start indexing");
      setIsIndexing(false);
    }
  };

  const handleDownloadOpenAccess = async () => {
    setIsDownloadingOA(true);
    try {
      const result = await startPdfDownloadJob({
        analysisId: analysisId as Id<"analyses">,
      });
      
      if (result.totalItems === 0) {
        toast.info("No documents with open access URLs to download");
        setIsDownloadingOA(false);
      } else {
        toast.info(`Started downloading ${result.totalItems} open access PDFs...`);
      }
    } catch (error) {
      console.error("Open access download failed:", error);
      toast.error("Failed to start open access PDF download");
      setIsDownloadingOA(false);
    }
  };

  if (!analysisData) {
    return (
      <PageWrapper>
        <div className="container mx-auto p-4 sm:p-6 max-w-7xl">
          <div className="flex items-center justify-center min-h-[400px]">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </div>
      </PageWrapper>
    );
  }

  const { analysis, sourceCount, documentCount, completedExtractions, totalExtractions } = analysisData;
  const statusConfig = STATUS_CONFIG[analysis.status];
  const progress = totalExtractions > 0 ? (completedExtractions / totalExtractions) * 100 : 0;

  return (
    <PageWrapper>
      <div className="container mx-auto p-4 sm:p-6 max-w-7xl">
        {/* Header */}
        <div className="mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/extraction")}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Analyses
          </Button>

          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                <Database className="h-6 w-6 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="text-2xl font-bold">{analysis.name}</h1>
                  <Badge className={statusConfig.color}>{statusConfig.label}</Badge>
                </div>
                {analysis.description && (
                  <p className="text-muted-foreground">{analysis.description}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <ExportMenu
                analysisId={analysisId as Id<"analyses">}
                analysisName={analysis.name}
              />
              <Button
                onClick={handleRunFullPipeline}
                disabled={isStartingFullPipeline || isPdfJobRunning || isIndexingJobRunning || isExtractionJobRunning || documentCount === 0 || analysis.extractionQuestions.length === 0}
                variant="outline"
              >
                {isStartingFullPipeline ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4 mr-2" />
                    Full Pipeline
                  </>
                )}
              </Button>
              <Button
                onClick={handleRunExtraction}
                disabled={isStartingExtraction || isExtractionJobRunning || documentCount === 0 || analysis.extractionQuestions.length === 0}
              >
                {isStartingExtraction || isExtractionJobRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {latestExtractionJob ? `${latestExtractionJob.processed}/${latestExtractionJob.totalItems}` : "Starting..."}
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Run Extraction
                  </>
                )}
              </Button>
              <Button variant="outline" size="icon" onClick={handleDelete}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Questions</CardDescription>
              <CardTitle className="text-3xl">{analysis.extractionQuestions.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Documents</CardDescription>
              <CardTitle className="text-3xl">{documentCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Progress</CardDescription>
              <CardTitle className="text-3xl">{progress.toFixed(0)}%</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Completed</CardDescription>
              <CardTitle className="text-3xl">{completedExtractions}/{totalExtractions}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="results">Results</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="questions">Questions</TabsTrigger>
            <TabsTrigger value="sources">Sources</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Analysis Overview</CardTitle>
                <CardDescription>Summary of your extraction analysis</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold mb-2">Status</h3>
                    <p className="text-muted-foreground">
                      {analysis.status === "draft" && "Ready to configure and run"}
                      {analysis.status === "processing" && "Extraction in progress..."}
                      {analysis.status === "completed" && "All extractions completed"}
                      {analysis.status === "failed" && "Extraction failed - please try again"}
                    </p>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2">Progress</h3>
                    <div className="w-full bg-muted rounded-full h-2 mb-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {completedExtractions} of {totalExtractions} extractions completed
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="results">
            {extractionTable && (
              <ExtractionResultsTable
                questions={extractionTable.questions}
                rows={extractionTable.rows}
              />
            )}
          </TabsContent>

          <TabsContent value="documents">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Documents</CardTitle>
                    <CardDescription>
                      Upload PDFs for full-text extraction with RAG
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={handleDownloadOpenAccess}
                      disabled={isDownloadingOA || isPdfJobRunning || !documents || documents.length === 0}
                      size="sm"
                      variant="outline"
                    >
                      {isDownloadingOA || isPdfJobRunning ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          {latestPdfJob ? `${latestPdfJob.processed}/${latestPdfJob.totalItems}` : "Starting..."}
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4 mr-2" />
                          Get Open Access PDFs
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={handleIndexAll}
                      disabled={isIndexing || isIndexingJobRunning || !documents || documents.length === 0}
                      size="sm"
                      variant="outline"
                    >
                      {isIndexing || isIndexingJobRunning ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          {latestIndexingJob ? `${latestIndexingJob.processed}/${latestIndexingJob.totalItems}` : "Starting..."}
                        </>
                      ) : (
                        <>
                          <BookOpen className="h-4 w-4 mr-2" />
                          Index All Documents
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              
              {/* Show PDF download job progress bar */}
              {latestPdfJob && (latestPdfJob.status === "running" || latestPdfJob.status === "pending") && (
                <div className="px-6 pb-4">
                  <div className="p-4 rounded-lg bg-muted/50 space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Downloading open access PDFs...
                      </span>
                      <span className="text-muted-foreground">
                        {latestPdfJob.succeeded} success, {latestPdfJob.failed} failed, {latestPdfJob.skipped} skipped
                      </span>
                    </div>
                    <Progress 
                      value={latestPdfJob.totalItems > 0 ? (latestPdfJob.processed / latestPdfJob.totalItems) * 100 : 0} 
                    />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{latestPdfJob.processed} of {latestPdfJob.totalItems} documents processed</span>
                      {latestPdfJob.failed > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs"
                          onClick={() => handleRetryFailed(latestPdfJob._id)}
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Retry Failed
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Show indexing job progress bar */}
              {latestIndexingJob && (latestIndexingJob.status === "running" || latestIndexingJob.status === "pending") && (
                <div className="px-6 pb-4">
                  <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/30 space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Indexing documents for RAG search...
                      </span>
                      <span className="text-muted-foreground">
                        {latestIndexingJob.succeeded} indexed, {latestIndexingJob.failed} failed, {latestIndexingJob.skipped} skipped
                      </span>
                    </div>
                    <Progress 
                      value={latestIndexingJob.totalItems > 0 ? (latestIndexingJob.processed / latestIndexingJob.totalItems) * 100 : 0} 
                    />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{latestIndexingJob.processed} of {latestIndexingJob.totalItems} documents processed</span>
                      {latestIndexingJob.failed > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs"
                          onClick={() => handleRetryFailed(latestIndexingJob._id)}
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Retry Failed
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Show extraction job progress bar */}
              {latestExtractionJob && (latestExtractionJob.status === "running" || latestExtractionJob.status === "pending") && (
                <div className="px-6 pb-4">
                  <div className="p-4 rounded-lg bg-purple-50 dark:bg-purple-950/30 space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Running AI extraction...
                      </span>
                      <span className="text-muted-foreground">
                        {latestExtractionJob.succeeded} success, {latestExtractionJob.failed} failed, {latestExtractionJob.skipped} skipped
                      </span>
                    </div>
                    <Progress 
                      value={latestExtractionJob.totalItems > 0 ? (latestExtractionJob.processed / latestExtractionJob.totalItems) * 100 : 0} 
                    />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{latestExtractionJob.processed} of {latestExtractionJob.totalItems} items processed</span>
                      {latestExtractionJob.failed > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs"
                          onClick={() => handleRetryFailed(latestExtractionJob._id)}
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Retry Failed
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
              
              <CardContent>
                {!documents || documents.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
                      <FileText className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="font-semibold mb-2">No documents yet</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Add sources first, then upload PDFs for full-text search.
                    </p>
                    <Button onClick={() => setActiveTab("sources")}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Sources
                    </Button>
                  </div>
                ) : (
                  (() => {
                    // Group documents by OA status
                    const oaDocs = documents.filter(d => d.openAccessUrl);
                    const nonOaDocs = documents.filter(d => !d.openAccessUrl);
                    
                    const DocumentCard = ({ doc }: { doc: typeof documents[0] }) => {
                      const hasFullText = doc.hasFullText;
                      const isIndexed = !!doc.ragEntryId;
                      const hasPdf = !!doc.pdfStorageId;
                      const hasOA = !!doc.openAccessUrl;
                      
                      // Truncate abstract to ~150 chars
                      const abstractSnippet = doc.abstract 
                        ? doc.abstract.length > 150 
                          ? doc.abstract.substring(0, 150).trim() + "..."
                          : doc.abstract
                        : null;

                      return (
                        <div
                          key={doc._id}
                          className="p-4 rounded-lg border border-border/50 space-y-3"
                        >
                          {/* Title and metadata row */}
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium leading-tight">{doc.title}</p>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                                <span>
                                  {doc.authors?.slice(0, 2).join(", ")}
                                  {doc.authors && doc.authors.length > 2 && " et al."}
                                </span>
                                {doc.year && <span>({doc.year})</span>}
                              </div>
                            </div>
                            
                            {/* Status badge */}
                            <div className="shrink-0">
                              {isIndexed ? (
                                <Badge className="bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Indexed
                                </Badge>
                              ) : hasPdf ? (
                                <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400">
                                  PDF Ready
                                </Badge>
                              ) : hasFullText ? (
                                <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400">
                                  Has Text
                                </Badge>
                              ) : doc.abstract ? (
                                <Badge variant="secondary">Abstract Only</Badge>
                              ) : (
                                <Badge variant="outline">No Content</Badge>
                              )}
                            </div>
                          </div>

                          {/* Abstract snippet */}
                          {abstractSnippet ? (
                            <p className="text-sm text-muted-foreground leading-relaxed">
                              {abstractSnippet}
                            </p>
                          ) : (
                            <p className="text-sm text-muted-foreground/60 italic">
                              No abstract available
                            </p>
                          )}

                          {/* Actions row */}
                          <div className="flex items-center gap-2 pt-1">
                            {hasOA && (
                              <Button
                                asChild
                                size="sm"
                                variant="outline"
                                className="h-8"
                              >
                                <a
                                  href={doc.openAccessUrl!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                                  Open Access
                                </a>
                              </Button>
                            )}
                            {!hasPdf && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8"
                                onClick={() =>
                                  setPdfUploadDoc({ id: doc._id, title: doc.title })
                                }
                              >
                                <FileUp className="h-3.5 w-3.5 mr-1.5" />
                                Upload PDF
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    };

                    return (
                      <div className="space-y-6">
                        {/* Open Access Documents */}
                        {oaDocs.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <Unlock className="h-4 w-4 text-green-600" />
                              <h3 className="font-semibold text-sm">
                                Open Access ({oaDocs.length})
                              </h3>
                            </div>
                            <div className="space-y-3">
                              {oaDocs.map((doc) => (
                                <DocumentCard key={doc._id} doc={doc} />
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Non-OA Documents */}
                        {nonOaDocs.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <Lock className="h-4 w-4 text-muted-foreground" />
                              <h3 className="font-semibold text-sm">
                                No Open Access ({nonOaDocs.length})
                              </h3>
                            </div>
                            <div className="space-y-3">
                              {nonOaDocs.map((doc) => (
                                <DocumentCard key={doc._id} doc={doc} />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="questions">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Extraction Questions</CardTitle>
                    <CardDescription>Define what data to extract from papers</CardDescription>
                  </div>
                  <Button onClick={handleAddQuestion} size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Question
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {analysis.extractionQuestions.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No questions yet. Add your first extraction question.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {analysis.extractionQuestions.map((q) => (
                      <div
                        key={q.id}
                        className="p-3 rounded-lg border border-border/50 flex items-center justify-between"
                      >
                        <div>
                          <p className="font-medium">{q.question}</p>
                          <p className="text-xs text-muted-foreground">Type: {q.type}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sources">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Data Sources</CardTitle>
                    <CardDescription>Documents included in this analysis</CardDescription>
                  </div>
                  <Button onClick={() => setSourceDialogOpen(true)} size="sm">
                    <FolderPlus className="h-4 w-4 mr-2" />
                    Add Sources
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {!sources || sources.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
                      <FolderPlus className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="font-semibold mb-2">No sources yet</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Add documents from search history, uploads, or manually.
                    </p>
                    <Button onClick={() => setSourceDialogOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Sources
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sources.map((source) => (
                      <div
                        key={source._id}
                        className="p-4 rounded-lg border border-border/50 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                            {source.sourceType === "search_history" && <History className="h-5 w-5 text-muted-foreground" />}
                            {source.sourceType === "upload" && <Upload className="h-5 w-5 text-muted-foreground" />}
                            {source.sourceType === "manual" && <FileText className="h-5 w-5 text-muted-foreground" />}
                            {source.sourceType === "zotero" && <Link className="h-5 w-5 text-muted-foreground" />}
                          </div>
                          <div>
                            <p className="font-medium">
                              {source.sourceMeta?.name || source.sourceMeta?.query || source.sourceType}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {source.documentCount || 0} documents • {source.sourceType}
                            </p>
                          </div>
                        </div>
                        <Badge
                          className={cn(
                            source.status === "ready" && "bg-green-100 text-green-700",
                            source.status === "importing" && "bg-blue-100 text-blue-700",
                            source.status === "error" && "bg-red-100 text-red-700",
                            source.status === "pending" && "bg-muted text-muted-foreground"
                          )}
                        >
                          {source.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <SourceAddDialog
          open={sourceDialogOpen}
          onOpenChange={setSourceDialogOpen}
          analysisId={analysisId as Id<"analyses">}
        />

        {/* PDF Upload Dialog */}
        <Dialog
          open={!!pdfUploadDoc}
          onOpenChange={(open) => !open && setPdfUploadDoc(null)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Upload PDF</DialogTitle>
            </DialogHeader>
            {pdfUploadDoc && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground truncate">
                  {pdfUploadDoc.title}
                </p>
                <DocumentPdfUpload
                  documentId={pdfUploadDoc.id}
                  documentTitle={pdfUploadDoc.title}
                  onSuccess={() => setPdfUploadDoc(null)}
                />
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </PageWrapper>
  );
}
