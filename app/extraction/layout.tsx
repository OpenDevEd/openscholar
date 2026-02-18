import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  const tc = await getTranslations("common");
  const te = await getTranslations("extraction");

  return {
    title: {
      default: tc("extraction"),
      template: `%s | ${t("siteName")}`,
    },
    description: te("extractDescription"),
  };
}

export default function ExtractionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
