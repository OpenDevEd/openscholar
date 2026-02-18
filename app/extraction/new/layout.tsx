import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  const tc = await getTranslations("common");
  const te = await getTranslations("extraction");

  return {
    title: `${tc("new")} | ${t("siteName")}`,
    description: te("extractDescription"),
  };
}

export default function NewExtractionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
