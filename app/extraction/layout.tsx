import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const [t, tc, te] = await Promise.all([
    getTranslations("metadata"),
    getTranslations("common"),
    getTranslations("extraction"),
  ]);

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
  if (process.env.NEXT_PUBLIC_EXTRACTION_ENABLED === "false") {
    redirect("/");
  }
  return children;
}
