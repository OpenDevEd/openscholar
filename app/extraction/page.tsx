import { Metadata } from "next";
import { ExtractionPageClient } from "./extraction-page-client";

export const metadata: Metadata = {
  title: "Data Extraction | OpenScholar",
  description: "Extract structured data from academic papers using AI.",
};

export default function ExtractionPage() {
  return <ExtractionPageClient />;
}
