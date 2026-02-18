import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const [t, tc, te] = await Promise.all([
    getTranslations("metadata"),
    getTranslations("common"),
    getTranslations("extraction"),
  ]);

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
