"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { motion } from "motion/react";
import { PageWrapper } from "@/components/PageWrapper";

export default function JobDetailPage() {
  const params = useParams();
  const jobId = params.jobId as string;

  const jobDetails = useQuery(api.extraction.queries.getJobDetails, {
    jobId: jobId as any,
  });

  if (!jobDetails) {
    return (
      <PageWrapper>
        <div className="container mx-auto p-4 sm:p-6 max-w-6xl flex items-center justify-center h-96">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      </PageWrapper>
    );
  }

  const { job, questions, papers, progress } = jobDetails;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "failed":
      case "download_failed":
      case "indexing_failed":
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Loader2 className="w-4 h-4 animate-spin text-primary" />;
    }
  };

  return (
    <PageWrapper>
      <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Header */}
          <div className="flex items-center gap-4">
            <Link href="/extraction">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">{job.name}</h1>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline">{job.status}</Badge>
                <span className="text-sm text-muted-foreground">
                  {job.totalPapers} papers
                </span>
              </div>
            </div>
          </div>

          {/* Progress */}
          <Card>
            <CardHeader>
              <CardTitle>Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between text-sm">
                <span>{progress.percentage}%</span>
                <span className="text-muted-foreground">
                  {progress.processed} / {progress.total} processed
                  {progress.failed > 0 && (
                    <>, {<span className="text-red-500">{progress.failed} failed</span>}</>
                  )}
                </span>
              </div>
              <Progress value={progress.percentage} className="h-2" />
            </CardContent>
          </Card>

          {/* Questions */}
          <Card>
            <CardHeader>
              <CardTitle>Questions ({questions.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {questions.map((q: any) => (
                  <div key={q.key} className="flex items-center justify-between p-2 bg-muted rounded">
                    <span>{q.question}</span>
                    <Badge variant="secondary">{q.type}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Papers */}
          <Card>
            <CardHeader>
              <CardTitle>Papers ({papers.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {papers.map((paper: any) => (
                  <div key={paper._id} className="flex items-center gap-3 p-2 bg-muted rounded">
                    {getStatusIcon(paper.status)}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{paper.title}</p>
                      <p className="text-xs text-muted-foreground">{paper.status}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </PageWrapper>
  );
}
