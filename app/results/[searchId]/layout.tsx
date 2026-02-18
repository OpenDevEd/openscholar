import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  const tc = await getTranslations("common");

  return {
    title: {
      default: tc("results"),
      template: `%s | ${t("siteName")}`,
    },
    description: t("defaultDescription"),
  };
}

export default function SearchIdLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
