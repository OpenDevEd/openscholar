import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ExtractionListClient } from "./extraction-list-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: t("extractionTitle"),
    description: t("extractionDescription"),
  };
}

export default function ExtractionPage() {
  return <ExtractionListClient />;
}
