import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ResultsClientLayout } from "./results-client-layout";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  const tc = await getTranslations("common");

  return {
    title: `${tc("results")} | ${t("siteName")}`,
    description: t("defaultDescription"),
  };
}

export default async function ResultsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ResultsClientLayout>{children}</ResultsClientLayout>;
}
