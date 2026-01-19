"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ArrowLeft,
  Database,
  Play,
  Settings,
  FileText,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageWrapper } from "@/components/PageWrapper";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExtractionResultsTable } from "@/components/extraction/results-table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  const [isRunning, setIsRunning] = useState(false);

  const analysisData = useQuery(api.extraction.analyses.getWithStats, {
    id: analysisId as Id<"analyses">,
  });

  const extractionTable = useQuery(api.extraction.documents.getExtractionTable, {
    analysisId: analysisId as Id<"analyses">,
  });

  const runExtraction = useAction(api.extraction.actions.runExtraction);
  const deleteAnalysis = useMutation(api.extraction.analysesMutations.remove);
  const addQuestion = useMutation(api.extraction.analysesMutations.addQuestion);

  const handleRunExtraction = async () => {
    setIsRunning(true);
    try {
      const result = await runExtraction({ analysisId: analysisId as Id<"analyses"> });
      toast.success(`Extraction completed: ${result.processed} processed, ${result.errors} errors`);
    } catch (error) {
      console.error("Extraction failed:", error);
      toast.error("Extraction failed");
    } finally {
      setIsRunning(false);
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
              <Button
                onClick={handleRunExtraction}
                disabled={isRunning || analysis.status === "processing" || documentCount === 0 || analysis.extractionQuestions.length === 0}
              >
                {isRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Running...
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
                <CardTitle>Data Sources</CardTitle>
                <CardDescription>Documents included in this analysis</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-muted-foreground">
                  {documentCount} documents • {sourceCount} sources
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PageWrapper>
  );
}
