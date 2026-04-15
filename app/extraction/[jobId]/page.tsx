import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ExtractionResultsClient } from "./extraction-results-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: t("extractionResultsTitle"),
  };
}

export default async function ExtractionResultsPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  return <ExtractionResultsClient jobId={jobId} />;
}
