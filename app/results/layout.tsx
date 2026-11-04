import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ResultsClientLayout } from "./results-client-layout";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("results") };
}

export default async function ResultsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ResultsClientLayout>{children}</ResultsClientLayout>;
}
