import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LibraryPageClient } from "@/components/library/library-page-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: t("libraryTitle"),
    description: t("libraryDescription"),
  };
}

export default function LibraryPage() {
  return <LibraryPageClient />;
}
