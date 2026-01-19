import { Metadata } from "next";
import { AnalysisDetailClient } from "./analysis-detail-client";

export const metadata: Metadata = {
  title: "Analysis | OpenScholar",
  description: "View and manage your data extraction analysis",
};

export default async function AnalysisDetailPage({
  params,
}: {
  params: Promise<{ analysisId: string }>;
}) {
  const { analysisId } = await params;
  return <AnalysisDetailClient analysisId={analysisId} />;
}
